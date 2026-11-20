// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperatorFilterOption } from '../model/operatorFilter'
import CombatCopilotOperatorFilterDialog, {
  type CombatCopilotOperatorFilterDialogProps,
} from './CombatCopilotOperatorFilterDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPERATORS: readonly OperatorFilterOption[] = [
  { id: 'char_002_amiya', name: '阿米娅', owned: true, rarity: 5 },
  { id: 'char_010_chen', name: '陈', owned: false, rarity: 6 },
  { id: 'char_180_amgoat', name: '艾雅法拉', owned: true, rarity: 6 },
]

const installMatchMedia = () => {
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
}

const accessibleName = (element: Element): string => (
  element.getAttribute('aria-label') ?? element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
)

const findButton = (name: string | RegExp, scope: ParentNode = document): HTMLButtonElement => {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const label = accessibleName(button)
    return typeof name === 'string' ? label === name : name.test(label)
  })
  expect(match, `未找到按钮：${String(name)}`).toBeDefined()
  return match!
}

const section = (title: string): HTMLElement => {
  const match = document.querySelector<HTMLElement>(`section[aria-label="${title}"]`)
  expect(match, `未找到区块：${title}`).not.toBeNull()
  return match!
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

const typeInto = async (input: HTMLInputElement | null, value: string) => {
  expect(input).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const optionLabels = (title: string): string[] => Array.from(
  section(title).querySelectorAll('ul button'),
).map(button => accessibleName(button))

const defineScrollBox = (node: HTMLElement, scrollHeight: number, clientHeight: number) => {
  let scrollTop = 0
  Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(node, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = value },
  })
}

const scrollToBottom = async (list: HTMLElement) => {
  list.scrollTop = list.scrollHeight - list.clientHeight
  await act(async () => {
    list.dispatchEvent(new Event('scroll'))
  })
}

const candidates = (count: number): OperatorFilterOption[] => Array.from({ length: count }, (_, index) => ({
  id: `char_scroll_${index}`,
  name: `干员${index}`,
  owned: true,
  rarity: 4,
}))

const createProps = (
  overrides: Partial<CombatCopilotOperatorFilterDialogProps> = {},
): CombatCopilotOperatorFilterDialogProps => ({
  isOpen: true,
  selection: { included: [], excluded: [] },
  enabled: true,
  remember: true,
  operators: OPERATORS,
  operatorsLoading: false,
  operatorsError: null,
  onRetryData: vi.fn(),
  onConfirm: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
})

describe('CombatCopilotOperatorFilterDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    installMatchMedia()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  const renderDialog = async (overrides: Partial<CombatCopilotOperatorFilterDialogProps> = {}) => {
    const props = createProps(overrides)
    await act(async () => {
      root.render(<CombatCopilotOperatorFilterDialog {...props} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    return props
  }

  it('searches by pinyin, marks ownership and confirms the inclusion', async () => {
    const props = await renderDialog()

    await typeInto(
      document.querySelector<HTMLInputElement>('input[aria-label="搜索包含干员"]'),
      'chen',
    )

    const include = section('包含干员')
    expect(include.textContent).toContain('陈')
    expect(include.textContent).not.toContain('阿米娅')
    expect(include.textContent).toContain('未拥有')
    expect(include.querySelector('img')?.getAttribute('src')).toContain('char_010_chen')

    await click(findButton('加入包含 陈', include))
    expect(accessibleName(section('包含干员').querySelector('button[aria-label="移除 陈"]')!))
      .toContain('移除 陈')

    await click(findButton('确认筛选'))

    expect(props.onConfirm).toHaveBeenCalledWith({ included: ['陈'], excluded: [] }, true)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('keeps the two sections mutually exclusive', async () => {
    const props = await renderDialog({
      selection: { included: ['阿米娅'], excluded: ['陈'] },
    })

    const exclude = section('排除干员')
    expect(exclude.textContent).toContain('陈')
    expect(exclude.querySelector('button[aria-label="加入排除 阿米娅"]')).toBeNull()

    const include = section('包含干员')
    expect(include.textContent).toContain('阿米娅')
    expect(include.querySelector('button[aria-label="加入包含 阿米娅"]')).toBeNull()
    expect(include.querySelector('button[aria-label="加入包含 陈"]')).toBeNull()

    await click(findButton('移除 陈', exclude))
    expect(include.querySelector('button[aria-label="加入包含 陈"]')).not.toBeNull()
    expect(include.querySelector('button[aria-label="加入包含 阿米娅"]')).toBeNull()

    await click(findButton('确认筛选'))
    expect(props.onConfirm).toHaveBeenCalledWith({ included: ['阿米娅'], excluded: [] }, true)
  })

  it('shows loading and retries a failed operator catalogue load', async () => {
    const props = await renderDialog({ operatorsLoading: true })
    expect(document.body.textContent).toContain('干员数据加载中')

    const retryProps = await renderDialog({
      operatorsLoading: false,
      operatorsError: '干员目录读取失败',
      onRetryData: props.onRetryData,
    })
    expect(document.body.textContent).toContain('干员目录读取失败')
    const alert = document.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('干员数据读取失败')
    expect(alert?.textContent).toContain('干员目录读取失败')

    await click(findButton('重试'))
    expect(retryProps.onRetryData).toHaveBeenCalled()
  })

  it('shows an empty state without operator data', async () => {
    await renderDialog({ operators: [] })
    expect(document.body.textContent).toContain('没有可用的干员数据')
  })

  it('flags a disabled operator filter without dropping the selection', async () => {
    await renderDialog({
      enabled: false,
      selection: { included: ['阿米娅'], excluded: [] },
    })

    expect(document.body.textContent).toContain('干员筛选已停用')
    expect(document.body.textContent).toContain('阿米娅')
  })

  it('passes the remember choice through confirmation', async () => {
    const props = await renderDialog()

    const remember = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(remember?.checked).toBe(true)
    await click(remember)

    await click(findButton('确认筛选'))

    expect(props.onConfirm).toHaveBeenCalledWith({ included: [], excluded: [] }, false)
  })

  it('orders the included and excluded sections by ownership and training', async () => {
    await renderDialog({
      operators: [
        { id: 'char_untrained', name: '未练', owned: true, rarity: 6 },
        { id: 'char_low', name: '低练', owned: true, rarity: 6, elite: 1, level: 80 },
        { id: 'char_high', name: '高练', owned: true, rarity: 5, elite: 2, level: 90 },
        { id: 'char_missing', name: '未拥有', owned: false, rarity: 6 },
      ],
    })

    expect(optionLabels('包含干员')).toEqual([
      '加入包含 高练',
      '加入包含 低练',
      '加入包含 未练',
      '加入包含 未拥有',
    ])
    expect(optionLabels('排除干员')).toEqual([
      '加入排除 未拥有',
      '加入排除 低练',
      '加入排除 高练',
      '加入排除 未练',
    ])
  })

  it('appends 40 more operators when the list is scrolled near the bottom', async () => {
    await renderDialog({ operators: candidates(85) })

    const list = section('包含干员').querySelector('ul')
    expect(list).not.toBeNull()
    expect(optionLabels('包含干员')).toHaveLength(40)
    expect(document.body.textContent).not.toContain('继续显示')

    defineScrollBox(list!, 1200, 400)

    await scrollToBottom(list!)
    expect(optionLabels('包含干员')).toHaveLength(80)

    await scrollToBottom(list!)
    expect(optionLabels('包含干员')).toHaveLength(85)
    expect(document.body.textContent).not.toContain('继续显示')

    await scrollToBottom(list!)
    expect(optionLabels('包含干员')).toHaveLength(85)
  })

  it('resets the batch when the search term changes', async () => {
    await renderDialog({ operators: candidates(85) })

    const list = section('包含干员').querySelector('ul')
    defineScrollBox(list!, 1200, 400)
    await scrollToBottom(list!)
    expect(optionLabels('包含干员')).toHaveLength(80)

    await typeInto(
      document.querySelector<HTMLInputElement>('input[aria-label="搜索包含干员"]'),
      '干员',
    )
    expect(optionLabels('包含干员')).toHaveLength(40)
  })
})
