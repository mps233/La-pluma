// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DataStatistics from './DataStatistics'

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

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({ setMessage: mocks.setMessage }),
}))

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

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('DataStatistics layout surfaces', () => {
  beforeEach(() => {
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
    mocks.getDepotData.mockReset().mockResolvedValue({
      success: true,
      data: {
        itemCount: 12,
        items: [{ id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' }],
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

  it('uses the shared header, neutral tabs, smooth task panels, and a single KPI surface grid', async () => {
    await act(async () => root.render(<DataStatistics />))
    await flush()

    const page = container.querySelector('.data-statistics-page')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)

    const status = page?.querySelector('[data-testid="floating-status"]')
    expect(status?.getAttribute('data-text-class-name')).toContain('truncate')
    expect(status?.getAttribute('data-text-class-name')).toContain('whitespace-nowrap')

    expect(page?.querySelector('.data-statistics-tabs')?.getAttribute('role')).toBe('group')
    const tabs = Array.from(page?.querySelectorAll<HTMLButtonElement>('.data-statistics-tabs > button') ?? [])
    expect(tabs).toHaveLength(3)
    expect(tabs.every(tab => tab.classList.contains('min-h-11'))).toBe(true)
    expect(tabs[0]?.classList.contains('is-active')).toBe(true)
    expect(tabs[0]?.getAttribute('aria-pressed')).toBe('true')

    const operatorCard = page?.querySelector('.data-statistics-task-card')
    expect(operatorCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(operatorCard?.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()

    const depotTab = tabs.find(tab => tab.textContent?.includes('仓库识别'))
    expect(depotTab).toBeDefined()
    await click(depotTab!)

    const depotCard = page?.querySelector('.data-statistics-task-card')
    expect(depotCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(depotCard?.textContent).toContain('仓库识别')

    const kpiGrid = page?.querySelector('.data-statistics-kpi-grid')
    const kpis = Array.from(kpiGrid?.querySelectorAll('.data-statistics-kpi') ?? [])
    expect(kpis).toHaveLength(6)
    expect(kpis.every(kpi => !kpi.classList.contains('surface-soft'))).toBe(true)
    expect(kpis.every(kpi => !kpi.classList.contains('border'))).toBe(true)
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

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('干员数据读取失败')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    const retry = findButton('重新加载')
    expect(retry).toBeDefined()
    await click(retry!)

    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(3)
    expect(container.querySelector('[role="alert"]')).toBeNull()
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
    expect(menu.style.width).toBe('128px')
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
    expect(resetButton?.className).toContain('focus-visible:ring-2')

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
      expect(menu.style.left).toBe('172px')
      expect(menu.style.width).toBe('128px')
      expect(Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(320)
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

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('仓库数据读取失败')
    expect(container.textContent).not.toContain('还没有仓库识别结果')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    await click(findButton('重新加载')!)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('总物品数')
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

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    expect(image).not.toBeNull()
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))
    await flush()

    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })
})
