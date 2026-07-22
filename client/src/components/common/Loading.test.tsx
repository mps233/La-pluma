// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageSkeleton } from './Loading'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const renderSkeleton = async (variant: string) => {
  await act(async () => root.render(<PageSkeleton variant={variant} />))
}

describe('PageSkeleton', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mirrors the automation workspace and support rail', async () => {
    await renderSkeleton('automation')

    expect(container.querySelector('[aria-label="页面内容加载中"]')).not.toBeNull()
    expect(container.querySelector('.automation-workspace-grid')).not.toBeNull()
    expect(container.querySelector('.automation-support-column')).not.toBeNull()
    expect(container.querySelector('.automation-monitor-panel .aspect-video')).not.toBeNull()
    expect(container.querySelectorAll('.automation-monitor-skeleton-toolbar .rounded-full')).toHaveLength(5)
    expect(container.querySelectorAll('.surface-panel')).toHaveLength(4)
  })

  it('keeps dashboard material styling while data is loading', async () => {
    await renderSkeleton('dashboard')

    const page = container.querySelector('[aria-label="控制台加载中"]')
    expect(page?.classList.contains('dashboard-page')).toBe(true)
    expect(page?.querySelector('.dashboard-flow-card')).not.toBeNull()
    expect(page?.querySelectorAll('.dashboard-summary-card')).toHaveLength(4)
  })

  it('keeps the device preview aspect ratio for execution pages', async () => {
    await renderSkeleton('combat')

    expect(container.querySelector('.aspect-video')).not.toBeNull()
    expect(container.querySelectorAll('.surface-panel')).toHaveLength(2)
  })

  it('uses a dense log surface instead of a centered spinner', async () => {
    await renderSkeleton('logs')

    expect(container.querySelector('.surface-panel')).not.toBeNull()
    expect(container.querySelectorAll('.app-skeleton-shimmer').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.app-skeleton').length).toBeGreaterThan(10)
    expect(container.textContent).not.toContain('页面加载中')
  })
})
