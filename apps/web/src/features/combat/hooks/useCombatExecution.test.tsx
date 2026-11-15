// @vitest-environment jsdom

import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeOptions, NoticeType } from '@/shared/notifications'
import type { AgentRun, ExecutionController, ExecutionControllerState } from '@/features/task-execution'
import type { CopilotSetItemStatus } from '../model/copilotSetRun'
import { COMBAT_EXECUTION_SCOPE, useCombatExecution, type CombatExecution } from './useCombatExecution'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  notifyProgress: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notifyProgress: notifications.notifyProgress,
  EXECUTION_NOTICE_ID: 'execution',
}))

const apiMocks = vi.hoisted(() => ({
  executeCopilotQueue: vi.fn(),
  continueCopilotQueue: vi.fn(),
  skipCopilotQueueEntry: vi.fn(),
  executeCopilotSetPlan: vi.fn(),
  continueCopilotSet: vi.fn(),
}))

vi.mock('../api', () => ({
  executeCopilotQueue: apiMocks.executeCopilotQueue,
  continueCopilotQueue: apiMocks.continueCopilotQueue,
  skipCopilotQueueEntry: apiMocks.skipCopilotQueueEntry,
  executeCopilotSetPlan: apiMocks.executeCopilotSetPlan,
  continueCopilotSet: apiMocks.continueCopilotSet,
}))

const controllerState: { current: ExecutionControllerState | null } = { current: null }

vi.mock('@/features/task-execution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/task-execution')>()
  return {
    ...actual,
    useExecutionSnapshot: () => controllerState.current,
  }
})

type EntryStatus = CopilotSetItemStatus

interface TestEntry {
  key: string
  itemIndex: number
  copilotId: number
  stage: string
  displayStage: string
  mode: string
  status: EntryStatus
  error?: string
}

function entry(itemIndex: number, status: EntryStatus, overrides: Partial<TestEntry> = {}): TestEntry {
  return {
    key: `${itemIndex}:${100 + itemIndex}:normal`,
    itemIndex,
    copilotId: 100 + itemIndex,
    stage: `TEST-${itemIndex + 1}`,
    displayStage: `TEST-${itemIndex + 1}`,
    mode: 'normal',
    status,
    ...overrides,
  }
}

/**
 * 服务端作业集进度投影：attempted 条目在前，计划推导的 skipped 条目
 * （未选中且此前未通关）追加在 taskResults 尾部，从 run 开始就存在。
 */
function manualRun(
  state: AgentRun['state'],
  taskResults: TestEntry[],
  nextIndex: number | null = null,
): AgentRun {
  return {
    runId: 'run-manual',
    operationId: 'run_copilot_set',
    state,
    progress: {
      setId: '48990',
      name: '作业集 48990',
      mode: 'manual',
      phase: state === 'waiting' ? 'waiting_for_next' : 'running',
      nextEntry: nextIndex === null ? null : entry(nextIndex, 'pending'),
      currentEntry: null,
      taskResults,
    },
    links: { self: '/api/agent/runs/run-manual', stop: '/api/agent/actions/stop?runId=run-manual' },
  } as unknown as AgentRun
}

function combatState(trackedRun: AgentRun | null): ExecutionControllerState {
  return {
    phase: 'live',
    identity: 'tracked',
    submission: 'idle',
    snapshot: null,
    trackedRunId: trackedRun?.runId ?? null,
    trackedScope: COMBAT_EXECUTION_SCOPE,
    trackedOperationId: trackedRun?.operationId ?? null,
    trackedRun,
    lastError: null,
    lastSyncedAt: null,
    hasActiveRun: true,
    occupancy: null,
  }
}

let root: Root
let container: HTMLDivElement
let rerender: (() => void) | null = null
let latest: CombatExecution | null = null
const messages: Array<{ message: string; type?: NoticeType; options?: NoticeOptions }> = []

function Harness({ controller, stopOnFailure }: { controller: ExecutionController; stopOnFailure: boolean }) {
  const [, setTick] = useState(0)
  const execution = useCombatExecution({
    notify: (message, type, options) => {
      messages.push({ message, type, options })
      return 'notice'
    },
    stopOnFailure,
    controller,
  })
  useEffect(() => {
    rerender = () => setTick(tick => tick + 1)
    latest = execution
  })
  return null
}

