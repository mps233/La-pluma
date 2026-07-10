import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStatusStore } from './statusStore'

describe('statusStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
  })

  afterEach(() => {
    useStatusStore.getState().clearMessage()
    vi.useRealTimers()
  })

  it('does not let an older dismissal clear a newer message', () => {
    useStatusStore.getState().setMessage('配置已保存', 'success')
    vi.advanceTimersByTime(1000)

    useStatusStore.getState().setMessage('正在执行任务', 'info')
    vi.advanceTimersByTime(600)

    expect(useStatusStore.getState().message).toBe('正在执行任务')
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
})
