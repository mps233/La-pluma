// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { AgentRun, RunSnapshot, RunTaskResult } from '@/features/task-execution'
import {
  describeAutomationRunTerminal,
  executionSummaryHasFailure,
  isAutomationExecutionSummary,
  readAutomationExecutionSummary,
  readAutomationFlowProgress,
  readAutomationRunMessage,
  readAutomationScheduleSummary,
  type AutomationExecutionSummary,
} from './automationRun'

function run(
  state: AgentRun['state'] = 'running',
  overrides: Partial<AgentRun> = {},
): AgentRun {
  return {
    runId: 'run-1',
    operationId: 'run_daily_flow',
    state,
    acceptedAt: '2026-10-25T12:00:00.000Z',
    links: {
      self: '/api/agent/runs/run-1',
      stop: '/api/agent/actions/stop?runId=run-1',
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const activeRuns = overrides.activeRuns ?? []
  const current = overrides.run ?? activeRuns[0] ?? null
  return {
    isRunning: activeRuns.length > 0,
    run: current,
    activeRuns,
    lastRun: overrides.lastRun ?? null,
    schedule: overrides.schedule ?? {},
    occupancy: {
      state: activeRuns.length ? 'run' : 'idle',
      runId: current?.runId ?? null,
      runState: current?.state ?? null,
      sources: activeRuns.length ? ['run'] : [],
      lease: { state: 'free', owner: null },
      task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
      schedule: {},
    },
    ...overrides,
  }
}

function summary(overrides: Partial<AutomationExecutionSummary> = {}): AutomationExecutionSummary {
  return {
    taskResults: [
      { taskId: 'startup-1', task: '启动游戏', status: 'success' },
      { taskId: 'fight-1', task: '理智作战', status: 'failed' },
    ],
    successCount: 1,
    failedCount: 1,
    skippedCount: 0,
    durationMs: 5_000,
    summaries: [],
    reports: [],
    actions: [],
    errors: [{ task: '理智作战', error: '关卡不可用' }],
    warnings: [],
    ...overrides,
  }
}

describe('automation run progress', () => {
  it('reads step and task results from the schedule projection owned by the run', () => {
    const progress = readAutomationFlowProgress(run('running', {
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
    }), snapshot({
      schedule: {
        isRunning: true,
        runId: 'run-1',
        currentStep: 1,
        totalSteps: 3,
        currentTaskId: 'fight-1',
        currentTask: '理智作战',
        message: '正在执行: 理智作战',
        shouldStop: false,
        taskResults: [
          { taskId: 'startup-1', task: '启动游戏', status: 'success' },
          { taskId: 'fight-1', task: '理智作战', status: 'running' },
        ],
      },
    }))

    expect(progress).toEqual({
      currentStep: 1,
      currentTaskId: 'fight-1',
      currentTask: '理智作战',
      totalSteps: 3,
      taskResults: [
        { taskId: 'startup-1', task: '启动游戏', status: 'success' },
        { taskId: 'fight-1', task: '理智作战', status: 'running' },
      ],
      message: '今日流程执行中',
      shouldStop: false,
    })
  })

  it('never borrows another run’s task results', () => {
    const progress = readAutomationFlowProgress(run('running', {
      progress: { currentStep: 0, totalSteps: 2, currentTask: '启动游戏', message: '等待流程状态' },
    }), snapshot({
      schedule: {
        isRunning: true,
        runId: 'run-other',
        currentStep: 1,
        currentTaskId: 'fight-1',
        taskResults: [{ taskId: 'fight-1', task: '理智作战', status: 'success' }],
      },
    }))

    expect(progress).toMatchObject({
      currentStep: 0,
      currentTaskId: null,
      currentTask: '启动游戏',
      taskResults: [],
    })
  })

  it('ignores incomplete task result rows instead of inventing statuses', () => {
    const progress = readAutomationFlowProgress(run(), snapshot({
      schedule: {
        isRunning: true,
        runId: 'run-1',
        taskResults: [
          { taskId: 'startup-1', task: '启动游戏', status: 'success' },
          { taskId: 'fight-1', status: 'running' },
          { task: '理智作战', status: 'future' },
        ] as unknown as RunTaskResult[],
      },
    }))

    expect(progress?.taskResults).toEqual([
      { taskId: 'startup-1', task: '启动游戏', status: 'success' },
    ])
  })

  it('returns no projection for terminal runs', () => {
    expect(readAutomationFlowProgress(run('succeeded'), snapshot())).toBeNull()
  })
})

describe('automation run results', () => {
  it('reads terminal summaries only from succeeded or stopped runs', () => {
    const summaryValue = summary()
    const succeeded = run('succeeded', { result: { message: '任务流程执行完成', summary: summaryValue } })
    const stopped = run('stopped', { result: { message: '任务流程已被用户终止', summary: summaryValue } })
    const failed = run('failed', { error: { message: '流程失败' } })

    expect(readAutomationExecutionSummary(succeeded)).toEqual(summaryValue)
    expect(readAutomationExecutionSummary(stopped)).toEqual(summaryValue)
    expect(readAutomationExecutionSummary(failed)).toBeNull()
    expect(readAutomationRunMessage(succeeded)).toBe('任务流程执行完成')
  })

  it('rejects summaries missing the arrays the panel renders', () => {
    expect(isAutomationExecutionSummary({
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1,
    })).toBe(false)
    expect(isAutomationExecutionSummary(summary())).toBe(true)
  })

  it('flags failures from counts, errors, actions and reports', () => {
    expect(executionSummaryHasFailure(null)).toBe(false)
    expect(executionSummaryHasFailure(summary({ failedCount: 0, errors: [] }))).toBe(false)
    expect(executionSummaryHasFailure(summary({ failedCount: 0, errors: [], actions: [
      { task: '理智作战', action: 'fight', status: 'failed', message: '失败' },
    ] }))).toBe(true)
  })

  it('normalizes the legacy schedule last result for display only', () => {
    const legacy = readAutomationScheduleSummary(snapshot({
      schedule: {
        lastResult: {
          successCount: 6,
          failedCount: 0,
          skippedCount: 1,
          durationMs: 952_000,
        },
      },
    }))

    expect(legacy).toEqual({
      successCount: 6,
      failedCount: 0,
      skippedCount: 1,
      durationMs: 952_000,
      summaries: [],
      reports: [],
      actions: [],
      errors: [],
      warnings: [],
    })

    expect(readAutomationScheduleSummary(snapshot({
      schedule: { lastResult: { successCount: 1 } },
    }))).toBeNull()
    expect(readAutomationScheduleSummary(snapshot())).toBeNull()
  })

  it('drops malformed task results from the legacy schedule last result', () => {
    const legacy = readAutomationScheduleSummary(snapshot({
      schedule: {
        lastResult: {
          successCount: 1,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 3_000,
          taskResults: [
            { taskId: 'startup-1', task: '启动游戏', status: 'success' },
            { taskId: 42, task: '无效任务', status: 'success' },
            { taskId: 'fight-1', task: '理智作战', status: 'unknown' },
          ],
        },
      },
    }))

    expect(legacy?.taskResults).toEqual([
      { taskId: 'startup-1', task: '启动游戏', status: 'success' },
    ])
  })
})

describe('automation terminal notices', () => {
  it('announces success with the server message', () => {
    expect(describeAutomationRunTerminal(
      run('succeeded', { result: { message: '任务流程执行完成' } }),
      summary({ failedCount: 0, errors: [] }),
    )).toEqual({ message: '任务流程执行完成', type: 'success' })
  })

  it('uses a warning when the flow completed with failures', () => {
    expect(describeAutomationRunTerminal(
      run('succeeded', { result: { message: '任务流程执行完成，1 项任务失败' } }),
      summary(),
    )).toEqual({ message: '任务流程执行完成，1 项任务失败', type: 'warning' })
  })

  it('reports stopped, failed and interrupted runs distinctly', () => {
    expect(describeAutomationRunTerminal(
      run('stopped', { result: { message: '任务流程已被用户终止' } }),
      null,
    )).toEqual({ message: '任务流程已被用户终止', type: 'warning' })

    expect(describeAutomationRunTerminal(
      run('failed', { error: { message: '设备连接失败' } }),
      null,
    )).toEqual({ message: '执行失败: 设备连接失败', type: 'error' })

    expect(describeAutomationRunTerminal(
      run('interrupted', { error: { message: '服务重启' } }),
      null,
    )).toEqual({ message: '任务已中断: 服务重启', type: 'warning' })
  })
})
