// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardSkeleton } from './DashboardSkeleton'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('DashboardSkeleton', () => {
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

  it('announces a busy dashboard and hides placeholder chrome from assistive tech', async () => {
    await act(async () => root.render(<DashboardSkeleton />))

    const region = container.querySelector<HTMLElement>('[data-region="page"]')
    expect(region?.dataset.pageKind).toBe('dashboard')
    expect(region?.getAttribute('aria-busy')).toBe('true')
    expect(region?.getAttribute('aria-label')).toBe('概览加载中')
    expect(region?.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(region?.querySelector('h1')).toBeNull()
  })
})
