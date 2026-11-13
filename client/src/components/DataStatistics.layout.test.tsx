// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DataStatistics from './DataStatistics'
import { installMobileMatchMedia, swipe } from '../test/swipe'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getAllOperators: vi.fn(),
  getDepotData: vi.fn(),
  getDropStatistics: vi.fn(),
  getOperBoxData: vi.fn(),
  setMessage: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )

  return {
    motion: { div: MotionDiv },
    useReducedMotion: () => true,
  }
})

vi.mock('../services/api', () => ({
  API_BASE_URL: '/api',
  fetchOperatorMaterials: vi.fn(),
  getAllOperators: mocks.getAllOperators,
  getDropStatistics: mocks.getDropStatistics,
  getItemIconUrl: (iconId: string) => `/items/${iconId}.png`,
  getOperBoxData: mocks.getOperBoxData,
  getTrainingQueue: vi.fn(),
  maaApi: {
    getDepotData: mocks.getDepotData,
    getErrorMessage: () => '未知错误',
  },
}))

vi.mock('../store/statusStore', () => {
  const state = { setMessage: mocks.setMessage }
  return {
    useStatusStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  }
})

vi.mock('./DropRecords', () => ({
  default: ({
    dropStatistics,
    isLoading,
    error,
    onRefresh,
  }: {
    dropStatistics: unknown
    isLoading?: boolean
    error?: string | null
    onRefresh: () => void
  }) => (
    <div data-testid="drop-records">
      {isLoading && <span>正在读取掉落记录</span>}
      {error && (
        <div role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRefresh}>重新加载掉落记录</button>
        </div>
      )}
      {Boolean(dropStatistics) && <span>掉落数据已加载</span>}
    </div>
  ),
}))
vi.mock('./FloatingStatusIndicator', () => ({
  default: ({ className, textClassName }: { className?: string; textClassName?: string }) => (
    <div data-testid="floating-status" data-class-name={className} data-text-class-name={textClassName} />
  ),
}))

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
}

const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes(label))

