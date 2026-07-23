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

  const expectCurrentPageHeader = () => {
    const header = container.querySelector('.app-page-header.is-mobile-inline')
    expect(header).not.toBeNull()
    expect(header?.querySelector('.app-page-heading')).not.toBeNull()
    expect(header?.querySelector('.app-page-actions')).not.toBeNull()
    expect(header?.querySelector('.app-page-header-icon')).toBeNull()
  }

  it('mirrors the automation workspace and support rail', async () => {
    await renderSkeleton('automation')

    expect(container.querySelector('[aria-label="页面内容加载中"]')).not.toBeNull()
    expectCurrentPageHeader()
    expect(container.querySelector('.automation-workspace-grid')).not.toBeNull()
    expect(container.querySelector('.automation-support-column')).not.toBeNull()
    expect(container.querySelector('.automation-sequence-surface')).not.toBeNull()
    expect(container.querySelectorAll('.automation-sequence-item')).toHaveLength(5)
    expect(container.querySelectorAll('.automation-sequence-footer > .app-skeleton')).toHaveLength(2)
    expect(container.querySelector('.automation-editor-heading')).not.toBeNull()
    expect(container.querySelector('.automation-editor-content')).not.toBeNull()
    expect(container.querySelector('.automation-schedule-heading')).not.toBeNull()
    expect(container.querySelector('.automation-notification-panel')).not.toBeNull()
    expect(container.querySelector('.automation-monitor-panel .aspect-video')).not.toBeNull()
    expect(container.querySelectorAll('.automation-monitor-skeleton-toolbar .rounded-full')).toHaveLength(5)
  })

  it('keeps dashboard material styling while data is loading', async () => {
    await renderSkeleton('dashboard')

    const page = container.querySelector('[aria-label="控制台加载中"]')
    expect(page?.classList.contains('dashboard-page')).toBe(true)
    expectCurrentPageHeader()
    expect(page?.querySelector('.dashboard-flow-card')).not.toBeNull()
    expect(page?.querySelectorAll('.dashboard-flow-actions > .app-skeleton')).toHaveLength(2)
    expect(page?.querySelector('[data-dashboard-preview-card].status-border-beam')).not.toBeNull()
    expect(page?.querySelectorAll('.dashboard-device-card-shell')).toHaveLength(4)
    expect(page?.querySelectorAll('.dashboard-temperature-skeleton')).toHaveLength(1)
    expect(page?.querySelectorAll('.dashboard-summary-card')).toHaveLength(4)
    expect(page?.querySelector('.dashboard-summary-card.is-status')).not.toBeNull()
    expect(page?.querySelector('.dashboard-summary-card.is-stages')).not.toBeNull()
    expect(page?.querySelector('.dashboard-summary-card.is-training')).not.toBeNull()
    expect(page?.querySelector('.dashboard-summary-card.is-drops')).not.toBeNull()
  })

  it('keeps the device preview aspect ratio for execution pages', async () => {
    await renderSkeleton('combat')

    expectCurrentPageHeader()
    expect(container.querySelector('.ios-workspace-page .task-monitor-layout')).not.toBeNull()
    expect(container.querySelector('.combat-page')).not.toBeNull()
    expect(container.querySelector('.combat-mode-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.combat-mode-skeleton-highlight')).not.toBeNull()
    expect(container.querySelectorAll('.combat-mode-shell .app-workspace-segment')).toHaveLength(3)
    expect(container.querySelector('.app-card.combat-task-card')).not.toBeNull()
    expect(container.querySelector('.combat-task-heading.flex-col')).not.toBeNull()
    expect(container.querySelector('.combat-job-list-section')).not.toBeNull()
    expect(container.querySelectorAll('.combat-copilot-layout > .space-y-3')).toHaveLength(3)
    expect(container.querySelector('.combat-monitor-panel .aspect-video')).not.toBeNull()
  })

  it('mirrors the three-column roguelike workspace while loading', async () => {
    await renderSkeleton('roguelike')

    expectCurrentPageHeader()
    expect(container.querySelector('.roguelike-page')).not.toBeNull()
    expect(container.querySelector('.ios-workspace-page .roguelike-workspace-grid')).not.toBeNull()
    expect(container.querySelector('.roguelike-mode-area .roguelike-mode-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.roguelike-mode-skeleton-highlight')).not.toBeNull()
    expect(container.querySelectorAll('.roguelike-mode-shell .app-workspace-segment')).toHaveLength(2)
    expect(container.querySelector('.roguelike-theme-panel')).not.toBeNull()
    expect(container.querySelectorAll('.roguelike-theme-grid > .roguelike-theme-option')).toHaveLength(5)
    expect(container.querySelector('.roguelike-settings-panel')).not.toBeNull()
    expect(container.querySelectorAll('.roguelike-field-grid > div')).toHaveLength(4)
    expect(container.querySelectorAll('.roguelike-toggle-list > .roguelike-toggle-row')).toHaveLength(2)
    expect(container.querySelector('.roguelike-panel-footer .roguelike-run-button')).not.toBeNull()
    expect(container.querySelector('.roguelike-monitor-panel .aspect-video')).not.toBeNull()
  })

  it('mirrors the training operator grid and support column', async () => {
    await renderSkeleton('training')

    expectCurrentPageHeader()
    expect(container.querySelector('.ios-workspace-page[data-page="training"]')).not.toBeNull()
    expect(container.querySelector('.training-operator-column')).not.toBeNull()
    expect(container.querySelector('.training-status-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.training-status-skeleton-highlight')).not.toBeNull()
    expect(container.querySelectorAll('.training-status-shell .app-workspace-segment')).toHaveLength(3)
    expect(container.querySelector('.training-status-tab')).toBeNull()
    expect(container.querySelectorAll('.training-operator-skeleton')).toHaveLength(12)
    expect(container.querySelector('.training-support-column')).not.toBeNull()
    expect(container.querySelector('.training-settings-panel')).not.toBeNull()
    expect(container.querySelectorAll('.training-settings-skeleton-row')).toHaveLength(2)
    expect(container.querySelector('.training-queue-card')).not.toBeNull()
    expect(container.querySelector('.training-plan-empty')).not.toBeNull()
  })

  it('uses the current toolbar, console, and history log cards', async () => {
    await renderSkeleton('logs')

    expectCurrentPageHeader()
    expect(container.querySelector('.log-viewer.ios-workspace-page')).not.toBeNull()
    expect(container.querySelectorAll('.log-card')).toHaveLength(3)
    expect(container.querySelector('.log-toolbar-card .log-toolbar')).not.toBeNull()
    expect(container.querySelector('.log-mode-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.log-mode-skeleton-highlight')).not.toBeNull()
    expect(container.querySelectorAll('.log-mode-shell .app-workspace-segment')).toHaveLength(2)
    expect(container.querySelector('.log-console-content .log-console')).not.toBeNull()
    expect(container.querySelectorAll('.log-console .log-row')).toHaveLength(10)
    expect(container.querySelector('.log-history-card .log-history-list')).not.toBeNull()
    expect(container.querySelectorAll('.app-skeleton-shimmer').length).toBeGreaterThan(10)
  })

  it('mirrors the statistics tabs and active task result card', async () => {
    await renderSkeleton('statistics')

    expectCurrentPageHeader()
    expect(container.querySelector('.data-statistics-page.ios-workspace-page')).not.toBeNull()
    expect(container.querySelector('.data-statistics-view-switcher.data-statistics-mode-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.data-statistics-mode-skeleton-highlight')).not.toBeNull()
    expect(container.querySelectorAll('.data-statistics-view-switcher .app-workspace-segment')).toHaveLength(3)
    expect(container.querySelectorAll('.data-statistics-task-card')).toHaveLength(1)
    expect(container.querySelectorAll('.data-statistics-result-grid > div')).toHaveLength(6)
  })

  it('mirrors the config directory, updater, and editor workspace', async () => {
    await renderSkeleton('config')

    expectCurrentPageHeader()
    const page = container.querySelector('.app-page.ios-workspace-page.app-stack-section[data-page="config"]')
    expect(page).not.toBeNull()
    expect(page?.querySelector('[data-config-sections].app-liquid-tab-pill')).not.toBeNull()
    expect(page?.querySelectorAll('[data-config-sections] .app-workspace-segment')).toHaveLength(3)
    expect(page?.querySelector('.config-editor-card')).not.toBeNull()
    expect(page?.querySelector('.config-directory-card')).not.toBeNull()
    expect(page?.querySelector('.config-update-card')).not.toBeNull()
    const workspace = page?.querySelector(':scope > .config-workspace-grid')
    const primaryColumn = workspace?.querySelector(':scope > .config-workspace-primary')
    const secondaryColumn = workspace?.querySelector(':scope > .config-workspace-secondary')
    expect(workspace?.children).toHaveLength(2)
    expect(Array.from(primaryColumn?.querySelectorAll(':scope > .app-card') ?? []).map(card => card.className)).toEqual([
      expect.stringContaining('config-editor-card'),
      expect.stringContaining('config-directory-card'),
    ])
    expect(Array.from(secondaryColumn?.querySelectorAll(':scope > .app-card') ?? []).map(card => card.className)).toEqual([
      expect.stringContaining('config-update-card'),
    ])
    expect(page?.querySelectorAll(':scope > .app-card')).toHaveLength(0)
    expect(page?.querySelector('.config-section-nav')).toBeNull()
  })
})
