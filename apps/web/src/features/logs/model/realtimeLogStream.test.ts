// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REALTIME_LOG_INTERVAL_MS, REALTIME_LOG_LINES, RealtimeLogStream } from './realtimeLogStream'
import type { ApiResponse } from '@/shared/api'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const realtimeRow = (message: string) => ({
  time: '2026-07-22T10:11:12',
  level: 'INFO',
  message,
})

describe('RealtimeLogStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('reads 200 lines immediately and replaces the snapshot every 1250ms', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: true, data: [realtimeRow('first')] })
    const stream = new RealtimeLogStream({ read })
    expect(stream.getState().hasLoaded).toBe(false)

    stream.start()
    await flush()

    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]?.[0]).toBe(REALTIME_LOG_LINES)
    expect(stream.getState().hasLoaded).toBe(true)
    expect(stream.getState().logs).toMatchObject([{ time: '10:11:12', level: 'INFO', message: 'first' }])
    expect(stream.getState().error).toBeNull()

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)

    read.mockResolvedValue({ success: true, data: [realtimeRow('second')] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs).toMatchObject([{ time: '10:11:12', level: 'INFO', message: 'second' }])

    stream.stop()
  })

  it('marks the first empty snapshot as loaded', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: true, data: [] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()

    expect(stream.getState().hasLoaded).toBe(true)
    expect(stream.getState().logs).toEqual([])
    expect(stream.getState().error).toBeNull()
    stream.stop()
  })

  it('skips ticks while a slow request is in flight and resumes on the next tick', async () => {
    const slow = deferred<ApiResponse<unknown>>()
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ success: true, data: [realtimeRow('next')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS * 4)
    expect(read).toHaveBeenCalledTimes(1)

    slow.resolve({ success: true, data: [realtimeRow('slow')] })
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('slow')

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(stream.getState().logs[0]?.message).toBe('next')

    stream.stop()
  })

  it('discards a stale response from before the page was hidden', async () => {
    const first = deferred<ApiResponse<unknown>>()
    const second = deferred<ApiResponse<unknown>>()
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const stream = new RealtimeLogStream({ read })

    stream.start()
    const firstSignal = read.mock.calls[0]?.[1]
    stream.stop()
    expect(firstSignal?.aborted).toBe(true)

    stream.start()
    expect(read).toHaveBeenCalledTimes(2)

    second.resolve({ success: true, data: [realtimeRow('current')] })
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('current')

    first.resolve({ success: true, data: [realtimeRow('stale')] })
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('current')

    stream.stop()
  })

  it('keeps the buffer on failure and clears the error after the next success', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('保留')] })
      .mockResolvedValueOnce({ success: false, message: '后台刷新暂不可用' })
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('恢复')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('保留')

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('保留')
    expect(stream.getState().error).toBe('后台刷新暂不可用')

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('恢复')
    expect(stream.getState().error).toBeNull()

    stream.stop()
  })

  it('does not publish an identical refresh failure twice', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: false, message: '后台刷新暂不可用' })
    const stream = new RealtimeLogStream({ read })
    const listener = vi.fn()
    stream.subscribe(listener)

    stream.start()
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(stream.getState().error).toBe('后台刷新暂不可用')

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)

    stream.stop()
  })

  it('keeps the observed window when a successful response has an invalid payload', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('保留')] })
      .mockResolvedValueOnce({ success: true, data: { logs: [] } })
      .mockResolvedValue({ success: true, data: [] })
    const stream = new RealtimeLogStream({ read })
    stream.start()
    await flush()
    const observed = stream.getState().logs
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs).toBe(observed)
    expect(stream.getState().error).toContain('格式无效')
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs).toEqual([])
    expect(stream.getState().error).toBeNull()
    stream.stop()
  })

  it('aborts an in-flight read while the document is hidden and reads immediately when visible', async () => {
    const hiddenRead = deferred<ApiResponse<unknown>>()
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('visible')] })
      .mockReturnValueOnce(hiddenRead.promise)
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('restored')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    const hiddenSignal = read.mock.calls[1]?.[1]

    stream.setDocumentVisible(false)
    expect(hiddenSignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS * 4)
    expect(read).toHaveBeenCalledTimes(2)

    stream.setDocumentVisible(true)
    expect(read).toHaveBeenCalledTimes(3)
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('restored')

    hiddenRead.resolve({ success: true, data: [realtimeRow('stale-hidden')] })
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('restored')

    stream.stop()
  })

  it('pauses across visibility changes and reads immediately on manual resume', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: true, data: [realtimeRow('paused-snapshot')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    expect(read).toHaveBeenCalledTimes(1)

    stream.pause()
    expect(stream.getState().paused).toBe(true)
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS * 4)
    expect(read).toHaveBeenCalledTimes(1)

    stream.setDocumentVisible(false)
    stream.setDocumentVisible(true)
    stream.stop()
    stream.start()
    expect(stream.getState().paused).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)

    stream.resume()
    expect(stream.getState().paused).toBe(false)
    expect(read).toHaveBeenCalledTimes(2)
    await flush()

    stream.clear()
    expect(stream.getState().logs).toEqual([])
    expect(stream.getState().error).toBeNull()

    stream.stop()
  })

  it('cancels an in-flight read when manually paused', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ success: true, data: [realtimeRow('resumed')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    const signal = read.mock.calls[0]?.[1]
    stream.pause()
    expect(signal?.aborted).toBe(true)

    pending.resolve({ success: true, data: [realtimeRow('stale-pause')] })
    await flush()
    expect(stream.getState().logs).toEqual([])

    stream.resume()
    await flush()
    expect(stream.getState().logs[0]?.message).toBe('resumed')

    stream.stop()
  })

  it('does not poll while stopped and refreshes immediately on restart', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: true, data: [realtimeRow('once')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    stream.stop()

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS * 4)
    expect(read).toHaveBeenCalledTimes(1)

    stream.start()
    expect(read).toHaveBeenCalledTimes(2)
    await flush()

    stream.stop()
  })

  it('keeps the run identity from server entries and re-commits when it changes', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({
        success: true,
        data: [{
          time: '2026-07-22T10:11:12',
          level: 'INFO',
          message: '执行输出',
          runId: 'run-1',
          operationId: 'op-1',
        }],
      })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    expect(stream.getState().logs).toMatchObject([{
      time: '10:11:12',
      level: 'INFO',
      message: '执行输出',
      runId: 'run-1',
      operationId: 'op-1',
    }])

    read.mockResolvedValue({
      success: true,
      data: [{
        time: '2026-07-22T10:11:12',
        level: 'INFO',
        message: '执行输出',
        runId: 'run-2',
        operationId: 'op-1',
      }],
    })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs[0]?.runId).toBe('run-2')

    read.mockResolvedValue({
      success: true,
      data: [{ time: '2026-07-22T10:11:12', level: 'INFO', message: '无归属', runId: 7 }],
    })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs).toMatchObject([{ time: '10:11:12', level: 'INFO', message: '无归属' }])

    stream.stop()
  })

  it('keeps the logs reference and skips listeners when a poll returns identical content', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValue({ success: true, data: [realtimeRow('same'), realtimeRow('稳定')] })
    const stream = new RealtimeLogStream({ read })
    const listener = vi.fn()
    stream.subscribe(listener)

    stream.start()
    await flush()
    const unchangedLogs = stream.getState().logs
    expect(unchangedLogs).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(stream.getState().logs).toBe(unchangedLogs)
    expect(listener).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs).toBe(unchangedLogs)
    expect(listener).toHaveBeenCalledTimes(1)

    read.mockResolvedValue({ success: true, data: [realtimeRow('same'), realtimeRow('变化')] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().logs).not.toBe(unchangedLogs)
    expect(stream.getState().logs[1]?.message).toBe('变化')
    expect(listener).toHaveBeenCalledTimes(2)

    stream.stop()
  })

  it('still clears an error while keeping the logs reference when identical content follows a failure', async () => {
    const read = vi.fn<(lines: number, signal?: AbortSignal) => Promise<ApiResponse<unknown>>>()
      .mockResolvedValueOnce({ success: true, data: [realtimeRow('保留')] })
      .mockResolvedValueOnce({ success: false, message: '后台刷新暂不可用' })
      .mockResolvedValue({ success: true, data: [realtimeRow('保留')] })
    const stream = new RealtimeLogStream({ read })

    stream.start()
    await flush()
    const unchangedLogs = stream.getState().logs

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().error).toBe('后台刷新暂不可用')
    expect(stream.getState().logs).toBe(unchangedLogs)

    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    await flush()
    expect(stream.getState().error).toBeNull()
    expect(stream.getState().logs).toBe(unchangedLogs)

    stream.stop()
  })
  it('clears only local visibility and keeps cleared records hidden on later polls', async () => {
    const first = { ...realtimeRow('old'), id: 'source:1', sequence: 1 }
    const next = { ...realtimeRow('new'), id: 'source:2', sequence: 2 }
    const read = vi.fn().mockResolvedValue({ success: true, data: [first] })
    const stream = new RealtimeLogStream({ read })
    stream.start()
    await flush()
    stream.clear()
    expect(stream.getState().logs).toEqual([])
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs).toEqual([])
    read.mockResolvedValue({ success: true, data: [first, next] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs.map(log => log.id)).toEqual(['source:2'])
    expect(stream.getState().coverageNotice).toBeNull()
    stream.reset()
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs.map(log => log.id)).toEqual(['source:1', 'source:2'])
    stream.stop()
  })

  it('reports missed windows and server restarts without claiming full coverage', async () => {
    const row = (source: string, sequence: number) => ({ ...realtimeRow('same'), id: `${source}:${sequence}`, sequence })
    const read = vi.fn().mockResolvedValue({ success: true, data: [row('source', 1)] })
    const stream = new RealtimeLogStream({ read })
    stream.start()
    await flush()
    read.mockResolvedValue({ success: true, data: [row('source', 2)] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().coverageNotice).toBeNull()
    read.mockResolvedValue({ success: true, data: [row('source', 5)] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().coverageNotice).toContain('失去连续性')
    stream.reset()
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    read.mockResolvedValue({ success: true, data: [] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().logs).toEqual([])
    read.mockResolvedValue({ success: true, data: [row('restart', 1)] })
    await vi.advanceTimersByTimeAsync(REALTIME_LOG_INTERVAL_MS)
    expect(stream.getState().coverageNotice).toContain('失去连续性')
    stream.stop()
  })

})
