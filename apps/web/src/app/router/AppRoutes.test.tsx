// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_TABS, appTabRoute, routerBasename, useActiveAppTab } from '@/shared/navigation'
import { AppRoutes } from './AppRoutes'
import { appRoutes } from './pages'
import { appTabs } from './tabs'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pageMocks = vi.hoisted(() => ({
  dashboardRenders: 0,
  automationRenders: 0,
}))

vi.mock('@/pages/dashboard/Dashboard', () => ({
  default: () => {
    pageMocks.dashboardRenders += 1
    return <div data-page-kind="dashboard">dashboard</div>
  },
}))
vi.mock('@/pages/automation/AutomationTasks', () => ({
  default: () => {
    pageMocks.automationRenders += 1
    return <div data-page-kind="automation">automation</div>
  },
}))
vi.mock('@/pages/combat/CombatTasks', () => ({ default: () => <div data-page-kind="combat">combat</div> }))
vi.mock('@/pages/roguelike/RoguelikeTasks', () => ({ default: () => <div data-page-kind="roguelike">roguelike</div> }))
vi.mock('@/pages/training/OperatorTraining', () => ({ default: () => <div data-page-kind="training">training</div> }))
vi.mock('@/pages/statistics/DataStatistics', () => ({ default: () => <div data-page-kind="statistics">statistics</div> }))
vi.mock('@/pages/logs/LogViewer', () => ({ default: () => <div data-page-kind="logs">logs</div> }))
vi.mock('@/pages/settings/ConfigManager', () => ({ default: () => <div data-page-kind="config">config</div> }))

function Harness() {
  const activeTab = useActiveAppTab()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      <button type="button" onClick={() => navigate(appTabRoute('dashboard'))}>go-dashboard</button>
      <button type="button" onClick={() => navigate(appTabRoute('automation'))}>go-automation</button>
      <output data-testid="location">{location.pathname}</output>
      <AppRoutes activeTab={activeTab} />
    </>
  )
}

let container: HTMLDivElement
let root: Root

function clickButton(text: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent === text)
  button?.click()
}

function locationLabel() {
  return container.querySelector('[data-testid="location"]')?.textContent
}

async function renderWithRouter(router: 'memory' | 'browser', initialEntry?: string) {
  if (router === 'browser' && initialEntry) {
    window.history.replaceState({}, '', initialEntry)
  }

  await act(async () => root.render(
    router === 'memory'
      ? (
          <MemoryRouter initialEntries={[initialEntry ?? '/app/dashboard']}>
            <Harness />
          </MemoryRouter>
        )
      : (
          <BrowserRouter>
            <Harness />
          </BrowserRouter>
        ),
  ))
}

