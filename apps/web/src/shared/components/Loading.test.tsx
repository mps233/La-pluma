// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageSkeleton } from './Loading'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

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

  it('exposes the placeholder as a busy region and hides its chrome', async () => {
    await act(async () => root.render(<PageSkeleton variant="automation" />))

    const region = container.querySelector<HTMLElement>('[aria-busy="true"][aria-label="页面内容加载中"]')
    expect(region).not.toBeNull()
    expect(region?.dataset.pageKind).toBe('automation')
    expect(region?.dataset.pageLayout).toBe('workspace')
    expect(region?.dataset.pageSurface).toBe('borderless')
    expect(region?.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(region?.querySelector('h1')).toBeNull()
  })

  it('keeps training as a workspace skeleton without borderless surfaces', async () => {
    await act(async () => root.render(<PageSkeleton variant="training" />))

    const region = container.querySelector<HTMLElement>('[aria-busy="true"]')
    expect(region?.dataset.pageKind).toBe('training')
    expect(region?.dataset.pageLayout).toBe('workspace')
    expect(region?.hasAttribute('data-page-surface')).toBe(false)
  })
})
