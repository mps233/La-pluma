// @vitest-environment jsdom

import { act, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const appMocks = vi.hoisted(() => ({
  navigate: null as null | ((tab: string) => void),
  dashboardEffectStarts: 0,
  dashboardEffectStops: 0,
  automationEffectStarts: 0,
  automationEffectStops: 0,
  dashboardShouldThrow: false,
  automationShouldThrow: false,
}))

vi.mock('framer-motion', () => ({
  MotionConfig: ({ children, reducedMotion }: { children: ReactNode; reducedMotion?: string }) => (
    <div data-testid="motion-config" data-reduced-motion={reducedMotion}>{children}</div>
  ),
}))

vi.mock('./stores', () => ({
  useUIStore: (selector: (state: { theme: 'dark' }) => unknown) => selector({ theme: 'dark' }),
}))

vi.mock('./components/Layout', () => ({
  default: function MockLayout({ children }: { children: (props: { activeTab: string }) => ReactNode }) {
    const [activeTab, setActiveTab] = useState('dashboard')
    appMocks.navigate = setActiveTab
    return children({ activeTab })
  },
}))
vi.mock('./components/PWAInstallPrompt', () => ({ default: () => null }))
vi.mock('./hooks/useBackendStatusMonitor', () => ({ useBackendStatusMonitor: () => undefined }))
vi.mock('./components/common', () => ({ PageSkeleton: ({ variant }: { variant: string }) => <div>{variant} skeleton</div> }))
vi.mock('./components/Dashboard', () => ({
  default: function MockDashboard() {
    if (appMocks.dashboardShouldThrow) throw new Error('dashboard render failed')
    const [draft, setDraft] = useState('')
    useEffect(() => {
      appMocks.dashboardEffectStarts += 1
      return () => {
        appMocks.dashboardEffectStops += 1
      }
    }, [])
    return <input aria-label="控制台草稿" value={draft} onChange={event => setDraft(event.target.value)} />
  },
}))
vi.mock('./components/AutomationTasks', () => ({
  default: function MockAutomationTasks() {
    if (appMocks.automationShouldThrow) throw new Error('automation render failed')
    useEffect(() => {
      appMocks.automationEffectStarts += 1
      return () => {
        appMocks.automationEffectStops += 1
      }
    }, [])
    return <div>automation</div>
  },
}))
vi.mock('./components/CombatTasks', () => ({ default: () => <div>combat</div> }))
vi.mock('./components/RoguelikeTasks', () => ({ default: () => <div>roguelike</div> }))
vi.mock('./components/OperatorTraining', () => ({ default: () => <div>training</div> }))
vi.mock('./components/LogViewer', () => ({ default: () => <div>logs</div> }))
vi.mock('./components/DataStatistics', () => ({ default: () => <div>statistics</div> }))
vi.mock('./components/ConfigManager', () => ({ default: () => <div>config</div> }))

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
    appMocks.navigate = null
    appMocks.dashboardEffectStarts = 0
    appMocks.dashboardEffectStops = 0
    appMocks.automationEffectStarts = 0
    appMocks.automationEffectStops = 0
    appMocks.dashboardShouldThrow = false
    appMocks.automationShouldThrow = false
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('delegates animation reduction to the user preference globally', async () => {
    await act(async () => root.render(<App />))
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="motion-config"]')?.getAttribute('data-reduced-motion')).toBe('user')
    expect(container.querySelector('#app-root')?.className).toContain('la-pluma-app')
  })

  it('preserves page state while pausing effects on hidden workspaces', async () => {
    await act(async () => root.render(<App />))
    await act(async () => { await Promise.resolve() })

    const draft = container.querySelector<HTMLInputElement>('[aria-label="控制台草稿"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(draft, '未保存的连接地址')
      draft.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(draft.value).toBe('未保存的连接地址')
    expect(appMocks.dashboardEffectStarts).toBe(1)
    expect(appMocks.automationEffectStarts).toBe(0)

    await act(async () => appMocks.navigate?.('automation'))
    expect(appMocks.dashboardEffectStops).toBe(1)
    expect(appMocks.automationEffectStarts).toBe(1)

    await act(async () => appMocks.navigate?.('dashboard'))
    expect(container.querySelector<HTMLInputElement>('[aria-label="控制台草稿"]')?.value).toBe('未保存的连接地址')
    expect(appMocks.dashboardEffectStarts).toBe(2)
    expect(appMocks.automationEffectStops).toBe(1)
  })

  it('recovers a failed page after navigating away and back', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    appMocks.dashboardShouldThrow = true
    await act(async () => root.render(<App />))
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('页面渲染失败：dashboard render failed')

    appMocks.dashboardShouldThrow = false
    await act(async () => appMocks.navigate?.('automation'))
    await act(async () => appMocks.navigate?.('dashboard'))

    expect(container.querySelector('[aria-label="控制台草稿"]')).not.toBeNull()
    consoleError.mockRestore()
  })

  it('keeps a hidden workspace error inside that workspace', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    appMocks.automationShouldThrow = true

    await act(async () => root.render(<App />))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[aria-label="控制台草稿"]')).not.toBeNull()
    const hiddenError = Array.from(container.querySelectorAll<HTMLElement>('.p-6'))
      .find(element => element.textContent?.includes('automation render failed'))
    expect(hiddenError?.style.display).toBe('none')

    await act(async () => appMocks.navigate?.('automation'))
    expect(container.textContent).toContain('页面渲染失败：automation render failed')
    expect(hiddenError?.style.display).not.toBe('none')
    consoleError.mockRestore()
  })
})
