// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { gameDataKeys } from '@/features/game-data'
import {
  publishResourceInvalidation,
  subscribeResourceInvalidation,
  type ResourceInvalidation,
} from '@/features/resource-invalidation'
import { statisticsCommandOwner } from '@/features/statistics/model/commandOwner'
import DataStatistics from './DataStatistics'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getAllOperators: vi.fn(),
  getDepotData: vi.fn(),
  getDropStatistics: vi.fn(),
  getOperBoxData: vi.fn(),
  fetchOperatorMaterials: vi.fn(),
  executeCommand: vi.fn(),
  getRun: vi.fn(),
  parseDepotData: vi.fn(),
  parseOperBoxData: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('@/features/device-mirror', () => ({
  DeviceMonitorLayout: ({ children }: { children: ReactNode }) => children,
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

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: mocks.getDepotData,
  getItemIconUrl: (iconId: string) => `/items/${iconId}.png`,
  getOperatorAvatarUrl: (operatorId: string) => `/avatars/${operatorId}.png`,
  getOperBoxData: mocks.getOperBoxData,
}))

vi.mock('@/features/statistics/api', () => ({
  getDropStatistics: mocks.getDropStatistics,
  parseDepotData: mocks.parseDepotData,
  parseOperBoxData: mocks.parseOperBoxData,
}))

vi.mock('@/features/training', () => ({
  fetchOperatorMaterials: mocks.fetchOperatorMaterials,
}))

vi.mock('@/features/task-execution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/task-execution')>()
  let sequence = 0
  return {
    ...actual,
    executeCommand: mocks.executeCommand,
    getRun: mocks.getRun,
    executionController: {
      beginExecutionIntent: (
        operationId: string,
        options: { idempotencyKey?: string; scope?: string | null } = {},
      ) => {
        sequence += 1
        return {
          operationId,
          idempotencyKey: options.idempotencyKey ?? `test-key-${sequence}`,
          scope: options.scope ?? null,
          sequence,
        }
      },
      settleExecutionIntent: () => true,
    },
  }
})

vi.mock('@/shared/notifications', () => ({
  notify: mocks.notify,
  notifyProgress: mocks.notifyProgress,
  dismissNotice: mocks.dismissNotice,
  detectNoticeType: () => 'default',
  EXECUTION_NOTICE_ID: 'execution',
  STATISTICS_NOTICE_ID: 'statistics',
  SETTINGS_UPDATE_NOTICE_ID: 'settings-update',
}))

vi.mock('@/features/statistics/components/DropRecords', () => ({
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

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      return
    }
    // Query 的观察者通知走 setTimeout(0)，需要两个宏任务轮次才能稳定。
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const DEFAULT_ENTRY = '/app/statistics'

const renderPage = async (initialEntries: string[] = [DEFAULT_ENTRY], extra?: ReactNode) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <DataStatistics />
          {extra}
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

const renderWithActivity = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[DEFAULT_ENTRY]}>
          <Activity mode={mode}>
            <DataStatistics />
          </Activity>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
}

const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes(label))

const selectTab = async (tab: string) => {
  const target = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find(button => button.textContent?.includes(tab))
  expect(target).toBeDefined()
  await click(target!)
}

const selectedTab = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  .find(button => button.getAttribute('aria-selected') === 'true')

function RequestDropsNavigation() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/app/statistics?tab=drops')}>
      请求掉落记录
    </button>
  )
}

function RouteProbe() {
  const location = useLocation()
  return <output data-testid="route">{location.pathname + location.search}</output>
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** 命令请求只会在 signal 中止时失败，用于验证页面在超时后恢复同一命令。 */
const abortable = (signal: AbortSignal | null): Promise<{ success: boolean }> => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => {
    reject(new DOMException('The operation was aborted.', 'AbortError'))
  })
})

const ownedOperatorFixture = {
  success: true,
  data: {
    operCount: 1,
    data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 1 }],
    timestamp: '2026-07-20T08:00:00.000Z',
  },
}

const catalogFixture = {
  success: true,
  data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
}

