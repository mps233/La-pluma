// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COPILOT_MATCH_MODES, type CopilotSearchOrder } from '../model/copilotDiscovery'
import {
  COPILOT_DISCOVERY_VIEW_STORAGE_KEY,
  COPILOT_MATCH_STORAGE_KEY,
  COPILOT_OPERATOR_FILTER_STORAGE_KEY,
} from '../model/copilotDiscoveryPreferences'
import { createPanelStateStore } from '../model/panelState'
import type { OperatorFilterOption, OperatorSelection } from '../model/operatorFilter'
import type { CopilotSearchResult, CopilotStageCandidate } from '../types'
import {
  COPILOT_DISCOVERY_DIALOG_ID,
  type CombatCopilotDiscoveryView,
  type CombatCopilotMatchSettings,
  type CombatCopilotSearchProjection,
} from './combatPanelTypes'
import CombatCopilotDiscoveryDialog from './CombatCopilotDiscoveryDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const STAGES: readonly CopilotStageCandidate[] = [
  { stageId: 'main_01-07', code: '1-7', name: '暴君', category: '主线', zone: '切尔诺伯格' },
  { stageId: 'lt_02_01', code: 'LT-2', name: '未授权区域', category: '保全派驻', zone: '塔山农业实验平台' },
  { stageId: 'lt_02_02', code: 'LT-2', name: '临时通道', category: '保全派驻', zone: '塔山农业实验平台' },
]

const OPERATORS: readonly OperatorFilterOption[] = [
  { id: 'char_002_amiya', name: '阿米娅', owned: true, rarity: 5 },
  { id: 'char_010_chen', name: '陈', owned: false, rarity: 6 },
  { id: 'char_180_amgoat', name: '艾雅法拉', owned: true, rarity: 6 },
]

const RESULT: CopilotSearchResult = {
  stage: '1-7',
  total: 3,
  recommended: { uri: 'prts://ready' },
  copilots: [
    {
      id: '1',
      uri: 'prts://ready',
      views: 1200,
      hotScore: 98,
      stageCode: '1-7',
      stageLabel: '暴君',
      title: '突袭 1-7 挂机',
      uploader: '博士A',
      uploadTime: new Date(2026, 2, 4, 12).toISOString(),
      operators: ['阿米娅', '陈', '艾雅法拉', '桃金娘', '德克萨斯', '能天使'],
      match: { mode: 'ready', missing: [], training: [], check: [], totalSlots: 6 },
    },
    {
      id: '2',
      uri: 'prts://borrow',
      views: 88,
      hotScore: 12,
      stageId: 'lt_02_01',
      stageName: 'lt_02_01',
      title: 'LT-2 需要助战',
      uploader: 'doctor',
      operators: ['陈'],
      match: { mode: 'borrow', missing: ['陈'], training: [], check: [], totalSlots: 1 },
    },
    {
      id: '3',
      uri: 'prts://unknown',
      views: 1,
      hotScore: 0,
      stageName: 'main_00-01',
      title: '未识别匹配的作业',
    },
  ],
}

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

const createProjection = (overrides: Partial<CombatCopilotSearchProjection> = {}): CombatCopilotSearchProjection => ({
  isOpen: true,
  onOpen: vi.fn(),
  onClose: vi.fn(),
  keywordStore: createPanelStateStore<string>(''),
  levelStore: createPanelStateStore<string>(''),
  operatorStore: createPanelStateStore<OperatorSelection>({ included: [], excluded: [] }),
  operatorFilterEnabledStore: createPanelStateStore<boolean>(true),
  operatorFilterRememberStore: createPanelStateStore<boolean>(true),
  orderStore: createPanelStateStore<CopilotSearchOrder>('hot'),
  matchStore: createPanelStateStore<CombatCopilotMatchSettings>({
    enabled: false,
    modes: DEFAULT_COPILOT_MATCH_MODES,
  }),
  viewStore: createPanelStateStore<CombatCopilotDiscoveryView>('grid'),
  stages: STAGES,
  stagesLoading: false,
  stagesError: null,
  operators: OPERATORS,
  operatorsLoading: false,
  operatorsError: null,
  ownedOperatorNames: new Set(['阿米娅', '艾雅法拉']),
  result: RESULT,
  searching: false,
  refreshing: false,
  error: null,
  addingUri: null,
  onSearch: vi.fn(),
  onRetrySearch: vi.fn(),
  onLoadMore: vi.fn(async () => null),
  onCancel: vi.fn(),
  onPreviewUri: vi.fn(),
  onAddToQueue: vi.fn(),
  onRetryData: vi.fn(),
  ...overrides,
})

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

