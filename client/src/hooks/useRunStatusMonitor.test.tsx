// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_RUN_STATUS } from '../types/run'
import { useRunStore } from '../store/runStore'
import { useStatusStore } from '../store/statusStore'
import { useRunStatusMonitor } from './useRunStatusMonitor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getCurrentRun: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getCurrentRun: mocks.getCurrentRun,
  },
}))

function HookHarness() {
  useRunStatusMonitor()
  return null
}

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useRunStatusMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getCurrentRun.mockReset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
    useRunStore.getState().applyRun(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
    useRunStore.getState().applyRun(null)
  })

  it('projects an active Run into the global status store', async () => {
    mocks.getCurrentRun.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          operationId: 'run_copilot_set',
          state: 'running',
          progress: { currentTask: '理智作战', message: '正在执行: 理智作战' },
        },
        lastRun: null,
      },
    })

    await act(async () => root.render(<HookHarness />))
    await flush()

    expect(useStatusStore.getState().runStatus).toMatchObject({
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 理智作战',
    })
    expect(useRunStore.getState().run?.runId).toBe('run-1')
  })

  it('falls back to legacy task status when the operation has no Run', async () => {
    mocks.getCurrentRun.mockResolvedValue({
      success: true,
      data: {
        run: null,
        lastRun: null,
        isRunning: true,
        taskName: '作业集',
        currentStage: 'TL-2',
      },
    })

    await act(async () => root.render(<HookHarness />))
    await flush()

    expect(useStatusStore.getState().runStatus).toMatchObject({
      phase: 'running',
      isRunning: true,
      runId: null,
      label: '正在执行: TL-2',
    })
  })

  it('returns to idle when the Run is absent', async () => {
    mocks.getCurrentRun.mockResolvedValue({ success: true, data: { run: null, lastRun: null } })

    await act(async () => root.render(<HookHarness />))
    await flush()

    expect(useStatusStore.getState().runStatus.phase).toBe('idle')
    expect(useRunStore.getState().run).toBeNull()
  })

  it('polls again while a Run is active', async () => {
    mocks.getCurrentRun
      .mockResolvedValueOnce({
        success: true,
        data: {
          run: { runId: 'run-1', operationId: 'run_task', state: 'running', progress: {} },
          lastRun: null,
        },
      })
      .mockResolvedValue({ success: true, data: { run: null, lastRun: null } })

    await act(async () => root.render(<HookHarness />))
    await flush()
    expect(mocks.getCurrentRun).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await flush()

    expect(mocks.getCurrentRun).toHaveBeenCalledTimes(2)
    expect(useStatusStore.getState().runStatus.phase).toBe('idle')
  })

  it('marks an active observation as unknown after a transport failure without claiming it finished', async () => {
    mocks.getCurrentRun
      .mockResolvedValueOnce({
        success: true,
        data: {
          run: { runId: 'run-1', operationId: 'run_task', state: 'running', progress: {} },
          lastRun: null,
        },
      })
      .mockRejectedValue(new Error('网络错误'))

    await act(async () => root.render(<HookHarness />))
    await flush()
    expect(useStatusStore.getState().runStatus.isRunning).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await flush()

    expect(useStatusStore.getState().runStatus).toMatchObject({
      phase: 'unknown',
      isRunning: true,
      label: '执行状态未知',
    })
  })
})
