// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameDataKeys, invalidateItemIconCache } from '@/features/game-data'
import { createQueryClient } from '@/shared/query'
import OperatorPanel from './OperatorPanel'
import DepotPanel from './DepotPanel'
import { PANEL_SCROLL_TOP_THRESHOLD_PX } from '../hooks/usePanelScrollTop'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getAllOperators: vi.fn(),
  getOperBoxData: vi.fn(),
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
  getAllOperators: mocks.getAllOperators,
  getDepotData: mocks.getDepotData,
  getOperBoxData: mocks.getOperBoxData,
  getItemIconUrl: (key: string | number) => `/items/${key}.png`,
  getOperatorAvatarUrl: (operatorId: string, variant: string = 'base') =>
    `/avatars/${operatorId}${variant === 'base' ? '' : `_${variant}`}.png`,
}))

const operator = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  rarity: 4,
  profession: 'SNIPER',
  level: 0,
  elite: 0,
  potential: 1,
  ...overrides,
})

const catalogPayload = (operators: unknown[]) => ({ success: true, data: operators })
const operBoxPayload = (data: unknown[], overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    operCount: data.length,
    data,
    timestamp: '2026-07-20T08:00:00.000Z',
    ...overrides,
  },
})

const command = (overrides: Partial<StatisticsCommands> = {}): StatisticsCommands => ({
  isRunning: false,
  activeTask: null,
  activeKind: null,
  actionLabel: () => '识别',
  startRecognition: vi.fn(),
  fetchMaterials: vi.fn(),
  ...overrides,
})

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const render = async (panelCommand: StatisticsCommands = command()) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <OperatorPanel isActive command={panelCommand} />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const kpiGroup = () => container.querySelector<HTMLElement>('[role="group"][aria-label="干员数据概览"]')

const kpiValue = (label: string) => {
  const group = kpiGroup()
  const term = Array.from(group?.querySelectorAll('dt') ?? [])
    .find(item => item.textContent === label)
  return term?.nextElementSibling?.textContent
}

const operatorItems = () => Array.from(container.querySelectorAll<HTMLElement>('[role="listitem"]'))

const panelRegion = (titleId: string) =>
  container.querySelector<HTMLElement>(`[role="region"][aria-labelledby="${titleId}"]`)

const operatorList = () => container.querySelector<HTMLElement>('[role="list"][aria-label="干员列表"]')

const depotList = () => container.querySelector<HTMLElement>('[role="list"][aria-label="仓库物品清单"]')

const backToTopButton = (scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
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

const commitGate = async () => {
  await act(async () => {
    hostNode().dispatchEvent(new Event('scroll'))
  })
}

const hostNode = () => {
  const host = document.querySelector<HTMLElement>('[data-region="scroll"]')
  if (!host) throw new Error('shell scroll host is missing')
  return host
}

const stubAnchorRect = (top: number, height = 28) => {
  const anchor = container.querySelector<HTMLElement>('[data-scroll-anchor="back-to-top"]')
  expect(anchor).not.toBeNull()
  stubRect(anchor!, top, top + height)
  return anchor!
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

const scrollIndicatorThumb = () =>
  container.querySelector<HTMLElement>('[data-scroll-indicator="thumb"]')

const loadOperatorRows = () => {
  mocks.getAllOperators.mockResolvedValue(catalogPayload([
    operator('char_alpha', '阿尔法', { rarity: 6 }),
    operator('char_beta', '贝塔', { rarity: 5 }),
  ]))
  mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
    operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
  ]))
}

const loadDepotRows = () => {
  mocks.getDepotData.mockResolvedValue({
    success: true,
    data: {
      itemCount: 2,
      items: [
        { id: '30012', name: '固源岩', count: 12, iconId: 'rock', classifyType: 'MATERIAL' },
        { id: '30013', name: '装置', count: 9, iconId: 'device', classifyType: 'MATERIAL' },
      ],
      timestamp: '2026-07-20T08:00:00.000Z',
    },
  })
}

const operatorScrollFixture = async () => {
  loadOperatorRows()
  await render()
  const list = operatorList()
  expect(list).not.toBeNull()
  return list!
}

const operatorScrollFixtureInsideShell = async () => {
  loadOperatorRows()
  document.body.innerHTML = ''
  const hostBody = createShell()
  container = hostBody
  root = createRoot(container)
  await render()
  const list = operatorList()
  expect(list).not.toBeNull()
  return list!
}

