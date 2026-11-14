// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPreviewEntry from './DashboardPreviewEntry'
import { usePreviewStore } from '@/features/device-mirror'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.hoisted(() => ({
  fallbackSnapshot: 'data:image/png;base64,c25hcHNob3Q=' as string | null,
  showLivePreview: false,
  isConnecting: false,
  connectionState: 'snapshot' as 'off' | 'connecting' | 'snapshot' | 'live' | 'idle' | 'error',
  statusText: '快照可用',
  available: true,
}))

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    videoRef: { current: null },
    fallbackSnapshot: preview.fallbackSnapshot,
    showLivePreview: preview.showLivePreview,
    isConnecting: preview.isConnecting,
    connectionState: preview.connectionState,
    statusText: preview.statusText,
    headerStatusText: '已连接',
    retry: vi.fn(),
    error: null,
    available: preview.available,
  }),
}))

vi.mock('@/shared/components', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  SmoothPanel: ({
    children,
    className = '',
    surfaceClassName = '',
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { surfaceClassName?: string }) => (
    <div className={`smooth-panel-shell ${className}`} {...props}>
      <div className={`smooth-panel-surface ${surfaceClassName}`}>{children}</div>
    </div>
  ),
}))

let container: HTMLDivElement
let root: Root

describe('DashboardPreviewEntry', () => {
  beforeEach(() => {
    preview.fallbackSnapshot = 'data:image/png;base64,c25hcHNob3Q='
    preview.showLivePreview = false
    preview.isConnecting = false
    preview.connectionState = 'snapshot'
    preview.statusText = '快照可用'
    preview.available = true
    usePreviewStore.setState({ mode: 'off' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the closed preview without a navigation action', async () => {
    preview.fallbackSnapshot = null
    preview.connectionState = 'off'
    preview.statusText = '预览已关闭'
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

  it('names the preview card header', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.textContent).toContain('画面预览')
  })

  it('names the status light from the connection state', async () => {
    preview.fallbackSnapshot = null
    preview.connectionState = 'off'
    preview.statusText = '预览已关闭'
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('[data-preview-status="off"]')?.getAttribute('aria-label')).toBe('预览已关闭')

    await act(async () => root.unmount())
    root = createRoot(container)
    preview.connectionState = 'live'
    preview.statusText = '实时画面'
    preview.showLivePreview = true
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('[data-preview-status="live"]')?.getAttribute('aria-label')).toBe('实时画面')
  })

  it('switches preview mode through the compact segmented control', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    const group = container.querySelector('[role="radiogroup"][aria-label="预览模式"]')
    expect(group).not.toBeNull()
    expect(group?.getAttribute('data-active-index')).toBe('0')
    const live = Array.from(group?.querySelectorAll('button') || []).find(button => button.textContent === '实时')
    expect(live?.getAttribute('aria-checked')).toBe('false')

    await act(async () => live?.click())

    expect(usePreviewStore.getState().mode).toBe('live')
    expect(group?.getAttribute('data-active-index')).toBe('2')
  })

  it('disables snapshot and live modes while automation is unavailable', async () => {
    preview.available = false
    await act(async () => root.render(<DashboardPreviewEntry />))

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    expect(buttons.find(button => button.textContent === '关闭')?.disabled).toBe(false)
    expect(buttons.find(button => button.textContent === '快照')?.disabled).toBe(true)
    expect(buttons.find(button => button.textContent === '实时')?.disabled).toBe(true)
  })
})