const findDialogByTitle = (title: string): HTMLElement | null => (
  Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((dialog) => {
    const labelledBy = dialog.getAttribute('aria-labelledby')
    return labelledBy ? document.getElementById(labelledBy)?.textContent === title : false
  }) ?? null
)

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

const selectValue = async (select: HTMLElement | null, label: string) => {
  expect(select).not.toBeNull()
  await act(async () => (select as HTMLElement).click())
  const option = optionInTriggerPopup(select as HTMLElement, label)
  expect(option, `未找到选项：${label}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
}

const pressEnter = async (input: HTMLInputElement | null) => {
  expect(input).not.toBeNull()
  await act(async () => {
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

const lastRequest = (search: CombatCopilotSearchProjection) => {
  const calls = vi.mocked(search.onSearch).mock.calls
  return calls[calls.length - 1]?.[0]
}

const keywordInput = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索作业关键词"]')

const pagedResult = (
  page: number,
  overrides: { total?: number; hasNext?: boolean; count?: number; keyword?: string } = {},
): CopilotSearchResult => {
  const { total = 150, hasNext = true, count = 30, keyword = '' } = overrides
  return {
    keyword,
    stage: '1-7',
    page,
    limit: 30,
    total,
    hasNext,
    copilots: Array.from({ length: count }, (_, index) => ({
      id: `page-${page}-${index}`,
      uri: `prts://page-${page}-${index}`,
      views: page * 100 + index,
      hotScore: 0,
      stageName: '1-7',
      title: `第 ${page} 页第 ${index + 1} 条`,
    })),
  }
}

const discoveryBody = (): HTMLElement => {
  const dialog = findDialogByTitle('发现作业')
  expect(dialog).not.toBeNull()
  const body = dialog!.querySelector<HTMLElement>('[data-slot="dialog-body"]')
  expect(body).not.toBeNull()
  return body!
}