const renderBothPanels = async () => {
  loadOperatorRows()
  loadDepotRows()
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <OperatorPanel isActive command={command()} />
        <DepotPanel isActive command={command()} />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const selectOption = async (triggerLabel: string, optionLabel: string) => {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent === triggerLabel)
  await act(async () => trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    .find(item => item.textContent === optionLabel)
  await act(async () => option?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
}

describe('OperatorPanel coverage and query states', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mocks.getAllOperators.mockReset()
    mocks.getOperBoxData.mockReset()
    mocks.getDepotData.mockReset()
    mocks.getAllOperators.mockResolvedValue(catalogPayload([]))
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: null })
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

  it('shows an unknown coverage instead of inventing a denominator from the snapshot', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload(
      [operator('char_alpha', '阿尔法', { level: 80 })],
      {
        operTotal: 1,
        allOpers: [{ id: 'char_alpha', name: '阿尔法', rarity: 4, owned: true }],
        recognition: { status: 'partial', total: 1, owned: 1 },
      },
    ))

    await render()

    expect(container.textContent).toContain('阿尔法')
    expect(kpiValue('档案覆盖')).toBe('—')
  })

  it('clamps coverage at 100% when the owned count exceeds the catalogue', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
      operator('char_beta', '贝塔', { rarity: 5, level: 50 }),
    ]))

    await render()

    expect(kpiValue('档案覆盖')).toBe('100%')
  })

  it('rounds trusted coverage from the remote catalogue only', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法'),
      operator('char_beta', '贝塔'),
      operator('char_gamma', '伽马'),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { level: 80 }),
      operator('char_beta', '贝塔', { level: 50 }),
    ]))

    await render()

    expect(kpiValue('干员资料')).toBe('3')
    expect(kpiValue('档案覆盖')).toBe('67%')
  })

  it('excludes snapshot fallback entries from the coverage denominator', async () => {
    mocks.getAllOperators.mockResolvedValue({ success: false, message: '目录服务不可用' })
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload(
      [operator('char_alpha', '阿尔法', { level: 80 })],
      {
        allOpers: [
          { id: 'char_alpha', name: '阿尔法', rarity: 6, owned: true },
          { id: 'char_beta', name: '贝塔', rarity: 5, owned: false },
        ],
      },
    ))

    await render()

    expect(container.textContent).toContain('贝塔')
    expect(kpiValue('干员资料')).toBe('—')
    expect(kpiValue('档案覆盖')).toBe('—')
  })

  it('shows the empty state while an unrelated command keeps running', async () => {
    await render(command({ isRunning: true, activeKind: 'materials' }))

    expect(container.textContent).toContain('还没有干员识别结果')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('drives the loading surface from the query alone and keeps the running button', async () => {
    mocks.getAllOperators.mockReturnValue(new Promise(() => {}))
    mocks.getOperBoxData.mockReturnValue(new Promise(() => {}))

    await render(command({ isRunning: true, activeTask: 'operbox', activeKind: 'operbox' }))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('正在识别干员数据')
    expect(status?.parentElement?.hasAttribute('aria-live')).toBe(false)
    expect(container.textContent).toContain('正在执行')
  })

  it('shows the empty state instead of a blank panel while materials refresh', async () => {
    await render(command({ isRunning: true, activeKind: 'materials' }))

    expect(container.textContent).toContain('还没有干员识别结果')
  })

  it('restores a failed avatar once the icon cache version advances', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    await render()

    const failAvatar = async () => {
      await act(async () => {
        container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')
          ?.dispatchEvent(new Event('error', { bubbles: true }))
      })
      await flush()
    }

    await failAvatar()
    await failAvatar()
    await failAvatar()

    expect(container.querySelector('img[alt="阿尔法"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="阿尔法头像不可用"]')).not.toBeNull()

    await act(async () => {
      invalidateItemIconCache()
    })
    await flush()

    expect(container.querySelector('img[alt="阿尔法"]')).not.toBeNull()
    expect(container.querySelector('[role="img"][aria-label="阿尔法头像不可用"]')).toBeNull()
  })

  it('resets avatar variants and load state when the icon cache version advances', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    await render()

    const avatarSrc = () => container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')?.getAttribute('src')
    const busyFrame = () => container.querySelector('[role="listitem"] [aria-busy="true"]')

    expect(avatarSrc()).toBe('/avatars/char_alpha.png')
    expect(busyFrame()).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')
        ?.dispatchEvent(new Event('load'))
    })
    await flush()
    expect(busyFrame()).toBeNull()

    await act(async () => {
      container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')
        ?.dispatchEvent(new Event('error', { bubbles: true }))
    })
    await flush()
    expect(avatarSrc()).toBe('/avatars/char_alpha_2.png')

    await act(async () => {
      invalidateItemIconCache()
    })
    await flush()

    expect(avatarSrc()).toBe('/avatars/char_alpha.png')
    expect(busyFrame()).not.toBeNull()
  })

  it('falls back through the numbered avatar variants before failing', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    await render()

    const avatarSrc = () => container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')?.getAttribute('src')
    const failAvatar = async () => {
      await act(async () => {
        container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')
          ?.dispatchEvent(new Event('error', { bubbles: true }))
      })
      await flush()
    }

    expect(avatarSrc()).toBe('/avatars/char_alpha.png')

    await failAvatar()
    expect(avatarSrc()).toBe('/avatars/char_alpha_2.png')

    await failAvatar()
    expect(avatarSrc()).toBe('/avatars/char_alpha_1.png')
  })

  it('renders the card as a labelled region with a header title and no icon or subtitle', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    await render()

    const region = container.querySelector('[role="region"]')
    expect(region?.getAttribute('aria-labelledby')).toBe('operator-panel-title')

    const title = container.querySelector('#operator-panel-title')
    expect(title?.textContent).toBe('干员识别')
    expect(title?.getAttribute('role')).toBe('heading')
    expect(title?.getAttribute('aria-level')).toBe('2')
    expect(container.textContent).not.toContain('读取档案、等级、精英化与潜能数据')
    const decorativeIcons = Array.from(title?.parentElement?.querySelectorAll('svg') ?? [])
      .filter(icon => icon.closest('button') === null)
    expect(decorativeIcons).toEqual([])
  })

  it('groups the KPI row and reports read-only chips without interactive affordance', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
      operator('char_beta', '贝塔', { rarity: 5 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload(
      [operator('char_alpha', '阿尔法', { rarity: 6, level: 80, elite: 2, potential: 3 })],
      {
        allOpers: [
          { id: 'char_alpha', name: '阿尔法', rarity: 6, owned: true },
          { id: 'char_beta', name: '贝塔', rarity: 5, owned: false },
        ],
        recognition: { status: 'complete', total: 2, owned: 1 },
      },
    ))

    await render()

    const group = kpiGroup()
    expect(group).not.toBeNull()
    expect(Array.from(group!.querySelectorAll('dt')).map(item => item.textContent))
      .toEqual(['已识别', '干员资料', '档案覆盖'])

    const kpiGrid = group!.querySelector('dl')
    expect(kpiGrid?.children).toHaveLength(3)
    expect(group!.textContent).not.toContain('当前显示')

    const items = operatorItems()
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.querySelector('button, a, [role="button"]')).toBeNull()
    }
    expect(items[0]?.textContent).toContain('精2')
    expect(items[0]?.textContent).toContain('Lv.80')
    expect(items[0]?.textContent).not.toContain('未拥有')
    expect(items[1]?.textContent).toContain('未拥有')
  })

  it('marks the avatar frame as busy until the image loads', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6 }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    await render()

    expect(container.querySelector('[role="listitem"] [aria-busy="true"]')).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLImageElement>('img[alt="阿尔法"]')
        ?.dispatchEvent(new Event('load'))
    })
    await flush()

    expect(container.querySelector('[role="listitem"] [aria-busy="true"]')).toBeNull()
  })

  it('renders the canonical action label passed down by the command hook', async () => {
    const actionButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .map(button => button.textContent ?? '')
      .filter(label => label !== '获取材料数据')

    await render(command({ actionLabel: () => '识别' }))
    expect(actionButtons()).toContain('识别')

    await act(async () => root.unmount())
    root = createRoot(container)
    await render(command({ actionLabel: () => '重新识别' }))
    expect(actionButtons()).toContain('重新识别')

    await act(async () => root.unmount())
    root = createRoot(container)
    await render(command({ actionLabel: () => '继续解析' }))
    expect(actionButtons()).toContain('继续解析')
  })

  it('keeps the action buttons text-only so their accessible name matches the label', async () => {
    await render()

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    const recognition = buttons.find(button => button.textContent?.trim() === '识别')
    const materials = buttons.find(button => button.textContent?.trim() === '获取材料数据')

    expect(recognition).toBeDefined()
    expect(materials).toBeDefined()
    expect(recognition!.querySelector('svg')).toBeNull()
    expect(materials!.querySelector('svg')).toBeNull()
  })

  it('keeps a spinner beside the running action label', async () => {
    mocks.getAllOperators.mockReturnValue(new Promise(() => {}))
    mocks.getOperBoxData.mockReturnValue(new Promise(() => {}))

    await render(command({ isRunning: true, activeTask: 'operbox', activeKind: 'operbox' }))

    const running = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('正在执行'))

    expect(running).toBeDefined()
    expect(running!.querySelector('svg')).not.toBeNull()
  })

  describe('OperatorPanel automation availability', () => {
    it('disables the recognition and materials actions with a focusable reason', async () => {
      availability.available = false
      availability.message = '后端服务暂不可用，请确认服务已启动'

      await render()

      const recognition = findButtonByText('识别')
      const materials = findButtonByText('获取材料数据')

      expect(recognition?.disabled).toBe(true)
      expect(materials?.disabled).toBe(true)

      const recognitionHint = container.querySelector<HTMLElement>(
        '[aria-label="识别：后端服务暂不可用，请确认服务已启动"]',
      )
      const materialsHint = container.querySelector<HTMLElement>(
        '[aria-label="获取材料数据：后端服务暂不可用，请确认服务已启动"]',
      )
      expect(recognitionHint).not.toBeNull()
      expect(materialsHint).not.toBeNull()
      expect(recognitionHint?.tabIndex).toBe(0)

      await focus(recognitionHint!)
      expect(document.querySelector('[role="tooltip"]')?.textContent)
        .toBe('后端服务暂不可用，请确认服务已启动')
    })

    it('leaves both actions enabled without a hint while the backend is available', async () => {
      await render()

      expect(findButtonByText('识别')?.disabled).toBe(false)
      expect(findButtonByText('获取材料数据')?.disabled).toBe(false)
      expect(container.querySelector('[aria-label$="后端服务暂不可用，请确认服务已启动"]')).toBeNull()
    })

    it('keeps the running recognition action unwrapped while the backend is unavailable', async () => {
      availability.available = false
      availability.message = '后端服务暂不可用，请确认服务已启动'

      await render(command({ isRunning: true, activeTask: 'operbox', activeKind: 'operbox' }))

      const running = findButtonByText('正在执行')
      expect(running?.disabled).toBe(true)
      expect(container.querySelector('[aria-label="识别：后端服务暂不可用，请确认服务已启动"]')).toBeNull()
      expect(running?.closest('[aria-label]')).toBeNull()
    })

    it('keeps the running materials refresh unwrapped while the backend is unavailable', async () => {
      availability.available = false
      availability.message = '后端服务暂不可用，请确认服务已启动'

      await render(command({ isRunning: true, activeKind: 'materials' }))

      const running = findButtonByText('正在获取')
      expect(running).toBeDefined()
      expect(running?.disabled).toBe(true)
      expect(running?.getAttribute('aria-busy')).toBe('true')
      expect(container.querySelector('[aria-label="获取材料数据：后端服务暂不可用，请确认服务已启动"]')).toBeNull()
      expect(running?.closest('[aria-label]')).toBeNull()
    })
  })

  it('renders a bare 24px lucide icon in the empty state', async () => {
    client.clear()

    await render()

    const title = Array.from(container.querySelectorAll('strong'))
      .find(item => item.textContent === '还没有干员识别结果')
    const icons = Array.from(title?.parentElement?.querySelectorAll('svg') ?? [])

    expect(icons).toHaveLength(1)
    expect(icons[0]?.getAttribute('width')).toBe('24')
    expect(icons[0]?.getAttribute('stroke-width')).toBe('1.7')
  })

  it('hides stale coverage once a refetch of the remote catalogue fails', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法'),
      operator('char_beta', '贝塔'),
      operator('char_gamma', '伽马'),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { level: 80 }),
      operator('char_beta', '贝塔', { level: 50 }),
    ]))

    await render()

    expect(kpiValue('干员资料')).toBe('3')
    expect(kpiValue('档案覆盖')).toBe('67%')

    mocks.getAllOperators.mockResolvedValue({ success: false, message: '目录服务不可用' })
    await act(async () => {
      await client.invalidateQueries({ queryKey: gameDataKeys.resource('catalog') })
    })
    await flush()

    expect(kpiValue('干员资料')).toBe('—')
    expect(kpiValue('档案覆盖')).toBe('—')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('干员数据读取失败')
    expect(container.textContent).toContain('阿尔法')
  })

  it('keeps elite filters on the unowned view of a snapshot catalogue', async () => {
    mocks.getAllOperators.mockResolvedValue({ success: false, message: '目录服务不可用' })
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload(
      [operator('char_alpha', '阿尔法', { profession: '', level: 80, elite: 2, potential: 3 })],
      {
        allOpers: [
          { id: 'char_alpha', name: '阿尔法', rarity: 6, owned: true },
          { id: 'char_beta', name: '贝塔', rarity: 5, owned: false },
        ],
        recognition: { status: 'complete', total: 2, owned: 1 },
      },
    ))

    await render()

    await selectOption('拥有状态', '未拥有')
    expect(operatorItems().map(item => item.textContent)).toEqual([expect.stringContaining('贝塔')])

    await selectOption('精英化', '精英0')
    expect(operatorItems().map(item => item.textContent)).toEqual([expect.stringContaining('贝塔')])
  })

  it('explains that the snapshot catalogue cannot filter by profession', async () => {
    mocks.getAllOperators.mockResolvedValue({ success: false, message: '目录服务不可用' })
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload(
      [operator('char_alpha', '阿尔法', { profession: '', level: 80, elite: 2, potential: 3 })],
      {
        allOpers: [
          { id: 'char_alpha', name: '阿尔法', rarity: 6, owned: true },
          { id: 'char_beta', name: '贝塔', rarity: 5, owned: false },
        ],
        recognition: { status: 'complete', total: 2, owned: 1 },
      },
    ))

    await render()

    expect(operatorItems()).toHaveLength(2)

    await selectOption('职业', '狙击')

    expect(operatorItems()).toEqual([])
    expect(container.textContent).toContain('显示 0 项')
    expect(container.textContent).toContain('快照目录不含职业信息')
    expect(container.textContent).toContain('无法按职业筛选')
  })

  it('keeps profession filtering available for a trusted remote catalogue', async () => {
    mocks.getAllOperators.mockResolvedValue(catalogPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, profession: 'SNIPER' }),
      operator('char_beta', '贝塔', { rarity: 5, profession: 'MEDIC' }),
    ]))
    mocks.getOperBoxData.mockResolvedValue(operBoxPayload([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
      operator('char_beta', '贝塔', { rarity: 5, level: 50, profession: 'MEDIC' }),
    ]))

    await render()

    await selectOption('职业', '狙击')

    expect(operatorItems().map(item => item.textContent)).toEqual([expect.stringContaining('阿尔法')])
    expect(container.textContent).not.toContain('快照目录不含职业信息')
  })

  describe('OperatorPanel in-panel scrolling', () => {
    it('keeps the header, KPI and filter section outside the operator scroll container', async () => {
      await operatorScrollFixture()

      const list = operatorList()!
      const region = panelRegion('operator-panel-title')

      expect(region).not.toBeNull()
      expect(region!.contains(list)).toBe(true)
      expect(list.contains(region!.querySelector('[role="group"][aria-label="干员数据概览"]'))).toBe(false)
      expect(list.contains(region!.querySelector('#operator-filter-title'))).toBe(false)
      expect(list.contains(region!.querySelector('#operator-panel-title'))).toBe(false)
      expect(list.getAttribute('tabindex')).toBe('0')
    })

    it('reveals a back-to-top button only after scrolling past the threshold', async () => {
      const list = await operatorScrollFixture()

      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, PANEL_SCROLL_TOP_THRESHOLD_PX - 1)
      expect(backToTopButton(panelRegion('operator-panel-title')!)).toBeUndefined()

      await scrollPanelTo(list, PANEL_SCROLL_TOP_THRESHOLD_PX + 40)
      const button = backToTopButton()
      expect(button).toBeDefined()
      expect(button!.getAttribute('aria-label')).toBeNull()
      expect(button!.tagName).toBe('BUTTON')
      expect(button!.type).toBe('button')

      await scrollPanelTo(list, PANEL_SCROLL_TOP_THRESHOLD_PX)
      expect(backToTopButton()).toBeUndefined()
    })

    it('hides the button while the anchor falls into the tabbar overlay band', async () => {
      await operatorScrollFixtureInsideShell()
      const list = operatorList()!

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
      await operatorScrollFixtureInsideShell()
      const list = operatorList()!

      await scrollPanelTo(list, 420)
      stubAnchorRect(60)
      await commitGate()
      expect(backToTopButton()).toBeUndefined()

      stubAnchorRect(76)
      await commitGate()
      expect(backToTopButton()).toBeDefined()
    })

    it('keeps the panel on a clip overflow so the sticky anchor tracks the page', async () => {
      await operatorScrollFixtureInsideShell()
      const card = panelRegion('operator-panel-title')!

      expect(card.classList.contains('overflow-clip')).toBe(true)
      expect(card.classList.contains('overflow-hidden')).toBe(false)
    })

    it('hides the button when the panel clip cuts the anchor short', async () => {
      await operatorScrollFixtureInsideShell()
      const list = operatorList()!

      await scrollPanelTo(list, 420)
      stubAnchorRect(92)
      await commitGate()
      expect(backToTopButton()).toBeDefined()

      const card = panelRegion('operator-panel-title')!
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

      await operatorScrollFixtureInsideShell()
      const list = operatorList()!

      await scrollPanelTo(list, 420)
      stubAnchorRect(92)
      await commitGate()

      expect(observerSpy).not.toHaveBeenCalled()
      expect(backToTopButton()).toBeDefined()

      stubAnchorRect(700)
      await commitGate()
      expect(backToTopButton()).toBeUndefined()
    })

    it('drives the outside scroll indicator from the panel scroll progress', async () => {
      const list = await operatorScrollFixture()
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 })

      await scrollPanelTo(list, 0)
      const thumb = scrollIndicatorThumb()
      expect(thumb).not.toBeNull()
      expect(thumb!.style.height).toBe('50%')
      expect(thumb!.style.top).toBe('0%')

      await scrollPanelTo(list, 250)
      expect(scrollIndicatorThumb()!.style.top).toBe('25%')

      await scrollPanelTo(list, 500)
      expect(scrollIndicatorThumb()!.style.top).toBe('50%')

      const indicator = thumb!.parentElement!
      expect(indicator.getAttribute('aria-hidden')).toBe('true')
    })

    it('does not render the scroll indicator without overflow', async () => {
      await operatorScrollFixture()

      expect(scrollIndicatorThumb()).toBeNull()
    })

    it('keeps the button horizontally centered in the anchor', async () => {
      const list = await operatorScrollFixture()
      await scrollPanelTo(list, 420)

      const anchor = backToTopButton()!.parentElement!
      expect(anchor.style.justifyContent).toBe('center')
      expect(anchor.style.pointerEvents).toBe('none')
      expect(backToTopButton()!.style.pointerEvents).toBe('auto')
    })

    it('places the button on a zero-net-height anchor above a shared scroll wrapper', async () => {
      const list = await operatorScrollFixture()
      await scrollPanelTo(list, 420)

      const button = backToTopButton()!
      const anchor = button.parentElement!
      const region = panelRegion('operator-panel-title')!
      const wrapper = anchor.nextElementSibling!

      expect(region.contains(anchor)).toBe(true)
      expect(anchor.closest('[role="list"]')).toBeNull()
      expect(list.contains(button)).toBe(false)
      expect(wrapper).toBe(list.parentElement)
      expect(wrapper.firstElementChild).toBe(list)
      expect(anchor.contains(button)).toBe(true)
      expect(anchor.style.height).toBe('1.75rem')
      expect(anchor.style.marginBottom).toBe('-1.75rem')
    })

    it('scrolls the operator grid itself back to the top when the button is activated', async () => {
      const list = await operatorScrollFixture()
      const scrollTo = scrollToMock(list)

      await scrollPanelTo(list, 420)
      const button = backToTopButton()
      expect(button).toBeDefined()

      await clickButton(button!)

      expect(list.scrollTop).toBe(0)
      expect(scrollTo).not.toHaveBeenCalled()
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, 320)
      expect(list.scrollTop).toBe(320)
      expect(backToTopButton()).toBeDefined()
    })

    it('shows the button again when a user scroll intent interrupts the smooth return', async () => {
      motionState.reduceMotion = false
      const list = await operatorScrollFixture()
      scrollToMock(list)

      await scrollPanelTo(list, 600)
      await clickButton(backToTopButton()!)

      expect(backToTopButton()).toBeUndefined()

      await act(async () => {
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
        list.scrollTop = 327
        list.dispatchEvent(new Event('scroll', { bubbles: true }))
      })

      expect(backToTopButton()).toBeDefined()
    })

    it('releases the return suppression when the interrupted scroll settles', async () => {
      motionState.reduceMotion = false
      const list = await operatorScrollFixture()
      scrollToMock(list)

      await scrollPanelTo(list, 600)
      await clickButton(backToTopButton()!)

      await act(async () => {
        list.scrollTop = 320
        list.dispatchEvent(new Event('scroll', { bubbles: true }))
        list.dispatchEvent(new Event('scrollend'))
      })

      expect(backToTopButton()).toBeDefined()
    })

    it('jumps without smooth scrolling when the user prefers reduced motion', async () => {
      motionState.reduceMotion = true
      const list = await operatorScrollFixture()
      const scrollTo = scrollToMock(list)

      await scrollPanelTo(list, 420)
      await clickButton(backToTopButton()!)

      expect(scrollTo).not.toHaveBeenCalled()
      expect(list.scrollTop).toBe(0)
      expect(backToTopButton()).toBeUndefined()
    })

    it('uses smooth scrolling when motion is allowed and keeps the button hidden while returning', async () => {
      motionState.reduceMotion = false
      const list = await operatorScrollFixture()
      const scrollTo = scrollToMock(list)

      await scrollPanelTo(list, 420)
      const button = backToTopButton()
      expect(button).toBeDefined()

      await act(async () => {
        button!.focus()
      })
      expect(document.activeElement).toBe(button)

      await clickButton(button!)

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, 300)
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, 120)
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, 0)
      expect(backToTopButton()).toBeUndefined()

      await scrollPanelTo(list, 500)
      expect(backToTopButton()).toBeDefined()
    })

    it('keeps the back-to-top button focusable with an accessible name', async () => {
      const list = await operatorScrollFixture()
      await scrollPanelTo(list, 420)

      const button = backToTopButton()!
      expect(button).toBeDefined()
      expect((button.textContent ?? '').trim()).toBe('回到顶部')
      expect(button.disabled).toBe(false)
      expect(button.tabIndex).toBe(0)

      await act(async () => {
        button.focus()
      })
      expect(document.activeElement).toBe(button)
    })

    it('moves focus into the operator grid after returning to the top', async () => {
      const list = await operatorScrollFixture()
      await scrollPanelTo(list, 420)

      const button = backToTopButton()!
      await act(async () => {
        button.focus()
      })
      await clickButton(button)

      expect(document.activeElement).toBe(list)
    })

    it('does not render a back-to-top button when the grid has no rows', async () => {
      await render()

      expect(container.textContent).toContain('还没有干员识别结果')
      expect(operatorList()).toBeNull()
      expect(backToTopButton()).toBeUndefined()
    })

    it('does not render a back-to-top button when the operator read fails', async () => {
      mocks.getAllOperators.mockResolvedValue({ success: false, message: '目录服务不可用' })
      mocks.getOperBoxData.mockResolvedValue({ success: false, message: '读取失败' })

      await render()

      expect(container.querySelector('[role="alert"]')?.textContent).toContain('干员数据读取失败')
      expect(operatorList()).toBeNull()
      expect(backToTopButton()).toBeUndefined()
    })

    it('scrolls the operator grid and the depot grid independently', async () => {
      await renderBothPanels()

      const operators = operatorList()
      const depotItems = depotList()
      expect(operators).not.toBeNull()
      expect(depotItems).not.toBeNull()

      await scrollPanelTo(operators!, 420)

      expect(operators!.scrollTop).toBe(420)
      expect(depotItems!.scrollTop).toBe(0)
      expect(backToTopButton(panelRegion('operator-panel-title')!)).toBeDefined()
      expect(backToTopButton(panelRegion('depot-panel-title')!)).toBeUndefined()

      await scrollPanelTo(depotItems!, 480)

      expect(operators!.scrollTop).toBe(420)
      expect(depotItems!.scrollTop).toBe(480)
      expect(backToTopButton(panelRegion('depot-panel-title')!)).toBeDefined()

      await act(async () => {
        backToTopButton(panelRegion('depot-panel-title')!)!.click()
      })

      expect(depotItems!.scrollTop).toBe(0)
      expect(operators!.scrollTop).toBe(420)
      expect(backToTopButton(panelRegion('operator-panel-title')!)).toBeDefined()
    })
  })

})
