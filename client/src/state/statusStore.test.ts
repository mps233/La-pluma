import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_RUN_STATUS } from '../types/run'
import { useStatusStore } from './statusStore'

describe('statusStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
    useStatusStore.getState().setBackendStatus('unknown')
  })

  afterEach(() => {
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
    useStatusStore.getState().setBackendStatus('unknown')
    vi.useRealTimers()
  })

  it('does not let an older dismissal clear a newer message', () => {
    useStatusStore.getState().setMessage('配置已保存', 'success')
    vi.advanceTimersByTime(1000)

    useStatusStore.getState().setMessage('正在执行任务', 'info')
    vi.advanceTimersByTime(600)

    expect(useStatusStore.getState().message).toBe('正在执行任务')
  })

  it('keeps errors visible until the user dismisses them', () => {
    useStatusStore.getState().setMessage('连接失败', 'error')
    vi.advanceTimersByTime(60000)

    expect(useStatusStore.getState().message).toBe('连接失败')
    useStatusStore.getState().clearMessage()
    expect(useStatusStore.getState().message).toBe('')
  })

  it('ignores legacy delayed empty-message clears', () => {
    useStatusStore.getState().setMessage('旧提示', 'success')
    useStatusStore.getState().setMessage('新提示', 'error')
    useStatusStore.getState().setMessage('')

    expect(useStatusStore.getState().message).toBe('新提示')
  })

  it('keeps active messages until execution becomes inactive', () => {
    useStatusStore.getState().setActive(true)
    useStatusStore.getState().setMessage('正在执行任务', 'info')
    vi.advanceTimersByTime(20000)

    expect(useStatusStore.getState().message).toBe('正在执行任务')

    useStatusStore.getState().setActive(false)
    vi.advanceTimersByTime(10000)
    expect(useStatusStore.getState().message).toBe('')
  })

  it('does not postpone dismissal when inactive state is reported repeatedly', () => {
    useStatusStore.getState().setMessage('配置已保存', 'success')
    vi.advanceTimersByTime(1000)
    useStatusStore.getState().setActive(false)
    vi.advanceTimersByTime(500)

    expect(useStatusStore.getState().message).toBe('')
  })

  it('projects the active Run and keeps messages visible until it becomes idle', () => {
    useStatusStore.getState().applyRunStatus({
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 理智作战',
      detail: null,
    })
    useStatusStore.getState().setMessage('正在执行任务', 'info')
    vi.advanceTimersByTime(20_000)

    expect(useStatusStore.getState().message).toBe('正在执行任务')
    expect(useStatusStore.getState().runStatus.label).toBe('正在执行: 理智作战')

    useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
    vi.advanceTimersByTime(10_000)

    expect(useStatusStore.getState().message).toBe('')
    expect(useStatusStore.getState().runStatus.phase).toBe('idle')
  })

  it('keeps backend availability separate from temporary messages', () => {
    useStatusStore.getState().setBackendStatus('unavailable', '无法连接后端服务')
    useStatusStore.getState().setMessage('正在刷新', 'info')

    vi.advanceTimersByTime(20000)

    expect(useStatusStore.getState().message).toBe('')
    expect(useStatusStore.getState().backendStatus).toBe('unavailable')
    expect(useStatusStore.getState().backendMessage).toBe('无法连接后端服务')

    useStatusStore.getState().setBackendStatus('available')
    expect(useStatusStore.getState().backendMessage).toBe('')
  })
})
