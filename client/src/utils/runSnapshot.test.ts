import { describe, expect, it } from 'vitest'
import type { AgentRun, CurrentRunSnapshot } from '@/types/run'
import { applyScheduleProgress } from './runSnapshot'

const runningRun: AgentRun = {
  runId: 'run-1',
  operationId: 'execute_schedule',
  state: 'running',
  startedAt: '2026-11-14T15:55:23.139Z',
  taskResults: [{ command: 'startup', state: 'succeeded', taskName: '启动游戏' }],
}

describe('applyScheduleProgress', () => {
  it('fills task and step from the schedule when the Run progress is empty', () => {
    const snapshot: CurrentRunSnapshot = {
      run: runningRun,
      lastRun: null,
      schedule: {
        isRunning: true,
        currentStep: 1,
        totalSteps: 7,
        currentTask: '理智作战',
        message: '正在执行: 理智作战 (2/7)',
      },
    }

    const merged = applyScheduleProgress(runningRun, snapshot)

    expect(merged?.progress).toMatchObject({
      currentTask: '理智作战',
      currentStep: 2,
      totalSteps: 7,
      message: '正在执行: 理智作战 (2/7)',
    })
  })

  it('keeps the Run progress when the server already provides it', () => {
    const withProgress: AgentRun = {
      ...runningRun,
      progress: { currentTask: '作业集执行', currentStep: 3, totalSteps: 5 },
    }
    const snapshot: CurrentRunSnapshot = {
      run: withProgress,
      lastRun: null,
      schedule: { currentTask: '理智作战', currentStep: 1, totalSteps: 7 },
    }

    expect(applyScheduleProgress(withProgress, snapshot)?.progress).toMatchObject({
      currentTask: '作业集执行',
      currentStep: 3,
      totalSteps: 5,
    })
  })

  it('falls back to the legacy task snapshot for a run without schedule status', () => {
    const snapshot: CurrentRunSnapshot = {
      run: runningRun,
      lastRun: null,
      task: { isRunning: true, taskName: '理智作战', currentStage: '理智作战', currentStep: 0, totalSteps: 7 },
      taskName: '定时任务',
    }

    const merged = applyScheduleProgress(runningRun, snapshot)

    expect(merged?.progress).toMatchObject({
      currentTask: '理智作战',
      currentStage: '理智作战',
      currentStep: 1,
      totalSteps: 7,
    })
  })

  it('returns the same Run object when there is nothing new to merge', () => {
    const snapshot: CurrentRunSnapshot = { run: runningRun, lastRun: null }
    expect(applyScheduleProgress(runningRun, snapshot)).toBe(runningRun)
    expect(applyScheduleProgress(null, snapshot)).toBeNull()
    expect(applyScheduleProgress(runningRun, undefined)).toBe(runningRun)
  })
})
