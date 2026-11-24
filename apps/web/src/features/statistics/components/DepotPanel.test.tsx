// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateItemIconCache } from '@/features/game-data'
import { createQueryClient } from '@/shared/query'
import DepotPanel from './DepotPanel'
import { PANEL_SCROLL_TOP_THRESHOLD_PX } from '../hooks/usePanelScrollTop'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getDepotData: vi.fn(),
}))

const motionState = vi.hoisted(() => ({ reduceMotion: true }))

const availability = vi.hoisted(() => ({ available: true, message: '' }))

vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => ({
    isAvailable: availability.available,
    unavailableMessage: availability.message,
  }),
}))

const fakeRect = (top: number, bottom: number) => ({
  top,
  bottom,
  left: 0,
  right: 400,
  width: 400,
  height: bottom - top,
  x: 0,
  y: top,
  toJSON: () => ({}),
})

const stubRect = (element: Element, top: number, bottom: number) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => fakeRect(top, bottom),
  })
}


vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )

  return { motion: { div: MotionDiv }, useReducedMotion: () => motionState.reduceMotion }
})

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: vi.fn(),
  getDepotData: mocks.getDepotData,
  getOperBoxData: vi.fn(),
  getItemIconUrl: (key: string | number) => `/items/${key}.png`,
}))

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const command = (overrides: Partial<StatisticsCommands> = {}): StatisticsCommands => ({
  isRunning: false,
  activeTask: null,
  activeKind: null,
  actionLabel: () => '识别',
  startRecognition: vi.fn(),
  fetchMaterials: vi.fn(),
  ...overrides,
})

const depotFixture = {
  itemCount: 2,
  items: [
    { id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' },
    { id: '30013', name: '装置', count: 9, iconId: 'device', classifyType: 'MATERIAL' },
  ],
  timestamp: '2026-07-20T08:00:00.000Z',
}

const render = async (panelCommand: StatisticsCommands = command()) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DepotPanel isActive command={panelCommand} />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const depotRegion = () => container.querySelector<HTMLElement>('[role="region"][aria-labelledby="depot-panel-title"]')

const depotList = () => container.querySelector<HTMLElement>('[role="list"][aria-label="仓库物品清单"]')

const kpiGroup = () => container.querySelector<HTMLElement>('[role="group"][aria-label="仓库数据概览"]')

const kpiEntries = () => Array.from(kpiGroup()?.children ?? [])

const kpiValue = (label: string) => Array.from(kpiGroup()?.querySelectorAll('p') ?? [])
  .find(item => item.textContent === label)?.nextElementSibling?.textContent?.trim()

const backToTopButton = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === '回到顶部')

const scrollPanelTo = async (node: HTMLElement, top: number) => {
  node.scrollTop = top
  await act(async () => {
    node.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

const scrollToMock = (node: HTMLElement) => {
  const scrollTo = vi.fn()
  Object.defineProperty(node, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
  return scrollTo
}

const clickButton = async (button: HTMLButtonElement) => {
  await act(async () => {
    button.click()
  })
}

const focus = async (element: HTMLElement) => {
  await act(async () => element.focus())
  await flush()
}

const findButtonByText = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.trim() === text)

const renderWithItems = async () => {
  mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })
  await render()
  const list = depotList()
  expect(list).not.toBeNull()
  return list!
}

const createShell = () => {
  const host = document.createElement('main')
  host.dataset.region = 'scroll'
  stubRect(host, 0, 768)
  document.body.appendChild(host)
  const navbar = document.createElement('header')
  navbar.dataset.region = 'navbar'
  stubRect(navbar, 0, 76)
  const tabbar = document.createElement('footer')
  tabbar.dataset.region = 'tabbar'
  stubRect(tabbar, 696, 768)
  document.body.append(navbar, tabbar)
  const hostBody = document.createElement('div')
  host.appendChild(hostBody)
  return hostBody
}

const renderWithItemsInsideShell = async () => {
  mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })
  document.body.innerHTML = ''
  const hostBody = createShell()
  container = hostBody
  root = createRoot(container)
  await render()
  const list = depotList()
  expect(list).not.toBeNull()
  return list!
}

const stubAnchorRect = (top: number, height = 28) => {
  const anchor = container.querySelector<HTMLElement>('[data-scroll-anchor="back-to-top"]')
  expect(anchor).not.toBeNull()
  stubRect(anchor!, top, top + height)
  return anchor!
}

