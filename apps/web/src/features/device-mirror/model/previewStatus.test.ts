import { describe, expect, it } from 'vitest'
import { derivePreviewStatus, type PreviewStatusInput } from './previewStatus'

const base: PreviewStatusInput = {
  mode: 'off',
  available: true,
  paused: false,
  liveStatus: 'idle',
  liveError: null,
  snapshotHasImage: false,
  snapshotError: null,
  infrastructureError: null,
}

const derive = (overrides: Partial<PreviewStatusInput> = {}) => derivePreviewStatus({ ...base, ...overrides })

describe('derivePreviewStatus', () => {
  it('keeps the closed preview neutral even when infrastructure status fails', () => {
    const status = derive({ infrastructureError: '状态读取失败' })

    expect(status.phase).toBe('off')
    expect(status.label).toBe('预览已关闭')
    expect(status.error).toEqual({
      scope: 'infrastructure',
      title: '预览服务状态异常',
      message: '状态读取失败',
    })
    expect(status.retry).toEqual({ target: 'infrastructure', label: '刷新状态' })
    expect(status.hasFrame).toBe(false)
  })

  it('reports a paused page before live connection details', () => {
    const status = derive({ mode: 'live', liveStatus: 'connected', paused: true })

    expect(status.phase).toBe('paused')
    expect(status.label).toBe('后台已暂停')
    expect(status.hasFrame).toBe(false)
  })

  it('reports an unavailable automation service and hides stale live errors', () => {
    const status = derive({ mode: 'live', available: false, liveStatus: 'error', liveError: '信令失败' })

    expect(status.phase).toBe('unavailable')
    expect(status.label).toBe('自动化服务不可用')
    expect(status.error).toBeNull()
    expect(status.retry).toBeNull()
  })

  it('shows infrastructure failure while unavailable with an infrastructure retry', () => {
    const status = derive({
      mode: 'live',
      available: false,
      liveStatus: 'error',
      liveError: '信令失败',
      infrastructureError: 'Agent 未运行',
    })

    expect(status.phase).toBe('unavailable')
    expect(status.error?.scope).toBe('infrastructure')
    expect(status.error?.message).toBe('Agent 未运行')
    expect(status.retry).toEqual({ target: 'infrastructure', label: '刷新状态' })
  })

  it.each(['idle', 'connecting', 'signaling', 'waiting_offer', 'connecting_webrtc'] as const)(
    'treats live %s as connecting',
    liveStatus => {
      const status = derive({ mode: 'live', liveStatus })

      expect(status.phase).toBe('live-connecting')
      expect(status.label).toBe('正在连接实时画面')
      expect(status.tone).toBe('info')
      expect(status.retry).toBeNull()
    },
  )

  it('reports a connected live frame without an error surface', () => {
    const status = derive({ mode: 'live', liveStatus: 'connected' })

    expect(status.phase).toBe('live-connected')
    expect(status.label).toBe('实时画面')
    expect(status.tone).toBe('success')
    expect(status.hasFrame).toBe(true)
    expect(status.error).toBeNull()
  })

  it('prioritizes live startup errors and offers a live retry', () => {
    const status = derive({
      mode: 'live',
      liveStatus: 'error',
      liveError: '启动超时',
      snapshotError: null,
      infrastructureError: '状态读取失败',
    })

    expect(status.phase).toBe('live-error')
    expect(status.error?.scope).toBe('live')
    expect(status.retry).toEqual({ target: 'live', label: '重试' })
  })

  it('offers reconnection after a live disconnect', () => {
    const status = derive({ mode: 'live', liveStatus: 'disconnected' })

    expect(status.phase).toBe('live-disconnected')
    expect(status.error).toBeNull()
    expect(status.retry).toEqual({ target: 'live', label: '重新连接' })
  })

  it('keeps the last snapshot frame but marks it stale after a capture error', () => {
    const status = derive({ mode: 'snapshot', snapshotHasImage: true, snapshotError: '截图超时' })

    expect(status.phase).toBe('snapshot-stale')
    expect(status.snapshotStale).toBe(true)
    expect(status.hasFrame).toBe(true)
    expect(status.label).toBe('画面快照更新失败')
    expect(status.error?.scope).toBe('snapshot')
    expect(status.retry).toEqual({ target: 'snapshot', label: '重试' })
  })

  it('shows a snapshot error without a frame when no capture succeeded yet', () => {
    const status = derive({ mode: 'snapshot', snapshotError: '截图超时' })

    expect(status.phase).toBe('snapshot-error')
    expect(status.snapshotStale).toBe(false)
    expect(status.hasFrame).toBe(false)
  })

  it('derives the ready snapshot label from the capture interval', () => {
    const status = derive({ mode: 'snapshot', snapshotHasImage: true })

    expect(status.phase).toBe('snapshot-ready')
    expect(status.label).toBe('画面快照 · 10s')
    expect(status.error).toBeNull()
  })

  it('shows infrastructure errors above a live frame when available', () => {
    const status = derive({
      mode: 'live',
      liveStatus: 'connected',
      infrastructureError: '组件状态读取失败',
    })

    expect(status.phase).toBe('live-connected')
    expect(status.hasFrame).toBe(true)
    expect(status.error?.scope).toBe('infrastructure')
    expect(status.retry).toEqual({ target: 'infrastructure', label: '刷新状态' })
  })
})
