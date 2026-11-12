// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPreviewEntry from './DashboardPreviewEntry'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.hoisted(() => ({
  mode: 'snapshot' as 'off' | 'snapshot' | 'live',
  fallbackSnapshot: 'data:image/png;base64,c25hcHNob3Q=' as string | null,
  showLivePreview: false,
  isConnecting: false,
  inputReady: true,
  sendTouch: vi.fn(() => true),
  sendScroll: vi.fn(() => true),
}))

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    mode: preview.mode,
    videoRef: { current: null },
    fallbackSnapshot: preview.fallbackSnapshot,
    showLivePreview: preview.showLivePreview,
    inputReady: preview.inputReady,
    sendTouch: preview.sendTouch,
    sendScroll: preview.sendScroll,
    isConnecting: preview.isConnecting,
    statusText: '快照可用',
    headerStatusText: '已连接',
  }),
}))

vi.mock('./PreviewModeControls', () => ({
  default: () => <div>预览模式</div>,
  PreviewAutoStartToggle: () => <div>自动恢复</div>,
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
    preview.inputReady = true
    preview.sendTouch.mockClear()
    preview.sendScroll.mockClear()
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

  it('forwards pointer input when a live frame is visible', async () => {
    preview.mode = 'live'
    preview.showLivePreview = true
    preview.fallbackSnapshot = null
    await act(async () => root.render(<DashboardPreviewEntry />))

    const video = container.querySelector('video')!
    Object.assign(video, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 60, button: 0 })
    Object.defineProperty(down, 'pointerId', { value: 3 })
    act(() => video.dispatchEvent(down))

    expect(preview.sendTouch).toHaveBeenCalledWith(0, 40, 60, 3, video)
    expect(video.getAttribute('aria-hidden')).toBeNull()
    expect(video.className).toContain('touch-none')
  })

  it('keeps the snapshot frame view-only', async () => {
    await act(async () => root.render(<DashboardPreviewEntry />))

    const video = container.querySelector('video')!
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 20, button: 0 })
    Object.defineProperty(down, 'pointerId', { value: 4 })
    act(() => video.dispatchEvent(down))

    expect(preview.sendTouch).not.toHaveBeenCalled()
    expect(video.getAttribute('aria-hidden')).toBe('true')
    expect(video.className).toContain('pointer-events-none')
  })

  it('keeps the auto-start toggle anchored after the reconnect control', async () => {
    preview.mode = 'live'
    preview.showLivePreview = false
    await act(async () => root.render(<DashboardPreviewEntry />))

    const group = container.querySelector('.scrcpy-view-header > div:last-child')
    expect(group?.querySelector('button[aria-label="重连预览"]')).not.toBeNull()
    expect(group?.lastElementChild?.textContent).toBe('自动恢复')
  })

  it('activates the border beam only during WebRTC connection', async () => {
    preview.isConnecting = true
    await act(async () => root.render(<DashboardPreviewEntry key="connecting" />))

    const card = container.querySelector('[data-dashboard-preview-card]')
    const frame = container.querySelector('[data-dashboard-preview-frame]')
    expect(card?.getAttribute('aria-busy')).toBe('true')
    expect(frame?.classList.contains('status-border-beam')).toBe(true)
    expect(frame?.classList.contains('is-active')).toBe(true)

    preview.isConnecting = false
    await act(async () => root.render(<DashboardPreviewEntry key="idle" />))

    const updatedCard = container.querySelector('[data-dashboard-preview-card]')
    const updatedFrame = container.querySelector('[data-dashboard-preview-frame]')
    expect(updatedCard?.getAttribute('aria-busy')).toBe('false')
    expect(updatedFrame?.classList.contains('is-active')).toBe(false)
  })
})
