// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppTab } from '@/shared/navigation'
import AppSidebar from './AppSidebar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadDailyOperatorQuote: vi.fn(),
}))

vi.mock('@/features/operator-quotes', () => ({
  DEFAULT_OPERATOR_QUOTE: {
    operatorId: 'char_002_amiya',
    operator: '阿米娅',
    quote: '今天也请多指教',
  },
  getOperatorAvatarUrl: (operatorId: string) =>
    `http://localhost:3000/game-assets/avatar/${operatorId}.png`,
  loadDailyOperatorQuote: mocks.loadDailyOperatorQuote,
}))

let container: HTMLDivElement
let root: Root

function sidebar() {
  return container.querySelector<HTMLElement>('aside[data-region="sidebar"]')
}

function tabButtons() {
  return container.querySelectorAll<HTMLButtonElement>('nav[aria-label="工作台"] button[data-app-tab]')
}

async function renderSidebar(activeTab: AppTab = 'dashboard', onNavigate = vi.fn()) {
  await act(async () => root.render(
    <AppSidebar activeTab={activeTab} onNavigate={onNavigate} />,
  ))
  await act(async () => {
    await Promise.resolve()
  })
  return onNavigate
}

describe('desktop sidebar', () => {
  beforeEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
    mocks.loadDailyOperatorQuote.mockReset()
    mocks.loadDailyOperatorQuote.mockResolvedValue({
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps navigation and identity without persisting provider state or handling the sidebar shortcut', async () => {
    await renderSidebar()

    expect(sidebar()).not.toBeNull()
    expect(container.querySelector('[data-slot="sidebar"]')).not.toBeNull()
    expect(document.cookie).not.toContain('sidebar_state')

    const ctrlShortcut = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const metaShortcut = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      window.dispatchEvent(ctrlShortcut)
      window.dispatchEvent(metaShortcut)
    })

    expect(ctrlShortcut.defaultPrevented).toBe(false)
    expect(metaShortcut.defaultPrevented).toBe(false)
    expect(document.cookie).not.toContain('sidebar_state')
    expect(sidebar()?.querySelector('nav[aria-label="工作台"]')).not.toBeNull()
    expect(tabButtons()).toHaveLength(8)
    expect(container.querySelector('[data-state="collapsed"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-trigger"], [data-slot="sidebar-rail"]')).toBeNull()
  })

  it('renders the fixed sidebar instead of a mobile sheet', async () => {
    await renderSidebar('automation')

    expect(sidebar()).not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-gap"], [data-slot="sidebar-inner"]')).toBeNull()
  })

  it('keeps the brand, daily identity, all workspace tabs and a single current tab', async () => {
    await renderSidebar()

    const brand = container.querySelector<HTMLElement>('[data-region="sidebar-brand"]')!
    expect(brand.tagName).toBe('DIV')
    expect(brand.textContent).toBe('La Pluma Next')
    expect(brand.querySelector('button, a')).toBeNull()
    expect(brand.querySelector('img')?.getAttribute('alt')).toBe('')

    const identity = container.querySelector<HTMLElement>('aside [aria-label*="："]')!
    expect(identity.getAttribute('aria-label')).toBe('银灰：战术安排已就绪')
    expect(identity.querySelector('strong')?.textContent).toBe('银灰')
    expect(identity.querySelector('small')?.textContent).toBe('战术安排已就绪')

    expect([...tabButtons()].map(button => button.dataset.appTab)).toEqual([
      'dashboard',
      'automation',
      'combat',
      'roguelike',
      'training',
      'statistics',
      'logs',
      'config',
    ])
    expect(container.querySelectorAll('aside [aria-current="page"]')).toHaveLength(1)
    expect(container.querySelector<HTMLElement>('aside [aria-current="page"]')?.dataset.appTab).toBe('dashboard')

    const onNavigate = await renderSidebar('statistics')
    expect(container.querySelectorAll('aside [aria-current="page"]')).toHaveLength(1)
    expect(container.querySelector<HTMLElement>('aside [aria-current="page"]')?.dataset.appTab).toBe('statistics')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-app-tab="logs"]')?.click()
    })
    expect(onNavigate).toHaveBeenCalledWith('logs')
  })
})
