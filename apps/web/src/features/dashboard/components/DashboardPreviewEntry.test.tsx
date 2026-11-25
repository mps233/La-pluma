// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPreviewEntry from './DashboardPreviewEntry'
import { usePreviewStore, type PreviewStatus } from '@/features/device-mirror'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.hoisted(() => ({
  fallbackSnapshot: 'data:image/png;base64,c25hcHNob3Q=' as string | null,
  isConnecting: false,
  status: {} as PreviewStatus,
  retry: vi.fn(),
  available: true,
}))

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    videoRef: { current: null },
    fallbackSnapshot: preview.fallbackSnapshot,
    isConnecting: preview.isConnecting,
    status: preview.status,
    retry: preview.retry,
    available: preview.available,
  }),
}))

let container: HTMLDivElement
let root: Root

const makeStatus = (overrides: Partial<PreviewStatus> = {}): PreviewStatus => ({
  phase: 'snapshot-ready',
  label: '画面快照 · 10s',
  emptyTitle: '画面快照',
  tone: 'info',
  error: null,
  retry: null,
  hasFrame: true,
  snapshotStale: false,
  ...overrides,
})

describe('DashboardPreviewEntry', () => {
  beforeEach(() => {
    preview.fallbackSnapshot = 'data:image/png;base64,c25hcHNob3Q='
    preview.isConnecting = false
    preview.status = makeStatus()
    preview.available = true
    preview.retry.mockReset()
    usePreviewStore.setState({ mode: 'off' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the closed preview without a recovery action', async () => {
    preview.fallbackSnapshot = null
    preview.status = makeStatus({
      phase: 'off',
      label: '预览已关闭',
      emptyTitle: '预览已关闭',
      tone: 'neutral',
      hasFrame: false,
    })
    await act(async () => root.render(<DashboardPreviewEntry />))

    const frame = container.querySelector('[data-dashboard-preview-frame]')
    expect(frame?.textContent).toContain('预览已关闭')
    expect(frame?.querySelector('button')).toBeNull()
    expect(container.querySelector('video')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('marks the preview card busy while WebRTC connects', async () => {
    preview.isConnecting = true
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('[data-dashboard-preview-card]')?.getAttribute('aria-busy')).toBe('true')
  })

  it('names the preview card header and announces the shared status', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.textContent).toContain('画面预览')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('画面快照 · 10s')
  })

  it('reflects the shared status phase and label', async () => {
    preview.fallbackSnapshot = null
    preview.status = makeStatus({
      phase: 'off',
      label: '预览已关闭',
      emptyTitle: '预览已关闭',
      tone: 'neutral',
      hasFrame: false,
    })
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('[data-preview-status="off"]')).not.toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('预览已关闭')

    await act(async () => root.unmount())
    root = createRoot(container)
    preview.status = makeStatus({
      phase: 'live-connected',
      label: '实时画面',
      emptyTitle: '实时画面',
      tone: 'success',
    })
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('[data-preview-status="live-connected"]')).not.toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('实时画面')
  })

  it('switches preview mode through the compact segmented control', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    const group = container.querySelector('[role="group"][aria-label="预览模式"]')
    expect(group).not.toBeNull()
    const live = Array.from(group?.querySelectorAll('button') || []).find(button => button.textContent === '实时')
    expect(live?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => live?.click())

    expect(usePreviewStore.getState().mode).toBe('live')
    expect(live?.getAttribute('aria-pressed')).toBe('true')
  })

  it('disables snapshot and live modes while automation is unavailable', async () => {
    preview.available = false
    await act(async () => root.render(<DashboardPreviewEntry />))

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-pressed]'))
    expect(buttons.find(button => button.textContent === '关闭')?.disabled).toBe(false)
    expect(buttons.find(button => button.textContent === '快照')?.disabled).toBe(true)
    expect(buttons.find(button => button.textContent === '实时')?.disabled).toBe(true)
  })

  it('offers the same retry action in the error empty state', async () => {
    preview.fallbackSnapshot = null
    preview.status = makeStatus({
      phase: 'snapshot-error',
      label: '画面快照失败',
      emptyTitle: '画面快照失败',
      tone: 'danger',
      error: { scope: 'snapshot', title: '画面快照失败', message: '服务器内部错误' },
      retry: { target: 'snapshot', label: '重试' },
      hasFrame: false,
    })
    await act(async () => root.render(<DashboardPreviewEntry />))

    const error = container.querySelector('[role="alert"]')
    expect(error?.textContent).toContain('服务器内部错误')
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '重试')
    expect(retry).not.toBeUndefined()
    await act(async () => retry?.click())
    expect(preview.retry).toHaveBeenCalledOnce()
  })

  it('keeps a stale snapshot visible with a warning and an alert retry', async () => {
    preview.status = makeStatus({
      phase: 'snapshot-stale',
      label: '画面快照更新失败',
      emptyTitle: '画面快照更新失败',
      tone: 'danger',
      error: { scope: 'snapshot', title: '画面快照失败', message: '截图超时' },
      retry: { target: 'snapshot', label: '重试' },
      snapshotStale: true,
    })
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('img')?.getAttribute('src')).toBe(preview.fallbackSnapshot)
    expect(container.textContent).toContain('上次成功画面 · 可能已过期')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('截图超时')
    expect(Array.from(container.querySelectorAll('button')).filter(button => button.textContent === '重试')).toHaveLength(1)
  })
})
