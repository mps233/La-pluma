// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import type { OperatorSortDirection } from '../types'
import OperatorSelectModal from './OperatorSelectModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const mocks = vi.hoisted(() => ({
  getOperBoxData: vi.fn(),
  getAllOperators: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getOperBoxData: mocks.getOperBoxData,
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

interface OwnedFixture {
  id: string
  name: string
  rarity: number
  profession?: string
  elite?: number
  level?: number
}

interface CatalogFixture {
  id: string
  name: string
  rarity: number
  profession?: string
}

const ownedOperator = (
  id: string,
  name: string,
  rarity = 6,
  cultivation: { elite?: number; level?: number; profession?: string } = {},
): OwnedFixture => ({
  id,
  name,
  rarity,
  ...cultivation,
})

const catalogOperator = (id: string, name: string, rarity: number, profession?: string): CatalogFixture => ({
  id,
  name,
  rarity,
  ...(profession ? { profession } : {}),
})

const RECOGNIZED_OPERATORS: OwnedFixture[] = [
  ownedOperator('char_002_amiya', '阿米娅', 5, { elite: 1, level: 70 }),
  ownedOperator('char_180_amgoat', '艾雅法拉', 6, { elite: 1, level: 80 }),
  ownedOperator('char_010_chen', '陈', 6, { elite: 2, level: 90 }),
  ownedOperator('char_202_demkni', '塞雷娅', 6, { elite: 0, level: 60 }),
]

const OPERATOR_CATALOG: CatalogFixture[] = [
  catalogOperator('char_002_amiya', '阿米娅', 5, 'CASTER'),
  catalogOperator('char_180_amgoat', '艾雅法拉', 6, 'CASTER'),
  catalogOperator('char_010_chen', '陈', 6, 'WARRIOR'),
  catalogOperator('char_202_demkni', '塞雷娅', 6, 'TANK'),
]

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  })
}

const typeSearch = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索干员名称"]')
  expect(input).not.toBeNull()
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

const professionSelect = () => document.querySelector('[aria-label="职业筛选"]')

const professionOptionLabels = async () => {
  const trigger = professionSelect() as HTMLElement
  await act(async () => trigger.click())
  const popupId = trigger.getAttribute('aria-controls')
  const labels = popupId
    ? [...(document.getElementById(popupId)?.querySelectorAll('[role="option"]') ?? [])].map(node => node.textContent?.trim())
    : []
  await act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  return labels
}