const hostNode = () => {
  const host = document.querySelector<HTMLElement>('[data-region="scroll"]')
  if (!host) throw new Error('shell scroll host is missing')
  return host
}

const commitGate = async () => {
  await act(async () => {
    hostNode().dispatchEvent(new Event('scroll'))
  })
}

const scrollIndicatorThumb = () =>
  container.querySelector<HTMLElement>('[data-scroll-indicator="thumb"]')

describe('DepotPanel view states', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mocks.getDepotData.mockReset()
    mocks.getDepotData.mockResolvedValue({ success: true, data: null })
    motionState.reduceMotion = true
    availability.available = true
    availability.message = ''
    onlineManager.setOnline(true)
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    onlineManager.setOnline(true)
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('shows the query empty state while an unrelated command is still running', async () => {
    await render(command({ isRunning: true, activeKind: 'materials' }))

    expect(container.textContent).toContain('还没有仓库识别结果')
    expect(container.textContent).toContain('完成一次仓库识别后，物品清单会显示在这里。')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"] > svg')).not.toBeNull()
  })

  it('drives the loading surface from the query alone', async () => {
    mocks.getDepotData.mockReset()
    mocks.getDepotData.mockReturnValue(new Promise(() => {}))

    await render(command({ isRunning: true, activeTask: 'depot', activeKind: 'depot' }))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('正在识别仓库数据')
    expect(status?.parentElement?.hasAttribute('aria-live')).toBe(false)
  })

  it('shows the empty state once the query settles on null even when the command is active', async () => {
    await render(command({ isRunning: true, activeTask: 'depot', activeKind: 'depot' }))

    expect(container.textContent).toContain('还没有仓库识别结果')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('renders the card as a labelled region with a header title and no icon or subtitle', async () => {
    mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })

    await render()

    const region = container.querySelector('[role="region"]')
    expect(region?.getAttribute('aria-labelledby')).toBe('depot-panel-title')

    const title = container.querySelector('#depot-panel-title')
    expect(title?.textContent).toBe('仓库识别')
    expect(title?.getAttribute('role')).toBe('heading')
    expect(title?.getAttribute('aria-level')).toBe('2')
    expect(container.textContent).not.toContain('汇总物品库存、材料分类与数量')
    const decorativeIcons = Array.from(title?.parentElement?.querySelectorAll('svg') ?? [])
      .filter(icon => icon.closest('button') === null)
    expect(decorativeIcons).toEqual([])
  })

  describe('DepotPanel automation availability', () => {
    it('disables the recognition action with a focusable reason', async () => {
      availability.available = false
      availability.message = '后端服务暂不可用，请确认服务已启动'

      await render()

      const recognition = findButtonByText('识别')
      expect(recognition?.disabled).toBe(true)

      const hint = container.querySelector<HTMLElement>(
        '[aria-label="识别：后端服务暂不可用，请确认服务已启动"]',
      )
      expect(hint).not.toBeNull()
      expect(hint?.tabIndex).toBe(0)

      await focus(hint!)
      expect(document.querySelector('[role="tooltip"]')?.textContent)
        .toBe('后端服务暂不可用，请确认服务已启动')
    })

    it('leaves the action enabled without a hint while the backend is available', async () => {
      await render()

      expect(findButtonByText('识别')?.disabled).toBe(false)
      expect(container.querySelector('[aria-label$="后端服务暂不可用，请确认服务已启动"]')).toBeNull()
    })

    it('keeps the running action unwrapped while the backend is unavailable', async () => {
      availability.available = false
      availability.message = '后端服务暂不可用，请确认服务已启动'

      await render(command({ isRunning: true, activeTask: 'depot', activeKind: 'depot' }))

      const running = findButtonByText('正在执行')
      expect(running?.disabled).toBe(true)
      expect(container.querySelector('[aria-label="识别：后端服务暂不可用，请确认服务已启动"]')).toBeNull()
      expect(running?.closest('[aria-label]')).toBeNull()
    })
  })

  it('merges the top item and latest recognition time into one KPI entry', async () => {
    mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })

    await render()

    const group = kpiGroup()
    expect(group?.getAttribute('aria-label')).toBe('仓库数据概览')

    const entries = kpiEntries()
    expect(entries).toHaveLength(5)

    expect(kpiValue('物品种类')).toBe('2')
    expect(kpiValue('材料种类')).toBe('2')
    expect(kpiValue('识别分类')).toBe('1')
    expect(kpiValue('库存总量')).toBe('21')

    const merged = entries[entries.length - 1]
    expect(merged?.textContent).toContain('库存最多')
    expect(merged?.textContent).toContain('固源岩')
    expect(merged?.textContent).toContain('最近识别')
    expect(merged?.textContent).toContain(new Date(depotFixture.timestamp).toLocaleString('zh-CN'))
    expect(merged?.querySelectorAll(':scope > div > div')).toHaveLength(2)
  })

  it('keeps the merged KPI filled when the snapshot carries no timestamp', async () => {
    mocks.getDepotData.mockResolvedValue({
      success: true,
      data: { ...depotFixture, timestamp: undefined },
    })

    await render()

    expect(kpiEntries()).toHaveLength(5)
    expect(kpiEntries()[kpiEntries().length - 1]?.textContent).toContain('最近识别-')
  })

  it('renders read-only item and category chips as badges without hover affordance', async () => {
    mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })

    await render()

    const badges = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="badge"]'))
    expect(badges.length).toBeGreaterThan(0)
    for (const badge of badges) {
      expect(badge.closest('button, a, [role="button"]')).toBeNull()
    }

    const chips = badges.map(badge => badge.textContent)

    expect(chips).toContain('材料·2 种/21 件')
    expect(chips).toContain('材料')
    expect(chips).toContain('×12')
    expect(chips).toContain('×9')
  })

  it('retries a failed depot icon after the icon cache version advances', async () => {
    mocks.getDepotData.mockResolvedValue({ success: true, data: depotFixture })

    await render()

    const failImage = async () => {
      await act(async () => {
        container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
          ?.dispatchEvent(new Event('error', { bubbles: true }))
      })
    }

    await failImage()
    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()

    await act(async () => {
      invalidateItemIconCache()
    })
    expect(container.querySelector('img[alt="固源岩"]')).not.toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).toBeNull()

    await failImage()
    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })

  describe('DepotPanel in-panel scrolling', () => {
    it('keeps the card header, KPI and category summary outside the item scroll container', async () => {
      const list = await renderWithItems()
      const region = depotRegion()

      expect(region).not.toBeNull()
      expect(region!.contains(list)).toBe(true)
      expect(list.contains(region!.querySelector('#depot-panel-title'))).toBe(false)
      expect(list.contains(region!.querySelector('[role="group"][aria-label="仓库数据概览"]'))).toBe(false)
      expect(list.contains(region!.querySelector('#depot-category-title'))).toBe(false)
      expect(list.getAttribute('tabindex')).toBe('0')
    })

    it('reveals a back-to-top button only after scrolling past the threshold', async () => {
      const list = await renderWithItems()

      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, PANEL_SCROLL_TOP_THRESHOLD_PX - 1)
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, PANEL_SCROLL_TOP_THRESHOLD_PX + 40)
      const button = backToTopButton()
      expect(button).toBeDefined()
      expect(button!.tagName).toBe('BUTTON')
      expect(button!.type).toBe('button')

      await scrollPanelTo(list, 0)
      expect(backToTopButton()).toBeUndefined()
    })

    it('scrolls the depot grid itself back to the top when the button is activated', async () => {
      const list = await renderWithItems()
      const scrollTo = scrollToMock(list)

      await scrollPanelTo(list, 420)
      const button = backToTopButton()
      expect(button).toBeDefined()
      expect((button!.textContent ?? '').trim()).toBe('回到顶部')

      await clickButton(button!)

      expect(list.scrollTop).toBe(0)
      expect(scrollTo).not.toHaveBeenCalled()
      expect(backToTopButton()).toBeUndefined()
    })

    it('hides the button while the anchor falls into the tabbar overlay band', async () => {
      const list = await renderWithItemsInsideShell()

      await scrollPanelTo(list, 420)
      stubAnchorRect(92)
      await commitGate()
      expect(backToTopButton()).toBeDefined()

      stubAnchorRect(700)
      await commitGate()
      expect(backToTopButton()).toBeUndefined()

      stubAnchorRect(92)
      await commitGate()
      expect(backToTopButton()).toBeDefined()
    })

    it('hides the button while the anchor is still behind the navbar', async () => {
      const list = await renderWithItemsInsideShell()

      await scrollPanelTo(list, 420)
      stubAnchorRect(60)
      await commitGate()
      expect(backToTopButton()).toBeUndefined()

      stubAnchorRect(76)
      await commitGate()
      expect(backToTopButton()).toBeDefined()
    })

    it('keeps the panel on a clip overflow so the sticky anchor tracks the page', async () => {
      await renderWithItemsInsideShell()
      const card = depotRegion()!

      expect(card.classList.contains('overflow-clip')).toBe(true)
      expect(card.classList.contains('overflow-hidden')).toBe(false)
    })

    it('hides the button when the panel clip cuts the anchor short', async () => {
      const list = await renderWithItemsInsideShell()

      await scrollPanelTo(list, 420)
      stubAnchorRect(92)
      await commitGate()
      expect(backToTopButton()).toBeDefined()

      const card = depotRegion()!
      stubRect(card, 0, 100)
      await commitGate()
      expect(backToTopButton()).toBeUndefined()

      stubRect(card, 0, 128)
      await commitGate()
      expect(backToTopButton()).toBeDefined()
    })

    it('gates from synchronous geometry instead of a deferred intersection observer', async () => {
      const observerSpy = vi.fn()
      vi.stubGlobal('IntersectionObserver', observerSpy)

      const list = await renderWithItemsInsideShell()

      await scrollPanelTo(list, 420)
      stubAnchorRect(92)
      await commitGate()

      expect(observerSpy).not.toHaveBeenCalled()
      expect(backToTopButton()).toBeDefined()
    })

    it('drives the outside scroll indicator from the panel scroll progress', async () => {
      const list = await renderWithItems()
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 })

      await scrollPanelTo(list, 0)
      const thumb = scrollIndicatorThumb()
      expect(thumb).not.toBeNull()
      expect(thumb!.style.height).toBe('50%')
      expect(thumb!.style.top).toBe('0%')

      await scrollPanelTo(list, 250)
      expect(scrollIndicatorThumb()!.style.top).toBe('25%')

      expect(thumb!.parentElement!.getAttribute('aria-hidden')).toBe('true')
    })

    it('anchors the button in the panel coordinate space instead of the grid scroll content', async () => {
      const list = await renderWithItems()
      await scrollPanelTo(list, 420)

      const button = backToTopButton()!
      const anchor = button.parentElement!
      const region = depotRegion()!

      expect(region.contains(anchor)).toBe(true)
      expect(anchor.closest('[role="list"]')).toBeNull()
      expect(list.contains(button)).toBe(false)
      expect(anchor.nextElementSibling).toBe(list.parentElement)
      expect(anchor.contains(button)).toBe(true)
      expect(anchor.style.height).toBe('1.75rem')
      expect(anchor.style.marginBottom).toBe('-1.75rem')
    })

    it('keeps the button horizontally centered in the anchor', async () => {
      const list = await renderWithItems()
      await scrollPanelTo(list, 420)

      const anchor = backToTopButton()!.parentElement!
      expect(anchor.style.justifyContent).toBe('center')
      expect(anchor.style.pointerEvents).toBe('none')
      expect(backToTopButton()!.style.pointerEvents).toBe('auto')
    })

    it('jumps without smooth scrolling when the user prefers reduced motion', async () => {
      motionState.reduceMotion = true
      const list = await renderWithItems()
      const scrollTo = scrollToMock(list)

      await scrollPanelTo(list, 420)
      await clickButton(backToTopButton()!)

      expect(scrollTo).not.toHaveBeenCalled()
      expect(list.scrollTop).toBe(0)
      expect(backToTopButton()).toBeUndefined()
    })

    it('moves focus into the depot grid after returning to the top', async () => {
      const list = await renderWithItems()

      await scrollPanelTo(list, 420)
      const button = backToTopButton()!
      await act(async () => {
        button.focus()
      })
      expect(document.activeElement).toBe(button)

      await clickButton(button)

      expect(document.activeElement).toBe(list)
    })

    it('does not render a back-to-top button without item rows', async () => {
      await render()

      expect(container.textContent).toContain('还没有仓库识别结果')
      expect(depotList()).toBeNull()
      expect(backToTopButton()).toBeUndefined()
    })

    it('does not render a back-to-top button when the depot read fails', async () => {
      mocks.getDepotData.mockResolvedValue({ success: false, message: '仓库服务不可用' })

      await render()

      expect(container.querySelector('[role="alert"]')?.textContent).toContain('仓库数据读取失败')
      expect(depotList()).toBeNull()
      expect(backToTopButton()).toBeUndefined()
    })
  })

})