describe('useCombatExecution run projection', () => {
  beforeEach(() => {
    messages.length = 0
    notifications.notifyProgress.mockReset()
    rerender = null
    latest = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const flush = async () => {
    await act(async () => {
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })
  }

  const renderHarness = async (controller: ExecutionController, stopOnFailure = false) => {
    await act(async () => {
      root.render(<Harness controller={controller} stopOnFailure={stopOnFailure} />)
    })
    await flush()
  }

  it('keeps the set-run projection stable across unrelated re-renders', async () => {
    controllerState.current = combatState(manualRun('waiting', [entry(0, 'success')], 1))
    await renderHarness({ getState: () => controllerState.current } as unknown as ExecutionController)

    const before = latest?.setRun
    expect(before).not.toBeNull()

    await act(async () => rerender?.())

    expect(latest?.setRun).toBe(before)
  })

  it('stops a failed manual set even when plan-derived skipped entries shadow the failure', async () => {
    // 失败条目之后跟着计划推导的 skipped 条目（更大 itemIndex，从 run 开始就存在）：
    // 它们不能被当作「最近结算」，否则失败后停止策略永不触发。
    const run = manualRun('waiting', [
      entry(1, 'failed', { error: '作战失败' }),
      entry(3, 'skipped'),
      entry(4, 'skipped'),
    ])
    controllerState.current = combatState(run)
    const stopTrackedRun = vi.fn(async () => ({ success: true, data: { alreadyTerminal: false } }))
    const controller = {
      getState: () => controllerState.current,
      subscribe: () => () => {},
      stopTrackedRun,
    } as unknown as ExecutionController

    await renderHarness(controller, true)

    expect(stopTrackedRun).toHaveBeenCalledOnce()
    expect(messages).toContainEqual({
      message: '作业 2/3 执行失败: 作战失败，已按队列策略停止',
      type: 'error',
    })
    expect(messages.some(({ message }) => message.includes('已跳过'))).toBe(false)
  })

  it('reports the actually settled entry while waiting instead of plan-derived skipped entries', async () => {
    controllerState.current = combatState(manualRun(
      'waiting',
      [entry(0, 'success'), entry(1, 'pending'), entry(2, 'skipped'), entry(3, 'skipped')],
      1,
    ))
    await renderHarness({ getState: () => controllerState.current } as unknown as ExecutionController)

    expect(notifications.notifyProgress).toHaveBeenCalledWith('作业 1/4 完成，等待开始下一关', 'execution')

    // 继续执行后新的结算要能覆盖提示去重键，不能被尾部 skipped 条目遮蔽。
    controllerState.current = combatState(manualRun(
      'waiting',
      [entry(0, 'success'), entry(1, 'failed', { error: '作战失败' }), entry(2, 'pending'), entry(3, 'skipped')],
      2,
    ))
    await act(async () => rerender?.())
    await flush()

    expect(notifications.notifyProgress).toHaveBeenCalledWith('作业 2/4 执行失败: 作战失败，等待开始下一关', 'execution')
    expect(messages.some(({ message }) => message.includes('已跳过'))).toBe(false)
  })
})

function queueRun(
  state: AgentRun['state'],
  progress: Record<string, unknown> | null = null,
): AgentRun {
  return {
    runId: 'run-queue',
    operationId: 'run_copilot_queue',
    state,
    ...(progress ? { progress } : {}),
    links: { self: '/api/agent/runs/run-queue' },
  } as unknown as AgentRun
}

function queueController(run: AgentRun | null): ExecutionController {
  const state = combatState(run)
  return {
    getState: () => ({ ...state, submission: 'idle' as const }),
    submitExecution: vi.fn(async (...args: unknown[]) => {
      const request = args[1] as (context: { idempotencyKey: string }) => Promise<unknown>
      return request({ idempotencyKey: 'run_copilot_queue-test' })
    }),
    refresh: vi.fn(async () => {}),
    stopTrackedRun: vi.fn(),
  } as unknown as ExecutionController
}

describe('useCombatExecution queue submissions', () => {
  const flush = async () => {
    await act(async () => {
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })
  }

  const renderHarness = async (controller: ExecutionController, stopOnFailure = false) => {
    await act(async () => {
      root.render(<Harness controller={controller} stopOnFailure={stopOnFailure} />)
    })
    await flush()
  }

  beforeEach(() => {
    messages.length = 0
    notifications.notifyProgress.mockReset()
    rerender = null
    latest = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    apiMocks.executeCopilotQueue.mockReset()
    apiMocks.continueCopilotQueue.mockReset()
    apiMocks.skipCopilotQueueEntry.mockReset()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('submits a queue run through the execution controller with one idempotency key', async () => {
    controllerState.current = combatState(null)
    apiMocks.executeCopilotQueue.mockResolvedValue({
      success: true,
      data: { runId: 'run-queue', accepted: true },
    })
    const controller = queueController(null)
    await renderHarness(controller)

    let submitted = false
    await act(async () => {
      submitted = await latest!.submitQueue({
        queueId: 'copilot-queue',
        name: '作业队列',
        mode: 'continuous',
        failurePolicy: 'continue',
        entries: [
          { clientId: 'queue-a', source: 'prts', copilotId: 101 },
          { clientId: 'queue-b', source: 'file', filename: '/data/copilot-imports/uuid.json' },
        ],
        options: { formationMode: 'auto' },
        taskName: '自动战斗作业',
      })
    })

    expect(submitted).toBe(true)
    expect(controller.submitExecution).toHaveBeenCalledWith(
      'run_copilot_queue',
      expect.any(Function),
      { scope: COMBAT_EXECUTION_SCOPE },
    )
    expect(apiMocks.executeCopilotQueue).toHaveBeenCalledWith({
      queueId: 'copilot-queue',
      name: '作业队列',
      mode: 'continuous',
      failurePolicy: 'continue',
      entries: [
        { clientId: 'queue-a', source: 'prts', copilotId: 101 },
        { clientId: 'queue-b', source: 'file', filename: '/data/copilot-imports/uuid.json' },
      ],
      options: { formationMode: 'auto' },
      waitForCompletion: false,
    }, { idempotencyKey: 'run_copilot_queue-test' })
    expect(notifications.notifyProgress).toHaveBeenCalledWith('正在连续执行作业队列', 'execution')
  })

  it('warns instead of leaving an unobservable submission in progress', async () => {
    controllerState.current = combatState(null)
    apiMocks.executeCopilotQueue.mockResolvedValue({
      success: true,
      data: { accepted: true },
    })
    const controller = queueController(null)
    await renderHarness(controller)

    let submitted = true
    await act(async () => {
      submitted = await latest!.submitQueue({
        queueId: 'copilot-queue',
        name: '作业队列',
        mode: 'continuous',
        failurePolicy: 'continue',
        entries: [{ clientId: 'queue-a', source: 'prts', copilotId: 101 }],
        options: {},
        taskName: '自动战斗作业',
      })
    })

    expect(submitted).toBe(false)
    expect(messages).toContainEqual({
      message: '服务端未返回运行身份，无法确认本次执行状态',
      type: 'warning',
      options: { id: 'execution' },
    })
  })

  it('reads the waiting state from the queue run projection and continues it', async () => {
    const waiting = queueRun('waiting', {
      queueId: 'copilot-queue',
      mode: 'manual',
      phase: 'waiting_for_next',
      nextEntry: { clientId: 'queue-b', itemIndex: 1, stage: 'QUEUE-2', mode: 'normal' },
    })
    controllerState.current = combatState(waiting)
    apiMocks.continueCopilotQueue.mockResolvedValue({
      success: true,
      data: { runId: 'run-queue', accepted: true },
    })
    const controller = queueController(waiting)
    await renderHarness(controller)

    expect(latest?.queueRun?.isWaiting).toBe(true)
    expect(latest?.queueRun?.nextEntry?.clientId).toBe('queue-b')

    await act(async () => {
      await latest!.continueQueue()
    })

    expect(apiMocks.continueCopilotQueue).toHaveBeenCalledWith('run-queue', false)
    expect(controller.refresh).toHaveBeenCalledWith('manual')
    expect(notifications.notifyProgress).toHaveBeenCalledWith('正在执行下一项...', 'execution')
  })

  it('skips the waiting queue entry and refreshes without a second submission', async () => {
    const waiting = queueRun('waiting', {
      queueId: 'copilot-queue',
      mode: 'manual',
      phase: 'waiting_for_next',
      nextEntry: { clientId: 'queue-b', itemIndex: 1, stage: 'QUEUE-2', mode: 'normal' },
    })
    controllerState.current = combatState(waiting)
    apiMocks.skipCopilotQueueEntry.mockResolvedValue({
      success: true,
      data: { skippedClientId: 'queue-b', waitingForNext: true },
    })
    const controller = queueController(waiting)
    await renderHarness(controller)

    await act(async () => {
      await latest!.skipQueueEntry()
    })

    expect(apiMocks.skipCopilotQueueEntry).toHaveBeenCalledWith('run-queue')
    expect(apiMocks.executeCopilotQueue).not.toHaveBeenCalled()
    expect(controller.refresh).toHaveBeenCalledWith('manual')
    expect(notifications.notifyProgress).toHaveBeenCalledWith('正在跳过当前项...', 'execution')
    expect(messages).toContainEqual({ message: '已跳过当前项', type: 'success', options: { id: 'execution' } })
  })

  it('keeps a busy device as a retryable continue warning', async () => {
    const waiting = queueRun('waiting', {
      queueId: 'copilot-queue',
      mode: 'manual',
      phase: 'waiting_for_next',
    })
    controllerState.current = combatState(waiting)
    apiMocks.continueCopilotQueue.mockResolvedValue({
      success: false,
      message: '设备正被占用',
      errorInfo: { code: 'MAA_EXECUTION_BUSY', message: '设备正被占用' },
    })
    const controller = queueController(waiting)
    await renderHarness(controller)

    await act(async () => {
      await latest!.continueQueue()
    })

    expect(messages).toContainEqual({
      message: '设备正被其他任务占用，请稍后重试',
      type: 'warning',
      options: { id: 'execution' },
    })
    expect(controller.refresh).toHaveBeenCalledWith('manual')
  })
})
