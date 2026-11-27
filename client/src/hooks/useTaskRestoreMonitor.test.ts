// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskRestoreMonitor } from './useTaskRestoreMonitor'

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: mocks.getTaskStatus,
  },
}))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const createOptions = () => ({
  taskType: 'combat',
  setRunning: vi.fn(),
  setActiveStatus: vi.fn(),
  setStatusMessage: vi.fn(),
  unreachableWarning: '暂时无法确认作业状态',
})

describe('useTaskRestoreMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getTaskStatus.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('restores a matching running task and stops polling when it finishes', async () => {
    const options = createOptions()
    mocks.getTaskStatus
      .mockResolvedValueOnce({
        success: true,
        data: { isRunning: true, taskType: 'combat', taskName: '理智作战', startTime: Date.now() },
      })
      .mockResolvedValueOnce({ success: true, data: { isRunning: false } })

    renderHook(() => useTaskRestoreMonitor(options))
    await flush()

    expect(options.setRunning).toHaveBeenLastCalledWith(true)
    expect(options.setActiveStatus).toHaveBeenLastCalledWith(true)
    expect(options.setStatusMessage).toHaveBeenCalledWith('正在执行: 理智作战')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(options.setRunning).toHaveBeenLastCalledWith(false)
    expect(options.setStatusMessage).toHaveBeenLastCalledWith('任务已完成')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(2)
  })

  it('clears the running flag without polling for another task type', async () => {
    const options = createOptions()
    mocks.getTaskStatus.mockResolvedValue({
      success: true,
      data: { isRunning: true, taskType: 'roguelike', taskName: '集成战略', startTime: Date.now() },
    })

    renderHook(() => useTaskRestoreMonitor(options))
    await flush()

    expect(options.setRunning).toHaveBeenLastCalledWith(false)
    expect(options.setStatusMessage).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(1)
  })

  it('announces a possibly stale run after five minutes', async () => {
    const options = createOptions()
    mocks.getTaskStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        taskType: 'combat',
        taskName: '理智作战',
        startTime: Date.now() - 10 * 60 * 1000,
      },
    })

    renderHook(() => useTaskRestoreMonitor(options))
    await flush()

    expect(options.setStatusMessage.mock.calls[0][0]).toContain('可能已完成')
  })

  it('warns after three consecutive poll failures', async () => {
    const options = createOptions()
    mocks.getTaskStatus
      .mockResolvedValueOnce({
        success: true,
        data: { isRunning: true, taskType: 'combat', taskName: '理智作战', startTime: Date.now() },
      })
      .mockRejectedValue(new Error('offline'))

    renderHook(() => useTaskRestoreMonitor(options))
    await flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 * 3)
    })

    expect(options.setStatusMessage).toHaveBeenLastCalledWith('暂时无法确认作业状态', 'warning')
  })
})
