// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', () => ({
  MotionConfig: ({ children, reducedMotion }: { children: ReactNode; reducedMotion?: string }) => (
    <div data-testid="motion-config" data-reduced-motion={reducedMotion}>{children}</div>
  ),
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

describe('App motion preferences', () => {
  beforeEach(() => {
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
  })
})