const scrollDiscoveryToBottom = async () => {
  const body = discoveryBody()
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(body, 'scrollTop', { configurable: true, writable: true, value: 600 })
  await act(async () => {
    body.dispatchEvent(new Event('scroll'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CombatCopilotDiscoveryDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    installMatchMedia()
    localStorage.clear()
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

  const renderDialog = async (overrides: Partial<CombatCopilotSearchProjection> = {}) => {
    const search = createProjection(overrides)
    await act(async () => {
      root.render(<CombatCopilotDiscoveryDialog search={search} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    return search
  }

  it('renders the discovery modal and submits every filter in the request', async () => {
    const search = await renderDialog({
      keywordStore: createPanelStateStore<string>('1-7 挂机'),
      levelStore: createPanelStateStore<string>('main_01-07'),
      operatorStore: createPanelStateStore<OperatorSelection>({ included: ['阿米娅'], excluded: ['陈'] }),
      orderStore: createPanelStateStore<CopilotSearchOrder>('latest'),
    })

    expect(document.getElementById(COPILOT_DISCOVERY_DIALOG_ID)).not.toBeNull()
    expect(findDialogByTitle('发现作业')).not.toBeNull()
    expect(document.body.textContent).toContain('共 3 条')
    expect(document.body.textContent).toContain('推荐')
    expect(document.body.textContent).toContain('+1')
    expect(search.onSearch).not.toHaveBeenCalled()

    await click(findButton('搜索'))

    expect(search.onSearch).toHaveBeenCalledWith({
      keyword: '1-7 挂机',
      level: 'main_01-07',
      includedOperators: ['阿米娅'],
      excludedOperators: ['陈'],
      orderBy: 'latest',
      page: 1,
      limit: 30,
    })
  })

  it('keeps the search controls in a fixed toolbar above the scrollable results', async () => {
    await renderDialog()

    const dialog = findDialogByTitle('发现作业')
    expect(dialog).not.toBeNull()
    const toolbar = dialog!.querySelector<HTMLElement>('[data-slot="dialog-toolbar"]')
    expect(toolbar).not.toBeNull()
    expect(toolbar!.querySelector('[aria-label="作业搜索"]')).not.toBeNull()
    expect(toolbar!.contains(keywordInput())).toBe(true)

    const body = discoveryBody()
    expect(body.querySelector('[aria-label="作业搜索"]')).toBeNull()
    expect(body.textContent).toContain('共 3 条')
    expect(toolbar!.textContent).not.toContain('共 3 条')
  })

  it('cancels in-flight searches while typing and submits on Enter', async () => {
    const search = await renderDialog()

    await typeInto(keywordInput(), '1-7')
    expect(search.onCancel).toHaveBeenCalled()
    expect(search.onSearch).not.toHaveBeenCalled()

    await pressEnter(keywordInput())
    expect(lastRequest(search)).toMatchObject({ keyword: '1-7', page: 1, limit: 30 })
  })

  it('clears the typed keyword from the search field and keeps focus there', async () => {
    const search = await renderDialog()

    expect(document.querySelector('button[aria-label="清除搜索关键词"]')).toBeNull()

    await typeInto(keywordInput(), '1-7 挂机')
    expect(keywordInput()?.value).toBe('1-7 挂机')

    await click(document.querySelector('button[aria-label="清除搜索关键词"]'))

    expect(keywordInput()?.value).toBe('')
    expect(search.keywordStore.get()).toBe('')
    expect(search.onCancel).toHaveBeenCalled()
    expect(document.activeElement).toBe(keywordInput())
    expect(document.querySelector('button[aria-label="清除搜索关键词"]')).toBeNull()
  })

  it('searches immediately after picking a stage and clears back to all stages', async () => {
    const search = await renderDialog()

    await click(findButton('关卡筛选'))
    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="搜索关卡"]'), 'LT-2')
    await click(findButton(/^选择关卡 LT-2 未授权区域/))

    expect(search.levelStore.get()).toBe('lt_02_01')
    expect(lastRequest(search)).toMatchObject({ level: 'lt_02_01', page: 1, limit: 30 })

    await click(findButton('关卡筛选：LT-2'))
    await click(findButton('全部关卡'))

    expect(search.levelStore.get()).toBe('')
    expect(lastRequest(search)).toMatchObject({ level: '' })
  })

  it('searches page one when the order changes', async () => {
    const search = await renderDialog()

    await selectValue(document.querySelector('[aria-label="排序"]'), '访问量')

    expect(search.orderStore.get()).toBe('views')
    expect(search.onSearch).toHaveBeenCalledWith(expect.objectContaining({ orderBy: 'views', page: 1, limit: 30 }))
  })

  it('switches grid and list views without searching', async () => {
    const search = await renderDialog()

    expect(findButton('网格视图').getAttribute('aria-pressed')).toBe('true')

    await click(findButton('列表视图'))
    expect(search.viewStore.get()).toBe('list')
    expect(findButton('列表视图').getAttribute('aria-pressed')).toBe('true')
    expect(search.onSearch).not.toHaveBeenCalled()

    await click(findButton('网格视图'))
    expect(search.viewStore.get()).toBe('grid')
    expect(search.onSearch).not.toHaveBeenCalled()
  })

  it('filters operators by pinyin and searches with the confirmed inclusion', async () => {
    const search = await renderDialog()

    await click(findButton(/^干员/))
    expect(findDialogByTitle('筛选干员')).not.toBeNull()

    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="搜索包含干员"]'), 'amiya')
    await click(findButton('加入包含 阿米娅'))
    await click(findButton('确认筛选'))

    expect(search.operatorStore.get()).toEqual({ included: ['阿米娅'], excluded: [] })
    expect(findButton(/^干员/).textContent).toContain('1')
    expect(lastRequest(search)).toMatchObject({
      includedOperators: ['阿米娅'],
      excludedOperators: [],
      page: 1,
      limit: 30,
    })
  })

  it('temporarily disables operator filters without losing the selection', async () => {
    const search = await renderDialog({
      operatorStore: createPanelStateStore<OperatorSelection>({ included: ['阿米娅'], excluded: ['陈'] }),
    })

    await click(findButton('停用干员筛选'))

    expect(search.operatorFilterEnabledStore.get()).toBe(false)
    expect(lastRequest(search)).toMatchObject({
      includedOperators: [],
      excludedOperators: [],
    })
    expect(JSON.parse(localStorage.getItem(COPILOT_OPERATOR_FILTER_STORAGE_KEY) ?? 'null')).toMatchObject({
      enabled: false,
      included: ['阿米娅'],
      excluded: ['陈'],
    })

    await click(findButton('启用干员筛选'))

    expect(search.operatorFilterEnabledStore.get()).toBe(true)
    expect(lastRequest(search)).toMatchObject({
      includedOperators: ['阿米娅'],
      excludedOperators: ['陈'],
    })
  })

  it('persists the view and match preferences locally', async () => {
    await renderDialog()

    await click(findButton('列表视图'))
    expect(JSON.parse(localStorage.getItem(COPILOT_DISCOVERY_VIEW_STORAGE_KEY) ?? 'null')).toBe('list')

    await click(findButton('匹配'))
    await click(document.querySelector('[role="switch"]'))
    expect(JSON.parse(localStorage.getItem(COPILOT_MATCH_STORAGE_KEY) ?? 'null')).toMatchObject({
      enabled: true,
    })
  })

  it('separates opening the preview from adding the same job to the queue', async () => {
    const search = await renderDialog()

    await click(findButton('查看作业 突袭 1-7 挂机'))
    expect(search.onPreviewUri).toHaveBeenCalledWith('prts://ready')
    expect(search.onAddToQueue).not.toHaveBeenCalled()

    await click(findButton('加入队列: 突袭 1-7 挂机'))
    expect(search.onAddToQueue).toHaveBeenCalledWith('prts://ready')
  })

  it('marks the job being added and disables its queue button', async () => {
    await renderDialog({ addingUri: 'prts://ready' })

    expect(document.body.textContent).not.toContain('已选中')

    const addingButton = findButton('加入队列: 突袭 1-7 挂机')
    expect(addingButton.disabled).toBe(true)
    expect(addingButton.getAttribute('aria-busy')).toBe('true')
    expect(addingButton.textContent).toContain('加入中')
  })

  it('shows a loading state instead of stale results while searching', async () => {
    await renderDialog({ searching: true })

    expect(document.body.textContent).toContain('正在搜索作业')
    expect(document.body.textContent).not.toContain('突袭 1-7 挂机')
  })

  it('shows a first-load placeholder only while the default list has no cache', async () => {
    await renderDialog({ result: null, refreshing: true })

    expect(document.body.textContent).toContain('正在加载作业')
    expect(document.body.textContent).not.toContain('正在搜索作业')
    expect(document.body.textContent).not.toContain('正在请求')
  })

  it('keeps cached results visible while the background refresh runs', async () => {
    await renderDialog({ refreshing: true })

    expect(document.body.textContent).toContain('突袭 1-7 挂机')
    expect(document.body.textContent).not.toContain('正在加载作业')
    expect(document.body.textContent).not.toContain('正在搜索作业')
    expect(document.body.textContent).not.toContain('正在请求')
  })

  it('prefers the explicit search loading state over a background refresh', async () => {
    await renderDialog({ searching: true, refreshing: true })

    expect(document.body.textContent).toContain('正在搜索作业')
    expect(document.body.textContent).not.toContain('正在加载作业')
  })

  it('shows the search failure with retry instead of stale results or a synthetic empty state', async () => {
    const onRetrySearch = vi.fn()
    await renderDialog({ error: '网络错误: timeout', onRetrySearch })

    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('搜索失败')
    expect(alert?.textContent).toContain('网络错误: timeout')
    expect(document.body.textContent).not.toContain('共 3 条')
    expect(document.body.textContent).not.toContain('突袭 1-7 挂机')
    expect(document.body.textContent).not.toContain('暂无作业')
    expect(document.body.textContent).not.toContain('没有匹配结果')

    await click(findButton('重试'))
    expect(onRetrySearch).toHaveBeenCalledOnce()

    await renderDialog({ error: '服务不可用', result: null })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('服务不可用')
    expect(document.body.textContent).not.toContain('暂无作业')
  })

  it('keeps the searching placeholder above a stale search error', async () => {
    await renderDialog({ error: '上一次搜索失败', searching: true })

    expect(document.body.textContent).toContain('正在搜索作业')
    expect(document.body.textContent).not.toContain('上一次搜索失败')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('cancels in-flight work and closes the dialog', async () => {
    const search = await renderDialog()

    await click(findButton('关闭对话框'))

    expect(search.onCancel).toHaveBeenCalled()
    expect(search.onClose).toHaveBeenCalled()
  })

  it('keeps unmatched jobs visible with an explicit marker and filters by mode', async () => {
    await renderDialog({
      matchStore: createPanelStateStore<CombatCopilotMatchSettings>({ enabled: true, modes: ['ready'] }),
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('共 3 条')
    expect(text).toContain('匹配 2 条')
    expect(text).toContain('突袭 1-7 挂机')
    expect(text).toContain('未识别匹配的作业')
    expect(text).toContain('未识别')
    expect(text).not.toContain('LT-2 需要助战')
  })

  it('enables matching locally without issuing a new search', async () => {
    const search = await renderDialog()

    await click(findButton('匹配'))
    await click(document.querySelector('[role="switch"]'))
    expect(search.matchStore.get().enabled).toBe(true)
    expect(search.onSearch).not.toHaveBeenCalled()

    await click(findButton('关闭'))
    expect(findButton('匹配').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('匹配 3 条')
  })

  it('marks ownership unknown and shows the operator loading state when recognition is pending', async () => {
    await renderDialog({ operatorsLoading: true })

    expect(document.querySelector('[title="阿米娅（拥有状态未知）"]')).not.toBeNull()
    expect(document.querySelector('[title="陈（拥有状态未知）"]')).not.toBeNull()
    expect(document.querySelector('[title="陈（未拥有）"]')).toBeNull()

    await click(findButton('匹配'))

    expect(document.body.textContent).toContain('正在识别持有干员…')
    expect(document.querySelector('[role="switch"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('marks ownership unknown and offers operator retry when recognition fails', async () => {
    const search = await renderDialog({ operatorsError: '网络错误' })

    expect(document.querySelector('[title="阿米娅（拥有状态未知）"]')).not.toBeNull()
    expect(document.querySelector('[title="陈（未拥有）"]')).toBeNull()

    await click(findButton('匹配'))

    expect(document.body.textContent).toContain('持有干员读取失败：网络错误')
    await click(findButton('重试'))
    expect(search.onRetryData).toHaveBeenCalledOnce()
  })

  it('disables the match switch until owned operators are recognized', async () => {
    const search = await renderDialog({ ownedOperatorNames: new Set<string>() })

    await click(findButton('匹配'))
    const matchDialog = findDialogByTitle('干员匹配')
    expect(matchDialog).not.toBeNull()
    expect(matchDialog?.textContent).toContain('先识别持有干员')

    const toggle = document.querySelector('[role="switch"]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-disabled')).toBe('true')
    await click(toggle)
    expect(search.matchStore.get().enabled).toBe(false)
  })

  it('shows a concise fallback before results and reports an empty result afterwards', async () => {
    await renderDialog({ result: null })
    expect(document.body.textContent).toContain('暂无作业')
    expect(document.body.textContent).not.toContain('也可以直接搜索浏览热度榜')

    await renderDialog({
      result: { stage: '1-7', copilots: [] },
      keywordStore: createPanelStateStore<string>('不存在'),
    })
    expect(document.body.textContent).toContain('没有匹配结果')
    expect(document.body.textContent).toContain('换个关键词')
  })

  it('reports the match-filter empty state when nothing meets the modes', async () => {
    await renderDialog({
      result: {
        stage: '1-7',
        total: 1,
        copilots: [RESULT.copilots[0]!],
      },
      matchStore: createPanelStateStore<CombatCopilotMatchSettings>({ enabled: true, modes: ['blocked'] }),
    })

    expect(document.body.textContent).toContain('匹配 0 条')
    expect(document.body.textContent).toContain('没有匹配结果')
    expect(document.body.textContent).toContain('放宽匹配模式')
  })

  it('retries stage data from the stage panel', async () => {
    const search = await renderDialog({ stagesError: '关卡目录读取失败' })

    await click(findButton('关卡筛选'))
    expect(document.body.textContent).toContain('关卡目录读取失败')

    await click(findButton('重试'))
    expect(search.onRetryData).toHaveBeenCalled()
  })

  it('appends the next page of results when the dialog body scrolls to the bottom', async () => {
    const onLoadMore = vi.fn(async () => pagedResult(2, { count: 30, hasNext: false }))
    const search = await renderDialog({ result: pagedResult(1), onLoadMore })

    expect(document.body.textContent).toContain('共 150 条')
    expect(document.body.textContent).toContain('已加载 30 条')
    expect(document.body.textContent).not.toContain('第 2 页第 1 条')

    await scrollDiscoveryToBottom()

    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(onLoadMore).toHaveBeenCalledWith(expect.objectContaining({ keyword: '', page: 2, limit: 30 }))
    expect(document.body.textContent).toContain('第 1 页第 1 条')
    expect(document.body.textContent).toContain('第 2 页第 1 条')
    expect(document.body.textContent).toContain('已加载 60 条')
    expect(search.onSearch).not.toHaveBeenCalled()
  })

  it('does not request another page while a page is loading', async () => {
    let resolvePage: (result: CopilotSearchResult | null) => void = () => {}
    const pendingPage = new Promise<CopilotSearchResult | null>((resolve) => {
      resolvePage = resolve
    })
    const onLoadMore = vi.fn(() => pendingPage)
    await renderDialog({ result: pagedResult(1), onLoadMore })

    await scrollDiscoveryToBottom()
    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePage(pagedResult(2))
      await pendingPage
    })

    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(2)
    expect(onLoadMore).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
  })

  it('stops loading pages after a page reports no next page', async () => {
    const onLoadMore = vi.fn(async () => pagedResult(2, { count: 5, hasNext: false }))
    await renderDialog({ result: pagedResult(1, { hasNext: false }), onLoadMore })

    await scrollDiscoveryToBottom()
    expect(onLoadMore).not.toHaveBeenCalled()

    await renderDialog({ result: pagedResult(1), onLoadMore })
    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(onLoadMore).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('resets appended pages and the page cursor after a new base search', async () => {
    const onLoadMore = vi.fn(async () => pagedResult(2, { count: 1 }))
    await renderDialog({ result: pagedResult(1, { keyword: '1-7' }), onLoadMore })

    await scrollDiscoveryToBottom()
    expect(document.body.textContent).toContain('第 2 页第 1 条')

    await renderDialog({
      result: pagedResult(1, { keyword: 'LT-2', total: 150, count: 3 }),
      onLoadMore,
    })

    expect(document.body.textContent).not.toContain('第 2 页第 1 条')
    expect(document.body.textContent).toContain('已加载 3 条')

    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(2)
    expect(onLoadMore).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'LT-2', page: 2 }))
    expect(document.body.textContent).toContain('第 2 页第 1 条')
    expect(document.body.textContent).toContain('已加载 4 条')
  })

  it('keeps the loaded results when the next page fails', async () => {
    const onLoadMore = vi.fn(async () => null)
    await renderDialog({ result: pagedResult(1), onLoadMore })

    await scrollDiscoveryToBottom()

    expect(document.body.textContent).toContain('第 1 页第 1 条')
    expect(document.body.textContent).toContain('已加载 30 条')
    expect(document.body.textContent).not.toContain('第 2 页第 1 条')

    await scrollDiscoveryToBottom()
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })
})
