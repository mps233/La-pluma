// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPreviewEntry from './DashboardPreviewEntry'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.hoisted(() => ({
  fallbackSnapshot: 'data:image/png;base64,c25hcHNob3Q=',
  showLivePreview: false,
  isConnecting: false,
}))

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    videoRef: { current: null },
    fallbackSnapshot: preview.fallbackSnapshot,
    showLivePreview: preview.showLivePreview,
    isConnecting: preview.isConnecting,
    statusText: '快照可用',
    headerStatusText: '已连接',
  }),
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

  it('names the full-frame snapshot action and opens the preview', async () => {
    const onOpen = vi.fn()
    await act(async () => root.render(<DashboardPreviewEntry onOpen={onOpen} />))

    const frameButton = container.querySelector<HTMLButtonElement>('button[aria-label="打开模拟器画面快照"]')
    expect(frameButton).not.toBeNull()
    await act(async () => frameButton?.click())
    expect(onOpen).toHaveBeenCalledOnce()
    expect(container.querySelector('video')?.getAttribute('aria-hidden')).toBe('true')
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === '打开')?.classList.contains('min-h-11')).toBe(true)
  })

  it('uses a live-preview name while video is available', async () => {
    preview.showLivePreview = true
    await act(async () => root.render(<DashboardPreviewEntry onOpen={vi.fn()} />))

    expect(container.querySelector('button[aria-label="打开模拟器实时预览"]')).not.toBeNull()
  })

  it('activates the border beam only during WebRTC connection', async () => {
    preview.isConnecting = true
    await act(async () => root.render(<DashboardPreviewEntry onOpen={vi.fn()} />))

    const card = container.querySelector('[data-dashboard-preview-card]')
    expect(card?.classList.contains('status-border-beam')).toBe(true)
    expect(card?.classList.contains('is-active')).toBe(true)
    expect(card?.getAttribute('aria-busy')).toBe('true')

    preview.isConnecting = false
    await act(async () => root.render(<DashboardPreviewEntry onOpen={vi.fn()} />))

    expect(card?.classList.contains('is-active')).toBe(false)
    expect(card?.getAttribute('aria-busy')).toBe('false')
  })
})
