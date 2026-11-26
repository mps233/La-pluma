// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeOptions, NoticeType } from '@/shared/notifications'
import type { ExecutionController, ExecutionControllerState } from '@/features/task-execution'
import { useRoguelikeExecution, type RoguelikeExecution } from './useRoguelikeExecution'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  notifyProgress: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notifyProgress: notifications.notifyProgress,
  EXECUTION_NOTICE_ID: 'execution',
}))

const controllerState: { current: ExecutionControllerState } = { current: idleState() }

vi.mock('@/features/task-execution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/task-execution')>()
  return {
    ...actual,
    useExecutionSnapshot: () => controllerState.current,
  }
})

function idleState(): ExecutionControllerState {
  return {
    phase: 'idle',
    identity: 'none',
    submission: 'idle',
    snapshot: null,
    trackedRunId: null,
    trackedScope: null,
    trackedOperationId: null,
    trackedRun: null,
    lastError: null,
    lastSyncedAt: null,
    hasActiveRun: false,
    occupancy: null,
  }
}

let root: Root
let container: HTMLDivElement
let latest: RoguelikeExecution | null = null
const messages: Array<{ message: string; type?: NoticeType; options?: NoticeOptions }> = []

function Harness({ controller }: { controller: ExecutionController }) {
  const execution = useRoguelikeExecution({
    notify: (message, type, options) => {
      messages.push({ message, type, options })
      return 'notice'
    },
    controller,
  })
  useEffect(() => {
    latest = execution
  })
  return null
}

describe('useRoguelikeExecution startup notice', () => {
  beforeEach(() => {
    controllerState.current = idleState()
    messages.length = 0
    notifications.notifyProgress.mockReset()
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

  const renderHarness = async (controller: ExecutionController) => {
    await act(async () => {
      root.render(<Harness controller={controller} />)
    })
    await flush()
  }

  const startRun = async () => {
    await act(async () => {
      await latest?.execute({
        command: 'maa roguelike',
        params: '',
        taskConfig: null,
        taskName: '集成战略',
      })
    })
  }

  it('does not push a persistent progress notice when starting a run', async () => {
    const submitExecution = vi.fn(async () => ({ success: true, data: { runId: 'run-roguelike' } }))
    const controller = {
      getState: () => controllerState.current,
      subscribe: () => () => {},
      submitExecution,
    } as unknown as ExecutionController

    await renderHarness(controller)
    await startRun()

    expect(submitExecution).toHaveBeenCalledOnce()
    expect(notifications.notifyProgress).not.toHaveBeenCalled()
    expect(messages).toHaveLength(0)
  })

  it('still reports a rejected submission through the execution notice', async () => {
    const submitExecution = vi.fn(async () => ({ success: false, message: '设备忙' }))
    const controller = {
      getState: () => controllerState.current,
      subscribe: () => () => {},
      submitExecution,
    } as unknown as ExecutionController

    await renderHarness(controller)
    await startRun()

    expect(notifications.notifyProgress).not.toHaveBeenCalled()
    expect(messages).toContainEqual({
      message: '执行失败: 设备忙',
      type: 'error',
      options: { id: 'execution' },
    })
  })
})