describe('DataStatistics layout surfaces', () => {
  beforeEach(() => {
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    Object.values(mocks).forEach(mock => mock.mockReset())
    mocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    mocks.getDepotData.mockResolvedValue({
      success: true,
      data: {
        itemCount: 12,
        items: [{ id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' }],
        timestamp: '2026-07-20T08:00:00.000Z',
      },
    })
    mocks.getDropStatistics.mockResolvedValue({ success: false })
    mocks.getOperBoxData.mockResolvedValue({ success: false })
    mocks.fetchOperatorMaterials.mockResolvedValue({ success: true })
    statisticsCommandOwner.reset()
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    // 先卸载观察者再重置命令所有者，避免卸载后的 store 通知落在 act 之外。
    await act(async () => root.unmount())
    statisticsCommandOwner.reset()
    client.clear()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('switches statistics tabs with arrow keys and keeps a single focusable tab', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()

    expect(container.querySelector('h1')).toBeNull()

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs).toHaveLength(3)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs[1]?.tabIndex).toBe(-1)

    const depotTab = tabs.find(tab => tab.textContent?.includes('仓库识别'))
    expect(depotTab).toBeDefined()
    await act(async () => tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    await flush()
    expect(depotTab?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(depotTab)
    expect(container.textContent).toContain('仓库识别')
  })

  it('opens the tab named by the url of the page entry', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)
    mocks.getDropStatistics.mockResolvedValue({
      success: true,
      data: {
        total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
        items: {},
        stages: {},
        dateRange: { start: '2026-07-20', end: '2026-07-20', days: 1 },
      },
    })

    await renderPage(['/app/statistics?tab=drops'])
    await flush()

    expect(selectedTab()?.textContent).toContain('掉落记录')
    expect(container.querySelector('[data-testid="drop-records"]')?.textContent).toContain('掉落数据已加载')
  })

  it('switches to the tab of a later navigation without reloading the page', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage(undefined, <RequestDropsNavigation />)
    await flush()
    expect(selectedTab()?.textContent).toContain('干员识别')

    await click(findButton('请求掉落记录')!)

    expect(selectedTab()?.textContent).toContain('掉落记录')
  })

  it('keeps the selected tab in the url and drops the default one', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage(undefined, <RouteProbe />)
    await flush()

    await selectTab('掉落记录')
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/app/statistics?tab=drops')

    await selectTab('干员识别')
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/app/statistics')
  })

  it('shows local loading and recovers from an operator data error with retry', async () => {
    mocks.getAllOperators.mockReturnValue(new Promise(() => {}))
    mocks.getOperBoxData.mockReturnValue(new Promise(() => {}))

    await renderPage()
    expect(container.textContent).toContain('正在读取干员数据')

    await act(async () => root.unmount())
    root = createRoot(container)

    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData
      .mockResolvedValueOnce({ success: false, message: 'Internal Server Error' })
      .mockResolvedValueOnce(ownedOperatorFixture)

    await renderPage()
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
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()

    const trigger = findButton('拥有状态')!
    trigger.focus()
    await click(trigger)

    let menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    let options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(menu.style.width).toBe('128px')
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
    expect(findButton('重置')?.type).toBe('button')

    await click(trigger)
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('right-aligns end-of-row menus on phones', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    await renderPage()
    await flush()

    for (const label of ['职业', '排序']) {
      const trigger = findButton(label)!
      trigger.focus()
      await click(trigger)

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      expect(menu.parentElement?.getAttribute('data-align')).toBe('end')
      expect(menu.style.width).toBe('128px')
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

    await renderPage()
    await flush()
    await selectTab('掉落记录')

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

    await renderPage()
    await flush()
    await selectTab('仓库识别')

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('仓库数据读取失败')
    expect(container.textContent).not.toContain('还没有仓库识别结果')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    await click(findButton('重新加载')!)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('物品种类')
  })

  it('keeps one failed resource from hiding independently loaded operator data', async () => {
    mocks.getDepotData.mockReset().mockResolvedValue({ success: false, message: 'depot down' })
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('测试干员')

    await selectTab('仓库识别')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('仓库数据读取失败')

    await selectTab('干员识别')
    expect(container.textContent).toContain('测试干员')
  })

  it('starts all four first-screen reads without waiting for any of them', async () => {
    const pending = () => new Promise(() => {})
    mocks.getDepotData.mockReturnValue(pending())
    mocks.getOperBoxData.mockReturnValue(pending())
    mocks.getAllOperators.mockReturnValue(pending())
    mocks.getDropStatistics.mockReturnValue(pending())

    await renderPage()
    await flush()

    expect(mocks.getDepotData).toHaveBeenCalledTimes(1)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(1)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)
  })

  it('refreshes materials through the domain command without re-reading the catalog', async () => {
    const events: ResourceInvalidation[] = []
    const unsubscribe = subscribeResourceInvalidation(event => events.push(event))
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    try {
      await renderPage()
      await flush()
      expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)

      await click(findButton('获取材料数据')!)

      expect(mocks.fetchOperatorMaterials).toHaveBeenCalledOnce()
      expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
      expect(mocks.notify).toHaveBeenCalledWith('干员材料数据获取成功！', 'success', { id: 'statistics' })
      expect(events).toContainEqual({
        resources: ['materials', 'training-queue', 'dashboard-snapshot'],
        cause: 'recognition',
      })
    } finally {
      unsubscribe()
    }
  })

  it('writes the parsed depot snapshot and reports the recognition result', async () => {
    const refetch = deferred<unknown>()
    mocks.executeCommand.mockResolvedValue({ success: true })
    mocks.parseDepotData.mockResolvedValue({
      success: true,
      data: {
        itemCount: 3,
        items: [{ id: '30012', name: '识别后的固源岩', count: 30, iconId: 'rock', classifyType: 'MATERIAL' }],
        path: 'depot.json',
      },
    })
    // 识别后的跨域失效会触发页面自身的后台重读；保持挂起，确保断言的是
    // 解析快照写入路径，而不是随后一次 GET 恰好返回了新数据。
    mocks.getDepotData
      .mockResolvedValueOnce({
        success: true,
        data: {
          itemCount: 12,
          items: [{ id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' }],
          timestamp: '2026-07-20T08:00:00.000Z',
        },
      })
      .mockReturnValueOnce(refetch.promise)

    await renderPage()
    await flush()
    await selectTab('仓库识别')
    await click(findButton('立即执行')!)
    await flush()

    expect(mocks.executeCommand).toHaveBeenCalledOnce()
    expect(mocks.parseDepotData).toHaveBeenCalledOnce()
    expect(mocks.notify).toHaveBeenCalledWith('识别完成！共识别 3 种物品', 'success', { id: 'statistics' })
    expect(client.getQueryData(gameDataKeys.resource('depot'))).toMatchObject({
      itemCount: 3,
      items: [{ name: '识别后的固源岩', count: 30 }],
    })
    expect(container.textContent).toContain('物品种类')
  })

  it('writes the parsed operbox snapshot and reports the recognition result', async () => {
    const command = deferred<{ success: boolean }>()
    mocks.executeCommand.mockReturnValue(command.promise)
    mocks.parseOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 2,
        data: [
          { id: 'char_001', name: '识别后的干员', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 1 },
          { id: 'char_002', name: '另一位干员', rarity: 5, profession: 'MEDIC', level: 70, elite: 1, potential: 0 },
        ],
        path: 'operbox.json',
      },
    })
    // 识别后的跨域失效会触发页面自身的后台重读；保持挂起，确保断言的是
    // 解析快照写入路径，而不是随后一次 GET 恰好返回了新数据。
    mocks.getOperBoxData
      .mockReset()
      .mockResolvedValueOnce(ownedOperatorFixture)
      .mockReturnValue(new Promise(() => {}))
    mocks.getAllOperators.mockResolvedValue(catalogFixture)

    await renderPage()
    await flush()
    await selectTab('干员识别')
    await click(findButton('立即执行')!)

    // 运行中按钮由领域命令状态切换为 loading/disabled，不会产生第二个设备命令。
    const runningButton = findButton('正在执行')
    expect(runningButton).toBeDefined()
    expect(runningButton?.disabled).toBe(true)
    await click(runningButton!)

    expect(mocks.executeCommand).toHaveBeenCalledOnce()

    command.resolve({ success: true })
    await flush()

    expect(mocks.parseOperBoxData).toHaveBeenCalledOnce()
    expect(mocks.notify).toHaveBeenCalledWith('识别完成！共识别 2 名干员', 'success', { id: 'statistics' })
    expect(client.getQueryData(gameDataKeys.resource('operbox'))).toMatchObject({
      operCount: 2,
      data: [{ name: '识别后的干员' }, { name: '另一位干员' }],
    })
  })

  it('offers to continue parsing after a parse timeout without executing the command again', async () => {
    vi.useFakeTimers()
    mocks.executeCommand.mockResolvedValue({ success: true })
    mocks.parseDepotData.mockResolvedValue({ success: true, data: null })
    mocks.getDepotData
      .mockResolvedValueOnce({
        success: true,
        data: { itemCount: 12, items: [], timestamp: '2026-07-20T08:00:00.000Z' },
      })
      .mockReturnValueOnce(new Promise(() => {}))

    await renderPage()
    await flush()
    await selectTab('仓库识别')
    await click(findButton('立即执行')!)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_500)
    })
    await flush()

    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(findButton('继续解析')).toBeDefined()

    mocks.parseDepotData.mockResolvedValue({
      success: true,
      data: {
        itemCount: 3,
        items: [{ id: '30012', name: '识别后的固源岩', count: 30, iconId: 'rock', classifyType: 'MATERIAL' }],
        path: 'depot.json',
      },
    })
    await click(findButton('继续解析')!)
    await flush()

    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(gameDataKeys.resource('depot'))).toMatchObject({
      itemCount: 3,
      items: [{ name: '识别后的固源岩' }],
    })
  })

  it('offers a retry label when the command result is uncertain', async () => {
    vi.useFakeTimers()
    mocks.executeCommand
      .mockImplementationOnce((_command, _args, _task, signal: AbortSignal) => abortable(signal))
      .mockResolvedValueOnce({ success: true })
    mocks.parseDepotData.mockResolvedValue({
      success: true,
      data: {
        itemCount: 3,
        items: [{ id: '30012', name: '识别后的固源岩', count: 30, iconId: 'rock', classifyType: 'MATERIAL' }],
        path: 'depot.json',
      },
    })
    mocks.getDepotData
      .mockResolvedValueOnce({
        success: true,
        data: { itemCount: 12, items: [], timestamp: '2026-07-20T08:00:00.000Z' },
      })
      .mockReturnValueOnce(new Promise(() => {}))

    await renderPage()
    await flush()
    await selectTab('仓库识别')
    await click(findButton('立即执行')!)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 500)
    })
    await flush()

    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(findButton('重试识别')).toBeDefined()

    await click(findButton('重试识别')!)
    await flush()

    // 继续的是同一逻辑命令：幂等键复用由 commandOwner 覆盖，页面只重新展示解析结果。
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(gameDataKeys.resource('depot'))).toMatchObject({ itemCount: 3 })
  })

  it('keeps the operator filters across tab switches instead of losing panel state', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_owned', name: '已拥有干员', rarity: 6, profession: 'SNIPER' },
        { id: 'char_missing', name: '未拥有干员', rarity: 4, profession: 'MEDIC' },
      ],
    })
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [{ id: 'char_owned', name: '已拥有干员', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 1 }],
      },
    })

    await renderPage()
    await flush()
    expect(container.textContent).toContain('未拥有干员')

    await click(findButton('拥有状态')!)
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    const ownedOption = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      .find(option => option.textContent === '已拥有')
    await click(ownedOption!)
    expect(container.textContent).toContain('已拥有干员')
    expect(container.textContent).not.toContain('未拥有干员')

    await selectTab('仓库识别')
    await selectTab('干员识别')

    expect(findButton('已拥有')).toBeDefined()
    expect(findButton('重置')).toBeDefined()
    expect(container.textContent).toContain('已拥有干员')
    expect(container.textContent).not.toContain('未拥有干员')
  })

  it('reuses the shared query cache across a page remount', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()
    expect(mocks.getDepotData).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('测试干员')

    await act(async () => root.unmount())
    root = createRoot(container)

    await renderPage()
    await flush()

    expect(mocks.getDepotData).toHaveBeenCalledTimes(1)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(1)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('测试干员')
  })

  it('refetches only the resource named by a cross-domain invalidation', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)

    await act(async () => {
      publishResourceInvalidation({ resources: ['catalog'], cause: 'resource-update' })
    })
    await flush()

    expect(mocks.getAllOperators).toHaveBeenCalledTimes(2)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(1)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(1)
  })

  it('refetches depot, operbox and drops by scope without touching unrelated reads', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogFixture)
    mocks.getOperBoxData.mockResolvedValue(ownedOperatorFixture)

    await renderPage()
    await flush()
    expect(mocks.getDepotData).toHaveBeenCalledTimes(1)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(1)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)

    await act(async () => {
      publishResourceInvalidation({ resources: ['depot'], cause: 'recognition' })
    })
    await flush()
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(1)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)

    await act(async () => {
      publishResourceInvalidation({ resources: ['operbox'], cause: 'recognition' })
    })
    await flush()
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(2)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)

    await act(async () => {
      publishResourceInvalidation({ resources: ['drops'], cause: 'resource-update' })
    })
    await flush()
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(mocks.getDepotData).toHaveBeenCalledTimes(2)
    expect(mocks.getOperBoxData).toHaveBeenCalledTimes(2)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
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

    await renderWithActivity('visible')
    await flush()

    await renderWithActivity('hidden')
    await flush()
    await renderWithActivity('visible')
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
    await selectTab('仓库识别')
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
    await selectTab('干员识别')
    expect(container.textContent).toContain('新干员')
    expect(container.textContent).not.toContain('旧干员')
  })

  it('renders a React-owned fallback when a depot image fails', async () => {
    await renderPage()
    await flush()
    await selectTab('仓库识别')

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    expect(image).not.toBeNull()
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))
    await flush()

    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })

  it('requests depot icons with the item id used by local MAA assets', async () => {
    await renderPage()
    await flush()
    await selectTab('仓库识别')

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    expect(image?.getAttribute('src')).toBe('/items/30012.png')
  })
})
