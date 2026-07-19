// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', () => ({
  MotionConfig: ({ children, reducedMotion }: { children: ReactNode; reducedMotion?: string }) => (
    <div data-testid="motion-config" data-reduced-motion={reducedMotion}>{children}</div>
  ),
}))

// App only needs the Framework7 application boundary here. The actual runtime
// singleton is covered by the browser smoke check, not this jsdom unit test.
vi.mock('./framework7', () => ({ default: {} }))
vi.mock('framework7-react', () => ({
  App: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    createElement('div', { ...props, 'data-framework7-app': 'true' }, children)
  ),
  Button: ({ children }: { children?: ReactNode }) => createElement('button', {}, children),
  Card: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
  CardHeader: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
  CardContent: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
}))

vi.mock('./stores', () => ({
  useUIStore: (selector: (state: { theme: 'dark' }) => unknown) => selector({ theme: 'dark' }),
}))

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: (props: { activeTab: string }) => ReactNode }) => children({ activeTab: 'dashboard' }),
}))
vi.mock('./components/PWAInstallPrompt', () => ({ default: () => null }))
vi.mock('./hooks/useBackendStatusMonitor', () => ({ useBackendStatusMonitor: () => undefined }))
vi.mock('./components/common', () => ({ PageSkeleton: ({ variant }: { variant: string }) => <div>{variant} skeleton</div> }))
vi.mock('./components/Dashboard', () => ({ default: () => <div>dashboard</div> }))

let container: HTMLDivElement
let root: Root

function mediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
}

describe('App motion preferences', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(mediaQueryList)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('delegates animation reduction to the user preference globally', async () => {
    await act(async () => root.render(<App />))
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="motion-config"]')?.getAttribute('data-reduced-motion')).toBe('user')
    expect(container.querySelector('[data-framework7-app]')?.className).toContain('la-pluma-framework7')
  })
})