const activePanel = () => container.querySelector<HTMLElement>('.swipe-mode-slide:not([aria-hidden="true"])')

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('DataStatistics layout surfaces', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
    mocks.getDepotData.mockReset().mockResolvedValue({
      success: true,
      data: {
        itemCount: 4,
        items: [
          { id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' },
          { id: '30013', name: '固源岩组', count: 3, iconId: 'rock-group', classifyType: 'MATERIAL' },
          { id: '2001', name: '龙门币', count: 5000, iconId: 'coin', classifyType: 'NORMAL' },
          { id: '30014', name: '技巧概要·卷一', count: 7, iconId: 'book', classifyType: 'CARD_EXP' },
        ],
        timestamp: '2026-07-20T08:00:00.000Z',
      },
    })
    mocks.getDropStatistics.mockReset().mockResolvedValue({ success: false })
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: false })
    mocks.setMessage.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('uses the shared header, liquid segmented tabs, smooth task panels, and soft KPI tiles', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
    })
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [{ id: 'char_001', name: '测试干员', rarity: 6, level: 80, elite: 2, potential: 1 }],
        timestamp: '2026-07-20T08:00:00.000Z',
      },
    })

    await act(async () => root.render(<DataStatistics />))
    await flush()

    const page = container.querySelector('.data-statistics-page')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.classList.contains('ios-borderless-cards')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)
    expect(page?.querySelector('.app-page-title')?.textContent).toBe('数据')

    const status = page?.querySelector('[data-testid="floating-status"]')
    expect(status?.getAttribute('data-text-class-name')).toContain('truncate')
    expect(status?.getAttribute('data-text-class-name')).toContain('whitespace-nowrap')

    const tabShell = page?.querySelector('.data-statistics-view-switcher')
    expect(tabShell?.classList.contains('data-statistics-mode-shell')).toBe(true)
    const tabList = tabShell?.querySelector('.lg-track[role="tablist"]')
    expect(tabList?.getAttribute('aria-label')).toBe('数据统计视图')
    const tabs = Array.from(
      tabList?.querySelectorAll<HTMLButtonElement>(':scope > .lg-track__item') ?? [],
    )
    expect(tabs).toHaveLength(3)
    expect(tabs.every(tab => tab.getAttribute('role') === 'tab')).toBe(true)
    expect(tabs.every(tab => tab.getAttribute('aria-controls')?.startsWith('data-statistics-panel-'))).toBe(true)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs[1]?.tabIndex).toBe(-1)

    const operatorCard = page?.querySelector('.data-statistics-task-card')
    expect(operatorCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(operatorCard?.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()
    const operatorSummary = operatorCard?.querySelector('.data-readout')
    expect(operatorSummary?.querySelectorAll('.data-readout-stat')).toHaveLength(2)
    expect(operatorSummary?.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(operatorSummary?.classList.contains('surface-soft')).toBe(false)
    expect(operatorCard?.querySelector('.data-statistics-filter-section')?.classList.contains('surface-soft')).toBe(false)
    const operatorGrid = operatorCard?.querySelector('.data-statistics-item-grid')
    expect(operatorGrid?.classList.contains('surface-soft')).toBe(false)
    expect(operatorGrid?.classList.contains('gap-3')).toBe(true)
    const operatorItem = operatorCard?.querySelector('.data-statistics-operator-item')
    expect(operatorItem?.classList.contains('surface-soft')).toBe(false)
    expect(operatorItem?.classList.contains('border')).toBe(false)

    const depotTab = tabs.find(tab => tab.textContent?.includes('仓库识别'))
    expect(depotTab).toBeDefined()
    await act(async () => tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    await flush()
    expect(depotTab?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(depotTab)

    const depotCard = activePanel()?.querySelector('.data-statistics-task-card')
    expect(depotCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(depotCard?.textContent).toContain('仓库识别')

    const depotSummary = activePanel()?.querySelector('.data-readout')
    const kpis = Array.from(depotSummary?.querySelectorAll('.data-readout-stat') ?? [])
    expect(kpis).toHaveLength(2)
    expect(depotSummary?.querySelectorAll('.data-readout-meta > span')).toHaveLength(2)
    expect(kpis.every(kpi => !kpi.classList.contains('surface-soft'))).toBe(true)
    expect(kpis.every(kpi => !kpi.classList.contains('border'))).toBe(true)
    expect(depotSummary?.classList.contains('surface-soft')).toBe(false)

    const inventory = depotCard?.querySelector('.depot-inventory')
    expect(inventory).not.toBeNull()
    const chips = Array.from(inventory?.querySelectorAll<HTMLButtonElement>('.depot-filter-chip') ?? [])
    expect(chips).toHaveLength(4)
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(chips[0]?.textContent).toContain('全部')
    expect(chips[1]?.textContent).toContain('材料')
    expect(inventory?.querySelector('input[aria-label="搜索仓库物品"]')).not.toBeNull()

    const depotGrid = inventory?.querySelector('.depot-item-grid')
    expect(depotGrid?.classList.contains('surface-soft')).toBe(false)
    expect(depotGrid?.querySelectorAll('.depot-item')).toHaveLength(4)
    const depotItem = depotGrid?.querySelector('.depot-item')
    expect(depotItem?.classList.contains('surface-soft')).toBe(false)
    expect(depotItem?.classList.contains('border')).toBe(false)
    expect(depotItem?.querySelector('.depot-item-count')?.textContent).toContain('12')
  })

  it('filters the depot inventory by category and search', async () => {
    window.history.replaceState(null, '', '/?tab=depot')
    await act(async () => root.render(<DataStatistics />))
    await flush()

    const panel = activePanel()!
    const grid = () => panel.querySelector('.depot-item-grid')
    const meta = () => panel.querySelector('.depot-inventory-meta')?.textContent ?? ''
    const search = panel.querySelector<HTMLInputElement>('input[aria-label="搜索仓库物品"]')!

    expect(grid()?.querySelectorAll('.depot-item')).toHaveLength(4)
    expect(panel.querySelectorAll('.depot-filter-chip')).toHaveLength(4)

    const materialChip = Array.from(panel.querySelectorAll<HTMLButtonElement>('.depot-filter-chip'))
      .find(chip => chip.textContent?.includes('材料'))!
    await click(materialChip)

    expect(materialChip.getAttribute('aria-pressed')).toBe('true')
    expect(grid()?.querySelectorAll('.depot-item')).toHaveLength(2)
    expect(meta()).toMatch(/材料\s*·\s*2\s+种/)
    expect(meta()).toMatch(/15\s+件/)

    const typeSearch = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(search, value)
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await flush()
    }

    await typeSearch('固源岩组')
    expect(search.value).toBe('固源岩组')
    expect(grid()?.querySelectorAll('.depot-item')).toHaveLength(1)
    expect(grid()?.textContent).toContain('固源岩组')
    expect(meta()).toMatch(/1\s+种/)

    await typeSearch('龙门币')
    const empty = panel.querySelector('.depot-inventory-empty')
    expect(empty?.textContent).toContain('没有匹配的物品')
    expect(grid()).toBeNull()

    const clearButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .filter(button => button.textContent?.trim() === '清除筛选')
    expect(clearButtons).toHaveLength(1)
    await click(clearButtons[0]!)

    expect(search.value).toBe('')
    expect(grid()?.querySelectorAll('.depot-item')).toHaveLength(4)
    expect(panel.querySelector('.depot-filter-chip')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('switches statistics views with a horizontal swipe', async () => {
    installMobileMatchMedia()
    await act(async () => root.render(<DataStatistics />))
    await flush()

    const track = container.querySelector('[role="tablist"][aria-label="数据统计视图"]')
    const items = Array.from(
      track?.querySelectorAll<HTMLButtonElement>(':scope > .lg-track__item') ?? [],
    )
    expect(items[0]?.getAttribute('aria-selected')).toBe('true')

    await swipe(container.querySelector<HTMLElement>('.data-statistics-page')!, 240, 200, 120, 204)
    await flush()

    expect(items[1]?.getAttribute('aria-selected')).toBe('true')
    expect(items[1]?.textContent).toContain('仓库识别')
  })

  it('shows local loading and recovers from an operator data error with retry', async () => {
    mocks.getAllOperators.mockReturnValueOnce(new Promise(() => {}))
    mocks.getOperBoxData.mockReturnValueOnce(new Promise(() => {}))

    await act(async () => root.render(<DataStatistics />))
    expect(container.textContent).toContain('正在读取干员数据')

    await act(async () => root.unmount())
    root = createRoot(container)

    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
    })
    mocks.getOperBoxData
      .mockResolvedValueOnce({ success: false, message: 'Internal Server Error' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          operCount: 1,
          data: [{ id: 'char_001', name: '测试干员', rarity: 6, level: 80, elite: 2, potential: 1 }],
        },
      })

    await act(async () => root.render(<DataStatistics />))
    await flush()

    const alert = activePanel()?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('干员数据读取失败')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    const retry = alert?.querySelector<HTMLButtonElement>('button')
    expect(retry).toBeDefined()
    await click(retry!)

    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(3)
    expect(activePanel()?.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('测试干员')
  })

  it('gives filter menus predictable focus, keyboard navigation, Escape, selection, and outside dismissal', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
    })
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [{ id: 'char_001', name: '测试干员', rarity: 6, level: 80, elite: 2, potential: 1 }],
      },
    })

    await act(async () => root.render(<DataStatistics />))
    await flush()

    const trigger = findButton('拥有状态')!
    trigger.focus()
    await click(trigger)

    let menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    let options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(trigger.classList.contains('min-h-11')).toBe(true)
    expect(menu.classList.contains('fixed')).toBe(true)
    expect(menu.style.width).toBe('88px')
    expect(menu.style.left).toBe('16px')
    expect(options.every(option => option.classList.contains('min-h-11'))).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(options[0])

    await act(async () => options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(options[1])

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await click(trigger)
    menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    await click(options[1]!)
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.textContent).toContain('已拥有')
    const resetButton = findButton('重置')
    expect(resetButton?.type).toBe('button')
    expect(resetButton?.classList.contains('min-h-11')).toBe(true)
    expect(resetButton?.classList.contains('app-glass-button')).toBe(true)

    await click(trigger)
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('right-aligns end-of-row menus on phones without changing desktop alignment', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
    })
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [{ id: 'char_001', name: '测试干员', rarity: 6, level: 80, elite: 2, potential: 1 }],
      },
    })

    await act(async () => root.render(<DataStatistics />))
    await flush()

    for (const label of ['职业', '排序']) {
      const expectedWidth = label === '职业' ? 72 : 100
      const trigger = findButton(label)!
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        x: 220,
        y: 100,
        top: 100,
        right: 300,
        bottom: 144,
        left: 220,
        width: 80,
        height: 44,
        toJSON: () => ({}),
      })
      vi.stubGlobal('innerWidth', 320)
      vi.stubGlobal('innerHeight', 568)
      trigger.focus()
      await click(trigger)

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      expect(menu.classList.contains('fixed')).toBe(true)
      expect(menu.style.left).toBe(`${300 - expectedWidth}px`)
      expect(menu.style.width).toBe(`${expectedWidth}px`)
      expect(Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(360)
      expect(options.every(option => option.classList.contains('min-h-11'))).toBe(true)
      expect(document.activeElement).toBe(options[0])

      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.body.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    }
  })

  it('shows a drop data error and retries the failed API request', async () => {
    mocks.getDropStatistics
      .mockResolvedValueOnce({ success: false, message: 'Internal Server Error' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: {},
          stages: {},
          dateRange: { start: '2026-07-20', end: '2026-07-20', days: 1 },
        },
      })

    await act(async () => root.render(<DataStatistics />))
    await flush()
    await click(findButton('掉落记录')!)

    const alert = container.querySelector('[data-testid="drop-records"] [role="alert"]')
    expect(alert?.textContent).toContain('暂时无法读取掉落记录')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    await click(findButton('重新加载掉落记录')!)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('掉落数据已加载')
  })

  it('keeps a depot read failure distinct from an empty result and retries it', async () => {
    mocks.getDepotData
      .mockResolvedValueOnce({ success: false, message: 'Internal Server Error' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          itemCount: 1,
          items: [{ id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' }],
          timestamp: '2026-07-20T08:00:00.000Z',
        },
      })

    await act(async () => root.render(<DataStatistics />))
    await flush()
    await click(findButton('仓库识别')!)

    const alert = activePanel()?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('仓库数据读取失败')
    expect(activePanel()?.textContent).not.toContain('还没有仓库识别结果')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    const depotRetry = alert?.querySelector<HTMLButtonElement>('button')
    expect(depotRetry).toBeDefined()
    await click(depotRetry!)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(activePanel()?.querySelector('[role="alert"]')).toBeNull()
    expect(activePanel()?.textContent).toContain('物品种类')
  })

  it('ignores stale data loaders across an Activity hide and restore cycle', async () => {
    const oldDepot = deferred<{ success: boolean; data: Record<string, unknown> }>()
    const newDepot = deferred<{ success: boolean; data: Record<string, unknown> }>()
    const oldOperBox = deferred<{ success: boolean; data: Record<string, unknown> }>()
    const newOperBox = deferred<{ success: boolean; data: Record<string, unknown> }>()
    const oldCatalog = deferred<{ success: boolean; data: Array<Record<string, unknown>> }>()
    const newCatalog = deferred<{ success: boolean; data: Array<Record<string, unknown>> }>()

    mocks.getDepotData
      .mockReset()
      .mockReturnValueOnce(oldDepot.promise)
      .mockReturnValueOnce(newDepot.promise)
    mocks.getOperBoxData
      .mockReset()
      .mockReturnValueOnce(oldOperBox.promise)
      .mockReturnValueOnce(newOperBox.promise)
    mocks.getAllOperators
      .mockReset()
      .mockReturnValueOnce(oldCatalog.promise)
      .mockReturnValueOnce(newCatalog.promise)

    await act(async () => root.render(
      <Activity mode="visible">
        <DataStatistics />
      </Activity>,
    ))
    await flush()

    await act(async () => root.render(
      <Activity mode="hidden">
        <DataStatistics />
      </Activity>,
    ))
    await flush()
    await act(async () => root.render(
      <Activity mode="visible">
        <DataStatistics />
      </Activity>,
    ))
    await flush()

    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(2)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(2)

    await act(async () => {
      oldDepot.resolve({
        success: true,
        data: {
          itemCount: 1,
          items: [{ id: 'old-item', name: '旧仓库物品', count: 1, iconId: 'old', classifyType: 'MATERIAL' }],
          timestamp: '2026-07-20T08:00:00.000Z',
        },
      })
      oldOperBox.resolve({
        success: true,
        data: {
          operCount: 1,
          data: [{ id: 'old-oper', name: '旧干员', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 1 }],
          timestamp: '2026-07-20T08:00:00.000Z',
        },
      })
      oldCatalog.resolve({
        success: true,
        data: [{ id: 'old-oper', name: '旧干员', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 }],
      })
    })
    await flush()

    expect(container.textContent).toContain('正在读取干员数据')
    expect(container.textContent).not.toContain('旧干员')
    await click(findButton('仓库识别')!)
    expect(container.textContent).toContain('正在读取仓库数据')
    expect(container.textContent).not.toContain('旧仓库物品')

    await act(async () => {
      newDepot.resolve({
        success: true,
        data: {
          itemCount: 1,
          items: [{ id: 'new-item', name: '新仓库物品', count: 2, iconId: 'new', classifyType: 'MATERIAL' }],
          timestamp: '2026-07-21T08:00:00.000Z',
        },
      })
      newOperBox.resolve({
        success: true,
        data: {
          operCount: 1,
          data: [{ id: 'new-oper', name: '新干员', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 1 }],
          timestamp: '2026-07-21T08:00:00.000Z',
        },
      })
      newCatalog.resolve({
        success: true,
        data: [{ id: 'new-oper', name: '新干员', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 }],
      })
    })
    await flush()

    expect(container.textContent).toContain('新仓库物品')
    expect(container.textContent).not.toContain('旧仓库物品')
    await click(findButton('干员识别')!)
    expect(container.textContent).toContain('新干员')
    expect(container.textContent).not.toContain('旧干员')
  })

  it('renders a React-owned fallback when a depot image fails', async () => {
    await act(async () => root.render(<DataStatistics />))
    await flush()
    await click(findButton('仓库识别')!)

    const image = container.querySelector<HTMLImageElement>('.depot-item-image')
    expect(image).not.toBeNull()
    expect(image?.getAttribute('alt')).toBe('')
    const tile = image?.closest('.depot-item')
    expect(tile).not.toBeNull()
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))
    await flush()

    expect(tile?.querySelector('img')).toBeNull()
    expect(tile?.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })
})
