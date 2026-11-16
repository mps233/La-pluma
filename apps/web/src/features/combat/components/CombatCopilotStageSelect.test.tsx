// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotStageCandidate } from '../types'
import CombatCopilotStageSelect, {
  type CombatCopilotStageSelectProps,
} from './CombatCopilotStageSelect'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STAGES: readonly CopilotStageCandidate[] = [
  { stageId: 'main_01-07', code: '1-7', name: '暴君', category: '主线', zone: '切尔诺伯格' },
  { stageId: 'lt_02_01', code: 'LT-2', name: '未授权区域', category: '保全派驻', zone: '塔山农业实验平台' },
  { stageId: 'lt_02_02', code: 'LT-2', name: '临时通道', category: '保全派驻', zone: '塔山农业实验平台' },
]

const accessibleName = (element: Element): string => (
  element.getAttribute('aria-label') ?? element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
)

const findButton = (name: string | RegExp): HTMLButtonElement => {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const label = accessibleName(button)
    return typeof name === 'string' ? label === name : name.test(label)
  })
  expect(match, `未找到按钮：${String(name)}`).toBeDefined()
  return match!
}

const stageOptionButtons = (): HTMLButtonElement[] => (
  Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .filter(button => accessibleName(button).startsWith('选择关卡'))
)

const stageList = (): HTMLUListElement => {
  const list = document.querySelector<HTMLUListElement>('.combat-copilot-discovery-stage-list')
  expect(list).not.toBeNull()
  return list!
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

const flushTimers = async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const stagePanel = (): HTMLElement | null => (
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="选择关卡"]')
)