const selectProfession = async (label: string) => {
  const trigger = professionSelect()
  expect(trigger, 'profession select').not.toBeNull()
  await act(async () => (trigger as HTMLElement).click())
  const option = optionInTriggerPopup(trigger as HTMLElement, label)
  expect(option, `profession option ${label}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
  await flush()
}

/** 卡片唯一的可访问名是动作按钮：选择X / 已选择X，用它按渲染顺序取干员名。 */
const visibleOperatorNames = () => Array.from(
  dialog()?.querySelectorAll<HTMLButtonElement>('button[aria-label^="选择"], button[aria-label^="已选择"]') ?? [],
).map(button => (button.getAttribute('aria-label') ?? '').replace(/^已?选择/, ''))

async function renderModal(defaultSortDirection?: OperatorSortDirection) {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <OperatorSelectModal
          isOpen
          onClose={onClose}
          onConfirm={onConfirm}
          title="选择干员"
          defaultSortDirection={defaultSortDirection}
        />
      </QueryClientProvider>,
    )
  })
  await flush()
  return { onClose, onConfirm }
}

describe('shared operator select modal', () => {
  beforeEach(() => {
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: { data: [] } })
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('offers 全部职业 plus every profession in a dropdown and defaults to 全部职业', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('asc')

    expect(await professionOptionLabels()).toEqual([
      '全部职业', '先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种',
    ])
    expect(professionSelect()?.textContent).toContain('全部职业')
    expect(document.querySelector('[role="group"][aria-label="职业筛选"]')).toBeNull()
    expect(visibleOperatorNames()).toHaveLength(4)
  })

  it('fills recognized rows with the catalog profession so the filter works on real snapshots', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('desc')
    await selectProfession('术师')

    expect(visibleOperatorNames()).toEqual(['艾雅法拉', '阿米娅'])
    expect(dialog()?.textContent).not.toContain('陈')
    expect(dialog()?.textContent).not.toContain('塞雷娅')
  })

  it('combines profession filtering with search and the descending default', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('desc')
    expect(visibleOperatorNames()).toEqual(['陈', '艾雅法拉', '阿米娅', '塞雷娅'])

    await selectProfession('术师')
    expect(visibleOperatorNames()).toEqual(['艾雅法拉', '阿米娅'])

    await typeSearch('阿米')
    expect(visibleOperatorNames()).toEqual(['阿米娅'])

    await selectProfession('全部职业')
    expect(visibleOperatorNames()).toEqual(['阿米娅'])
  })

  it('sorts by elite then level ascending when the daily training caller asks for it', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('asc')

    expect(visibleOperatorNames()).toEqual(['塞雷娅', '阿米娅', '艾雅法拉', '陈'])
  })

  it('keeps the source order when no default direction is requested', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        data: [
          ownedOperator('char_202_demkni', '塞雷娅', 6, { elite: 0, level: 60 }),
          ownedOperator('char_010_chen', '陈', 6, { elite: 2, level: 90 }),
          ownedOperator('char_002_amiya', '阿米娅', 5, { elite: 1, level: 70 }),
        ],
      },
    })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal()

    expect(visibleOperatorNames()).toEqual(['塞雷娅', '陈', '阿米娅'])
  })

  it('falls back to rarity and name when the catalog has no cultivation fields', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        catalogOperator('char_002_amiya', '阿米娅', 5, 'CASTER'),
        catalogOperator('char_010_chen', '陈', 6, 'WARRIOR'),
        catalogOperator('char_202_demkni', '塞雷娅', 4, 'TANK'),
      ],
    })

    await renderModal('desc')

    expect(visibleOperatorNames()).toEqual(['陈', '阿米娅', '塞雷娅'])
  })

  it('hides the profession filter when neither snapshot nor catalog carries a profession', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: { data: [ownedOperator('char_002_amiya', '阿米娅', 5, { elite: 1, level: 70 })] },
    })

    await renderModal('desc')

    expect(professionSelect()).toBeNull()
    expect(visibleOperatorNames()).toEqual(['阿米娅'])
  })

  it('confirms the selected operator from the footer', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })
    const { onClose, onConfirm } = await renderModal('asc')

    const select = document.querySelector<HTMLButtonElement>('button[aria-label="选择艾雅法拉"]')
    expect(select).not.toBeNull()
    await act(async () => {
      select!.click()
    })
    await flush()

    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '确认选择')
    expect(confirm?.disabled).toBe(false)
    await act(async () => {
      confirm!.click()
    })
    await flush()

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      id: 'char_180_amgoat',
      name: '艾雅法拉',
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels from the footer without selecting an operator', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })
    const { onClose, onConfirm } = await renderModal()

    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '取消')
    expect(cancel).not.toBeUndefined()
    await act(async () => {
      cancel!.click()
    })
    await flush()

    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps a real empty state when the profession filter matches nothing', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('asc')
    await selectProfession('医疗')

    expect(visibleOperatorNames()).toEqual([])
    expect(dialog()?.textContent).toContain('没有找到符合条件的干员')
    expect(dialog()?.textContent).toContain('换个职业再试。')

    await selectProfession('全部职业')
    expect(visibleOperatorNames()).toHaveLength(4)
  })

  it('keeps the existing empty description for a search-only miss', async () => {
    mocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: RECOGNIZED_OPERATORS } })
    mocks.getAllOperators.mockResolvedValue({ success: true, data: OPERATOR_CATALOG })

    await renderModal('asc')
    await typeSearch('不存在的干员')

    expect(visibleOperatorNames()).toEqual([])
    expect(dialog()?.textContent).toContain('没有找到符合条件的干员')
    expect(dialog()?.textContent).toContain('换个名称再试。')
  })
})
