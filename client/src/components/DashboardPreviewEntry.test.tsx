// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPreviewEntry from './DashboardPreviewEntry'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.hoisted(() => ({
  mode: 'snapshot' as 'off' | 'snapshot' | 'live',
  fallbackSnapshot: 'data:image/png;base64,c25hcHNob3Q=',
  showLivePreview: false,
  isConnecting: false,
}))

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    mode: preview.mode,
    videoRef: { current: null },
    fallbackSnapshot: preview.fallbackSnapshot,
    showLivePreview: preview.showLivePreview,
    isConnecting: preview.isConnecting,
    statusText: '快照可用',
    headerStatusText: '已连接',
  }),
}))

vi.mock('./PreviewModeControls', () => ({
  default: () => <div>预览模式</div>,
  PreviewAutoStartSetting: () => <div>自动恢复</div>,
}))

vi.mock('./common', () => ({
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
    preview.mode = 'snapshot'
    preview.fallbackSnapshot = 'data:image/png;base64,c25hcHNob3Q='
    preview.showLivePreview = false
    preview.isConnecting = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the snapshot without navigating away from the overview', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('img[alt="模拟器画面快照"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="打开模拟器画面快照"]')).toBeNull()
    expect(container.querySelector('video')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a live video frame when available', async () => {
    preview.showLivePreview = true
    await act(async () => root.render(<DashboardPreviewEntry />))

    expect(container.querySelector('video')?.className).toContain('opacity-100')
  })

  it('activates the border beam only during WebRTC connection', async () => {
    preview.isConnecting = true
    await act(async () => root.render(<DashboardPreviewEntry key="connecting" />))

    const card = container.querySelector('[data-dashboard-preview-card]')
    expect(card?.classList.contains('status-border-beam')).toBe(true)
    expect(card?.classList.contains('is-active')).toBe(true)
    expect(card?.getAttribute('aria-busy')).toBe('true')

    preview.isConnecting = false
    await act(async () => root.render(<DashboardPreviewEntry key="idle" />))

    const updatedCard = container.querySelector('[data-dashboard-preview-card]')
    expect(updatedCard?.classList.contains('is-active')).toBe(false)
    expect(updatedCard?.getAttribute('aria-busy')).toBe('false')
  })
})