const typeInto = async (input: HTMLInputElement | null, value: string) => {
  expect(input).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const createProps = (
  overrides: Partial<CombatCopilotStageSelectProps> = {},
): CombatCopilotStageSelectProps => ({
  stages: STAGES,
  value: '',
  loading: false,
  error: null,
  onChange: vi.fn(),
  onRetryData: vi.fn(),
  ...overrides,
})

describe('CombatCopilotStageSelect', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const renderSelect = async (overrides: Partial<CombatCopilotStageSelectProps> = {}) => {
    const props = createProps(overrides)
    await act(async () => {
      root.render(<CombatCopilotStageSelect {...props} />)
    })
    return props
  }

  it('exposes the stage panel as a labelled dialog and closes it with Escape', async () => {
    await renderSelect()
    const trigger = findButton('关卡筛选')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await click(trigger)

    const panel = stagePanel()
    expect(panel).not.toBeNull()
    expect(container.contains(panel)).toBe(false)
    expect(trigger.getAttribute('aria-controls')).toBe(panel!.id)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flushTimers()

    expect(stagePanel()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the stage panel when clicking outside it', async () => {
    await renderSelect()
    const trigger = findButton('关卡筛选')
    await click(trigger)
    expect(stagePanel()).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushTimers()

    expect(stagePanel()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters stages by code, name, category or zone and selects one', async () => {
    const props = await renderSelect()

    await click(findButton('关卡筛选'))
    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="搜索关卡"]'), '塔山')

    expect(findButton(/^选择关卡 LT-2 未授权区域/)).not.toBeNull()
    expect(findButton(/^选择关卡 LT-2 临时通道/)).not.toBeNull()
    expect(document.body.textContent).not.toContain('暴君')

    await click(findButton(/^选择关卡 LT-2 未授权区域/))
    expect(props.onChange).toHaveBeenCalledWith(STAGES[1])
    expect(document.querySelector('input[aria-label="搜索关卡"]')).toBeNull()
  })

  it('renders each distinct stage field once', async () => {
    const stages: readonly CopilotStageCandidate[] = [
      {
        stageId: 'level_rune_10-02',
        code: 'level_rune_10-02',
        name: 'level_rune_10-02',
        category: '危机合约',
        zone: 'level_rune_10-02',
      },
      {
        stageId: 'level_crisis_v2_01-05',
        code: 'level_crisis_v2_01-05',
        name: 'level_crisis_v2_01-05',
        category: '危机合约',
        zone: '浊燃作战',
      },
      { stageId: 'a001_01', code: 'GT-1', name: '日正当中', category: '活动关卡', zone: '骑兵与猎人' },
    ]
    await renderSelect({ stages })

    await click(findButton('关卡筛选'))

    const rune = findButton(/^选择关卡 level_rune_10-02$/)
    expect(rune.getAttribute('aria-label')).toBe('选择关卡 level_rune_10-02')
    expect(rune.textContent?.match(/level_rune_10-02/g)).toHaveLength(1)

    const crisis = findButton(/^选择关卡 level_crisis_v2_01-05 浊燃作战$/)
    expect(crisis.textContent).toBe('level_crisis_v2_01-05浊燃作战')

    const gt1 = findButton(/^选择关卡 GT-1 日正当中 骑兵与猎人$/)
    expect(gt1.textContent).toBe('GT-1日正当中骑兵与猎人')
  })

  it('matches stages by name, category, zone and stage id', async () => {
    const stages: readonly CopilotStageCandidate[] = [
      { stageId: 'a001_01', code: 'GT-1', name: '日正当中', category: '活动关卡', zone: '骑兵与猎人' },
      { stageId: 'main_01-07', code: '1-7', name: '暴君', category: '主线', zone: '切尔诺伯格' },
    ]
    await renderSelect({ stages })

    await click(findButton('关卡筛选'))
    const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索关卡"]')
    for (const query of ['日正当中', '活动关卡', '骑兵与猎人', 'a001_01']) {
      await typeInto(input, query)
      expect(findButton(/^选择关卡 GT-1 日正当中 骑兵与猎人$/)).not.toBeNull()
    }
  })

  it('shows the selected stage code and clears the filter', async () => {
    const props = await renderSelect({ value: 'lt_02_01' })
    expect(findButton('关卡筛选：LT-2')).not.toBeNull()

    await click(findButton('关卡筛选：LT-2'))
    await click(findButton('全部关卡'))

    expect(props.onChange).toHaveBeenCalledWith(null)
  })

  const manyStages: readonly CopilotStageCandidate[] = Array.from({ length: 120 }, (_, index) => ({
    stageId: `stage_${index}`,
    code: `S-${index + 1}`,
    name: `关卡 ${index + 1}`,
    category: '主线',
    zone: '测试区域',
  }))

  const scrollStageListToBottom = async () => {
    const list = stageList()
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 800 })
    await act(async () => {
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
  }

  it('reveals more candidates as the stage list scrolls to the bottom', async () => {
    await renderSelect({ stages: manyStages })

    await click(findButton('关卡筛选'))
    expect(stageOptionButtons()).toHaveLength(50)
    expect(document.body.textContent).not.toContain('仅显示前 50 个')

    await scrollStageListToBottom()
    expect(stageOptionButtons()).toHaveLength(100)

    await scrollStageListToBottom()
    expect(stageOptionButtons()).toHaveLength(120)
    expect(findButton(/^选择关卡 S-120 /)).not.toBeNull()
  })

  it('resets the revealed count when the query changes', async () => {
    await renderSelect({ stages: manyStages })

    await click(findButton('关卡筛选'))
    await scrollStageListToBottom()
    expect(stageOptionButtons()).toHaveLength(100)

    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="搜索关卡"]'), '关卡')
    expect(stageOptionButtons()).toHaveLength(50)
  })

  it('resets the revealed count when the panel reopens', async () => {
    await renderSelect({ stages: manyStages })

    await click(findButton('关卡筛选'))
    await scrollStageListToBottom()
    expect(stageOptionButtons()).toHaveLength(100)

    await click(findButton('关卡筛选'))
    await click(findButton('关卡筛选'))
    expect(stageOptionButtons()).toHaveLength(50)
  })

  it('reports empty results and stage data states', async () => {
    await renderSelect()
    await click(findButton('关卡筛选'))
    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="搜索关卡"]'), '不存在')
    expect(document.body.textContent).toContain('没有符合条件的关卡')

    await renderSelect({ loading: true })
    expect(document.body.textContent).toContain('关卡数据加载中')

    const props = await renderSelect({ error: '关卡目录读取失败' })
    expect(document.body.textContent).toContain('关卡目录读取失败')
    await click(findButton('重试'))
    expect(props.onRetryData).toHaveBeenCalled()
  })
})