describe('app route table and keep-alive outlet', () => {
  beforeEach(() => {
    pageMocks.dashboardRenders = 0
    pageMocks.automationRenders = 0
    window.history.replaceState({}, '', '/app/dashboard')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllEnvs()
  })

  it('maps every workspace to its canonical route', () => {
    expect(appRoutes.map(route => route.id).sort()).toEqual([...APP_TABS].sort())
    expect(appRoutes).toHaveLength(APP_TABS.length)

    for (const route of appRoutes) {
      expect(route.path).toBe(appTabRoute(route.id))
      expect(route.Component).toBeTruthy()
    }
    expect(appRoutes.find(route => route.id === 'dashboard')?.path).toBe('/app/dashboard')
    expect(appRoutes.find(route => route.id === 'config')?.path).toBe('/app/config')
  })

  it('keeps tab metadata, route table and shared vocabulary in sync', () => {
    expect(appRoutes.map(route => route.id)).toEqual([...APP_TABS])
    expect(appTabs.map(tab => tab.id).sort()).toEqual([...APP_TABS].sort())
    expect(new Set(appTabs.map(tab => tab.name)).size).toBe(APP_TABS.length)
  })

  it('restores a deep link and keeps the visited workspace mounted after switching', async () => {
    await renderWithRouter('memory', '/app/automation')

    const automationPage = container.querySelector<HTMLElement>('[data-page-kind="automation"]')
    expect(automationPage).not.toBeNull()
    expect(automationPage?.style.display).not.toBe('none')
    expect(container.querySelector('[data-page-kind="dashboard"]')).toBeNull()
    expect(locationLabel()).toBe('/app/automation')

    await act(async () => clickButton('go-dashboard'))

    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="dashboard"]')).not.toBeNull()
    // 旧页面仍然挂载（同一个 DOM 节点），只是被 Activity 隐藏。
    expect(container.querySelector('[data-page-kind="automation"]')).toBe(automationPage)
    expect(automationPage?.style.display).toBe('none')

    await act(async () => clickButton('go-automation'))

    expect(container.querySelector('[data-page-kind="automation"]')).toBe(automationPage)
    expect(automationPage?.style.display).not.toBe('none')
    expect(pageMocks.automationRenders).toBeGreaterThan(0)
  })

  it('switches tabs on browser back/forward without remounting visited workspaces', async () => {
    await renderWithRouter('browser', '/app/dashboard')
    await act(async () => clickButton('go-automation'))

    const automationPage = container.querySelector<HTMLElement>('[data-page-kind="automation"]')
    expect(locationLabel()).toBe('/app/automation')

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="automation"]')).toBe(automationPage)
    expect(automationPage?.style.display).toBe('none')

    await act(async () => {
      window.history.replaceState({}, '', '/app/automation')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(locationLabel()).toBe('/app/automation')
    expect(container.querySelector('[data-page-kind="automation"]')).toBe(automationPage)
    expect(automationPage?.style.display).not.toBe('none')
  })

  it('normalizes the bare root path to the dashboard route with a replace', async () => {
    const historyLength = window.history.length

    await renderWithRouter('browser', '/')

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="dashboard"]')).not.toBeNull()
  })

  it('normalizes a trailing-slash bare app path to the dashboard route with a replace', async () => {
    const historyLength = window.history.length

    await renderWithRouter('browser', '/app/')

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="dashboard"]')).not.toBeNull()
  })

  it('normalizes the bare app path to the dashboard route with a replace', async () => {
    const historyLength = window.history.length

    await renderWithRouter('browser', '/app')

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="dashboard"]')).not.toBeNull()
  })

  it('normalizes an unknown tab to the dashboard route with a replace', async () => {
    const historyLength = window.history.length

    await renderWithRouter('browser', '/app/not-a-tab')

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/dashboard')
  })

  it('canonicalizes nested paths for a known tab', async () => {
    const historyLength = window.history.length

    await renderWithRouter('browser', '/app/logs/details')

    expect(window.location.pathname).toBe('/app/logs')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/logs')
    expect(container.querySelector('[data-page-kind="logs"]')).not.toBeNull()
  })

  it('leaves an already canonical path and its query untouched', async () => {
    window.history.replaceState({}, '', '/app/logs?page=2#top')
    const historyLength = window.history.length

    await renderWithRouter('browser', '/app/logs?page=2#top')

    expect(window.location.pathname).toBe('/app/logs')
    expect(window.location.search).toBe('?page=2')
    expect(window.location.hash).toBe('#top')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/logs')
  })

  it('normalizes the bare non-root base and navigates under the basename', async () => {
    vi.stubEnv('BASE_URL', '/la-pluma/')
    window.history.replaceState({}, '', '/la-pluma')
    const historyLength = window.history.length

    await act(async () => root.render(
      <BrowserRouter basename={routerBasename()}>
        <Harness />
      </BrowserRouter>,
    ))

    expect(window.location.pathname).toBe('/la-pluma/app/dashboard')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/dashboard')
    expect(container.querySelector('[data-page-kind="dashboard"]')).not.toBeNull()

    await act(async () => clickButton('go-automation'))

    expect(window.location.pathname).toBe('/la-pluma/app/automation')
    expect(locationLabel()).toBe('/app/automation')
    expect(container.querySelector('[data-page-kind="automation"]')).not.toBeNull()
  })

  it('restores a deep link under a non-root base without rewriting the URL', async () => {
    vi.stubEnv('BASE_URL', '/la-pluma/')
    window.history.replaceState({}, '', '/la-pluma/app/logs')
    const historyLength = window.history.length

    await act(async () => root.render(
      <BrowserRouter basename={routerBasename()}>
        <Harness />
      </BrowserRouter>,
    ))

    expect(window.location.pathname).toBe('/la-pluma/app/logs')
    expect(window.history.length).toBe(historyLength)
    expect(locationLabel()).toBe('/app/logs')
    expect(container.querySelector('[data-page-kind="logs"]')).not.toBeNull()
  })
})
