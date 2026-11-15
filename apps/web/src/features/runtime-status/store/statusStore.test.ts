import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalRunStatus } from '@/features/task-execution'
import { useStatusStore } from './statusStore'

const IDLE: GlobalRunStatus = { phase: 'idle', isRunning: false, runId: null, label: null, detail: null }
const RUNNING: GlobalRunStatus = {
  phase: 'running',
  isRunning: true,
  runId: 'run-1',
  label: '正在执行: 收取信用',
  detail: '今日流程执行中',
}

describe('statusStore', () => {
  beforeEach(() => {
    useStatusStore.getState().applyRunStatus(IDLE)
    useStatusStore.getState().setBackendStatus('unknown')
  })

  it('applies a distinct run projection', () => {
    useStatusStore.getState().applyRunStatus(RUNNING)

    expect(useStatusStore.getState().runStatus).toEqual(RUNNING)
  })

  it('ignores a projection identical to the current one', () => {
    useStatusStore.getState().applyRunStatus(RUNNING)
    const subscriber = vi.fn()
    const unsubscribe = useStatusStore.subscribe(subscriber)

    useStatusStore.getState().applyRunStatus({ ...RUNNING })

    expect(subscriber).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps backend availability separate from the run projection', () => {
    useStatusStore.getState().setBackendStatus('unavailable', '无法连接后端服务')
    useStatusStore.getState().applyRunStatus(RUNNING)

    expect(useStatusStore.getState().backendStatus).toBe('unavailable')
    expect(useStatusStore.getState().backendMessage).toBe('无法连接后端服务')
    expect(useStatusStore.getState().runStatus).toEqual(RUNNING)
  })

  it('ignores identical backend status writes', () => {
    useStatusStore.getState().setBackendStatus('available')
    const subscriber = vi.fn()
    const unsubscribe = useStatusStore.subscribe(subscriber)

    useStatusStore.getState().setBackendStatus('available')

    expect(subscriber).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('clears the backend message when availability changes without one', () => {
    useStatusStore.getState().setBackendStatus('unavailable', '无法连接后端服务')
    useStatusStore.getState().setBackendStatus('available')

    expect(useStatusStore.getState().backendStatus).toBe('available')
    expect(useStatusStore.getState().backendMessage).toBe('')
  })
})
