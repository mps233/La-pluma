// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import type { CopilotQueueEntry } from '../model/copilotQueue'
import type { CopilotQueueRunProjection } from '../model/copilotQueueRun'
import type { CombatCopilotQueueProjection } from './combatPanelTypes'
import CombatCopilotDetailLayer from './CombatCopilotDetailLayer'
import CombatCopilotQueuePanel from './CombatCopilotQueuePanel'
import { buildQueueDetailTarget } from './copilotQueuePresentation'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const detailTargets: Array<CopilotDetailTarget | null> = []

vi.mock('./CombatCopilotDetailLayer', () => ({
  default: ({ target }: { target: CopilotDetailTarget | null }) => {
    detailTargets.push(target)
    return null
  },
}))

const entry = (overrides: Partial<CopilotQueueEntry> = {}): CopilotQueueEntry => ({
  id: overrides.id ?? 'entry-a',
  source: overrides.source ?? 'link',
  uri: overrides.uri ?? 'prts://101',
  title: overrides.title ?? '作业一',
  addedAt: 1,
  ...overrides,
})

const queue = (overrides: Partial<CombatCopilotQueueProjection> = {}): CombatCopilotQueueProjection => ({
  entries: [entry()],
  selected: new Set(['entry-a']),
  setId: null,
  itemStatuses: new Map(),
  itemErrors: new Map(),
  submittedEntryIds: new Set(),
  queueRun: null,
  failurePolicy: 'continue',
  isRunning: false,
  isSubmitting: false,
  isContinuing: false,
  isSkipping: false,
  isAdding: false,
  automationAvailable: true,
  unavailableMessage: '',
  onToggle: () => {},
  onRemove: () => {},
  onMove: () => {},
  onClear: () => {},
  onAddCurrent: () => {},
  onContinueQueue: () => {},
  onSkipEntry: () => {},
  onRetryFailed: () => {},
  ...overrides,
})

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const runProjection = (
  overrides: Partial<CopilotQueueRunProjection> = {},
): CopilotQueueRunProjection => ({
  runId: 'run-queue',
  state: 'running',
  isActive: true,
  isTerminal: false,
  queueId: 'copilot-queue',
  name: '作业队列',
  mode: 'continuous',
  failurePolicy: 'continue',
  phase: 'running',
  isWaiting: false,
  waitingForNext: false,
  currentClientId: null,
  currentItemIndex: null,
  nextEntry: null,
  taskResults: [],
  statuses: new Map(),
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
  stoppedCount: 0,
  pendingCount: 0,
  failures: [],
  summaryErrors: [],
  ...overrides,
})

const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))

const buttonByText = (container: HTMLElement, text: string) => buttons(container)
  .find(button => button.textContent?.trim() === text)

const buttonByLabel = (container: HTMLElement, label: string) => buttons(container)
  .find(button => button.getAttribute('aria-label') === label)

const checkboxByLabel = (container: HTMLElement, label: string) => Array.from(
  container.querySelectorAll<HTMLElement>('[role="checkbox"]'),
).find(checkbox => checkbox.getAttribute('aria-label') === label)

const documentButtonByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === text)

function QueueWithDetails({ projection }: { projection: CombatCopilotQueueProjection }) {
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)
  const detailEntry = projection.entries.find(item => item.id === detailEntryId)
  return (
    <>
      <CombatCopilotQueuePanel queue={projection} detailEntryId={detailEntryId} onOpenDetail={setDetailEntryId} />
      <CombatCopilotDetailLayer
        target={detailEntry ? buildQueueDetailTarget(detailEntry, projection) : null}
        onClose={() => setDetailEntryId(null)}
      />
    </>
  )
}

describe('CombatCopilotQueuePanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    detailTargets.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const renderPanel = async (props: Partial<CombatCopilotQueueProjection> = {}) => {
    await act(async () => {
      root.render(<QueueWithDetails projection={queue(props)} />)
    })
  }

  it('shows the empty state and disables clearing', async () => {
    await renderPanel({ entries: [], selected: new Set() })

    const panel = container.querySelector<HTMLElement>('section[aria-label="作业队列"]')
    expect(panel).not.toBeNull()
    expect(container.textContent).toContain('作业队列')
    expect(container.textContent).toContain('共 0 项')
    expect(container.textContent).toContain('队列为空')
    expect(container.textContent).toContain('输入作业集链接会自动展开到队列')
    expect(container.textContent).toContain('本地文件')
    expect(buttonByText(container, '执行队列')).toBeUndefined()
    expect(buttonByText(container, '清空')?.disabled).toBe(true)
  })

  it('renders rows with sequence, stage and source badges', async () => {
    await renderPanel({
      entries: [
        entry({ id: 'a', title: '关卡一', stage: 'TEST-1', apCost: 18, source: 'set', setId: '48990' }),
        entry({ id: 'b', title: '', stage: 'TEST-2', source: 'link', uri: 'prts://102' }),
        entry({ id: 'c', title: '', stage: undefined, fileName: 'local.json', source: 'file', uri: '/data/local.json' }),
      ],
      selected: new Set(['a', 'b', 'c']),
    })

    const rows = container.querySelectorAll('[role="listitem"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('关卡一')
    expect(rows[0]?.textContent).toContain('作业集 prts://s48990')
    expect(rows[0]?.textContent).toContain('TEST-1')
    expect(rows[0]?.textContent).not.toContain('理智')
    expect(container.textContent).not.toContain('理智')
    expect(rows[1]?.textContent).toContain('TEST-2')
    expect(rows[1]?.textContent).toContain('链接')
    expect(rows[2]?.textContent).toContain('local.json')
    expect(rows[2]?.textContent).toContain('本地')
    expect(container.textContent).toContain('已勾选 3 / 3 项')
    expect(buttonByText(container, '执行队列')).toBeUndefined()
  })

  it('toggles rows and reports the checked count', async () => {
    const onToggle = vi.fn()
    await renderPanel({
      entries: [entry({ id: 'a' }), entry({ id: 'b', title: '作业二', uri: 'prts://102' })],
      selected: new Set(['a', 'b']),
      onToggle,
    })

    expect(container.textContent).toContain('已勾选 2 / 2 项')
    const checkbox = checkboxByLabel(container, '取消选择队列第 1 项 作业一')!
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    await click(checkbox)

    expect(onToggle).toHaveBeenCalledWith('a')
  })

  it('keeps a 44px label around the row checkbox', async () => {
    const onToggle = vi.fn()
    await renderPanel({ onToggle })

    const checkbox = checkboxByLabel(container, '取消选择队列第 1 项 作业一')!
    const label = checkbox.closest('label')
    expect(label).not.toBeNull()
    expect(label?.getAttribute('for')).toBe(label?.querySelector('input')?.id)
    await act(async () => label!.click())

    expect(onToggle).toHaveBeenCalledWith('entry-a')
  })

  it('confirms before clearing the queue', async () => {
    const onClear = vi.fn()
    await renderPanel({ onClear })

    await click(buttonByText(container, '清空')!)
    expect(onClear).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('清空作业队列？')
    expect(document.body.textContent).toContain('已加入的作业会被移除，此操作不可撤销。')

    await click(documentButtonByText('取消')!)
    expect(onClear).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()

    await click(buttonByText(container, '清空')!)
    await click(documentButtonByText('确认清空')!)
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('moves and removes rows, disabling impossible directions', async () => {
    const onMove = vi.fn()
    const onRemove = vi.fn()
    await renderPanel({
      entries: [entry({ id: 'a' }), entry({ id: 'b', title: '作业二', uri: 'prts://102' })],
      selected: new Set(['a', 'b']),
      onMove,
      onRemove,
    })

    expect(buttonByLabel(container, '上移第 1 项 作业一')?.disabled).toBe(true)
    expect(buttonByLabel(container, '下移第 2 项 作业二')?.disabled).toBe(true)

    await click(buttonByLabel(container, '下移第 1 项 作业一')!)
    await click(buttonByLabel(container, '上移第 2 项 作业二')!)
    await click(buttonByLabel(container, '删除第 1 项 作业一')!)

    expect(onMove).toHaveBeenNthCalledWith(1, 'a', 'down')
    expect(onMove).toHaveBeenNthCalledWith(2, 'b', 'up')
    expect(onRemove).toHaveBeenCalledWith('a')
  })

  it('opens the detail layer with the mapped target', async () => {
    await renderPanel({
      entries: [entry({
        id: 'a',
        title: '关卡一',
        stage: 'TEST-1',
        stageId: 'test_1',
        apCost: 18,
        uri: 'prts://101',
        source: 'set',
        setId: '48990',
        presetFormation: true,
        supportsRaid: false,
        completedModes: ['normal'],
        operators: ['能天使'],
        operatorDetails: [{ name: '能天使', elite: 2, level: 60 }],
        groups: ['重装'],
      })],
    })

    const body = buttonByLabel(container, '查看队列第 1 项详情 关卡一')!
    expect(body.getAttribute('aria-expanded')).toBe('false')
    await click(body)

    expect(body.getAttribute('aria-expanded')).toBe('true')
    const target = detailTargets[detailTargets.length - 1]
    expect(target).toMatchObject({
      title: '关卡一',
      stage: 'TEST-1',
      stageId: 'test_1',
      apCost: 18,
      sourceLabel: '作业集 prts://s48990',
      uri: 'prts://101',
      presetFormation: true,
      supportsRaid: false,
      completedModes: ['normal'],
      operators: [{ name: '能天使', elite: 2, level: 60 }],
      groups: ['重装'],
      statusLabel: '待执行',
    })
  })

  it('passes the failed status and complete failure reason to the detail target', async () => {
    await renderPanel({
      entries: [entry({
        id: 'a',
        title: '关卡一',
        stage: 'TEST-1',
        source: 'set',
        setId: '48990',
        setItemIndex: 0,
      })],
      setId: '48990',
      itemStatuses: new Map([[0, 'failed']]),
      itemErrors: new Map([[0, '缺少干员：桃金娘\n请检查 box 后重试']]),
    })

    await click(buttonByLabel(container, '查看队列第 1 项详情 关卡一')!)

    expect(detailTargets[detailTargets.length - 1]).toMatchObject({
      statusLabel: '待重试',
      error: '缺少干员：桃金娘\n请检查 box 后重试',
    })
  })

  it('maps set-backed rows to run statuses and custom rows to submitted state', async () => {
    const entries = [
      entry({ id: 's0', source: 'set', setId: '48990', setItemIndex: 0, title: '关卡一' }),
      entry({ id: 's1', source: 'set', setId: '48990', setItemIndex: 1, title: '关卡二' }),
      entry({ id: 'custom', title: '自定义作业', uri: 'prts://900' }),
    ]
    await renderPanel({
      entries,
      selected: new Set(['s0', 's1', 'custom']),
      setId: '48990',
      itemStatuses: new Map([[0, 'success'], [1, 'failed']]),
      submittedEntryIds: new Set(['custom']),
      isRunning: true,
    })

    const rows = () => container.querySelectorAll('[role="listitem"]')
    expect(rows()[0]?.textContent).toContain('已完成')
    expect(rows()[1]?.textContent).toContain('待重试')
    expect(rows()[2]?.textContent).toContain('本次已提交')

    await renderPanel({
      entries,
      selected: new Set(['s0', 's1', 'custom']),
      setId: '48990',
      itemStatuses: new Map([[0, 'success'], [1, 'failed']]),
      submittedEntryIds: new Set(['custom']),
    })

    expect(rows()[0]?.textContent).toContain('已完成')
    expect(rows()[2]?.textContent).toContain('待执行')
  })

  it('maps row statuses to detail tones alongside the visible label', () => {
    const target = (
      entryOverrides: Partial<CopilotQueueEntry>,
      queueOverrides: Partial<CombatCopilotQueueProjection>,
    ) => buildQueueDetailTarget(entry(entryOverrides), queue(queueOverrides))
    const setTarget = (status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'stopped') => (
      target(
        { setId: '48990', setItemIndex: 0 },
        { setId: '48990', itemStatuses: new Map([[0, status]]) },
      )
    )

    expect(target({}, {})).toMatchObject({ statusLabel: '待执行', statusTone: 'neutral' })
    expect(setTarget('pending')).toMatchObject({ statusLabel: '待执行', statusTone: 'neutral' })
    expect(setTarget('running')).toMatchObject({ statusLabel: '执行中', statusTone: 'active' })
    expect(setTarget('success')).toMatchObject({ statusLabel: '已完成', statusTone: 'success' })
    expect(setTarget('failed')).toMatchObject({ statusLabel: '待重试', statusTone: 'danger' })
    expect(setTarget('skipped')).toMatchObject({ statusLabel: '已跳过', statusTone: 'neutral' })
    expect(setTarget('stopped')).toMatchObject({ statusLabel: '已终止', statusTone: 'warning' })

    expect(target(
      { id: 'run-entry' },
      { queueRun: runProjection({ statuses: new Map([['run-entry', { status: 'failed', error: '作战失败' }]]) }) },
    )).toMatchObject({ statusLabel: '执行失败', statusTone: 'danger' })
    expect(target(
      { id: 'submitted-entry' },
      { isRunning: true, submittedEntryIds: new Set(['submitted-entry']) },
    )).toMatchObject({ statusLabel: '本次已提交', statusTone: 'active' })
  })

  it('prefers queue run statuses over the set projection and shows the first failure line', async () => {
    const error = '缺少干员：桃金娘\n请检查 box 后重试'
    await renderPanel({
      entries: [entry({
        id: 's0',
        title: '关卡一',
        source: 'set',
        setId: '48990',
        setItemIndex: 0,
      })],
      setId: '48990',
      itemStatuses: new Map([[0, 'success']]),
      queueRun: runProjection({
        statuses: new Map([['s0', { status: 'failed', error }]]),
        failedCount: 1,
      }),
    })

    const row = container.querySelector('[role="listitem"]')
    expect(row?.textContent).toContain('执行失败')
    expect(row?.textContent).toContain('缺少干员：桃金娘')
    expect(row?.textContent).not.toContain('请检查 box 后重试')
    expect(row?.textContent).not.toContain('已完成')

    await click(buttonByLabel(container, '查看队列第 1 项详情 关卡一')!)
    expect(detailTargets[detailTargets.length - 1]).toMatchObject({
      statusLabel: '执行失败',
      error,
    })
  })

  it('offers continue and skip actions while a manual queue waits for the next entry', async () => {
    const onContinueQueue = vi.fn()
    const onSkipEntry = vi.fn()
    await renderPanel({
      queueRun: runProjection({
        state: 'waiting',
        isWaiting: true,
        waitingForNext: true,
        mode: 'manual',
        phase: 'waiting_for_next',
      }),
      onContinueQueue,
      onSkipEntry,
    })

    expect(buttonByText(container, '开始下一项')?.disabled).toBe(false)
    expect(buttonByText(container, '跳过此项')?.disabled).toBe(false)
    expect(container.querySelector('[aria-label^="开始下一项："]')).toBeNull()
    expect(container.querySelector('[aria-label^="跳过此项："]')).toBeNull()

    await click(buttonByText(container, '开始下一项')!)
    await click(buttonByText(container, '跳过此项')!)

    expect(onContinueQueue).toHaveBeenCalledOnce()
    expect(onSkipEntry).toHaveBeenCalledOnce()
  })

  it('explains unavailable waiting actions with focusable tooltips', async () => {
    await renderPanel({
      queueRun: runProjection({ state: 'waiting', isWaiting: true, mode: 'manual' }),
      automationAvailable: false,
      unavailableMessage: '设备未连接',
    })

    const continueTrigger = container.querySelector<HTMLElement>('[aria-label="开始下一项：设备未连接"]')
    const skipTrigger = container.querySelector<HTMLElement>('[aria-label="跳过此项：设备未连接"]')
    expect(continueTrigger?.tabIndex).toBe(0)
    expect(skipTrigger?.tabIndex).toBe(0)
    expect(buttonByText(container, '开始下一项')?.disabled).toBe(true)
    expect(buttonByText(container, '跳过此项')?.disabled).toBe(true)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    await act(async () => continueTrigger!.focus())
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('设备未连接')
  })

  it('explains an unavailable retry action with a focusable tooltip', async () => {
    await renderPanel({
      entries: [entry({ id: 'a', title: '关卡一' })],
      queueRun: runProjection({
        state: 'succeeded',
        isActive: false,
        isTerminal: true,
        statuses: new Map([['a', { status: 'failed', error: '作战失败' }]]),
        failedCount: 1,
        totalCount: 1,
      }),
      automationAvailable: false,
      unavailableMessage: '设备未连接',
    })

    const retryTrigger = container.querySelector<HTMLElement>('[aria-label="重试失败项：设备未连接"]')
    expect(retryTrigger?.tabIndex).toBe(0)
    expect(buttonByText(container, '重试失败项')?.disabled).toBe(true)

    await act(async () => retryTrigger!.focus())
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('设备未连接')
  })

  it('disables continue and skip while their requests are in flight', async () => {
    await renderPanel({
      queueRun: runProjection({ state: 'waiting', isWaiting: true, mode: 'manual' }),
      isContinuing: true,
      isSkipping: true,
    })

    expect(buttonByText(container, '正在开始')).toBeDefined()
    expect(buttonByText(container, '正在跳过')).toBeDefined()
    expect(buttonByText(container, '正在开始')?.disabled).toBe(true)
    expect(buttonByText(container, '正在跳过')?.disabled).toBe(true)
  })

  it('offers retrying failed entries only after a terminal queue run', async () => {
    const onRetryFailed = vi.fn()
    const entries = [
      entry({ id: 'a', title: '关卡一' }),
      entry({ id: 'b', title: '关卡二', uri: 'prts://102' }),
    ]
    await renderPanel({
      entries,
      selected: new Set(['a', 'b']),
      queueRun: runProjection({
        state: 'succeeded',
        isActive: false,
        isTerminal: true,
        statuses: new Map([
          ['a', { status: 'success' }],
          ['b', { status: 'failed', error: '作战失败' }],
        ]),
        failedCount: 1,
        successCount: 1,
        totalCount: 2,
      }),
      onRetryFailed,
    })

    const rowText = () => container.querySelectorAll('[role="listitem"]')[1]?.textContent ?? ''
    expect(rowText()).toContain('执行失败')
    expect(rowText()).toContain('作战失败')
    await click(buttonByText(container, '重试失败项')!)

    expect(onRetryFailed).toHaveBeenCalledOnce()
  })

  it('keeps the retry action hidden while the queue run is still active', async () => {
    await renderPanel({
      entries: [entry({ id: 'a' })],
      queueRun: runProjection({
        isTerminal: false,
        statuses: new Map([['a', { status: 'failed', error: '作战失败' }]]),
      }),
    })

    expect(buttonByText(container, '重试失败项')).toBeUndefined()
  })

  it('describes per-item state and the configured failure policy', async () => {
    await renderPanel({ failurePolicy: 'stop' })
    expect(container.textContent).toContain('按队列顺序执行')
    expect(container.textContent).toContain('失败即停')
    expect(container.textContent).toContain('可查看逐项状态')

    await renderPanel({ failurePolicy: 'continue' })
    expect(container.textContent).toContain('失败后继续')

    await renderPanel({
      failurePolicy: 'continue',
      queueRun: runProjection({ failurePolicy: 'stop' }),
    })
    expect(container.textContent).toContain('失败即停')
  })

  it('locks selection and ordering while a submission is in flight', async () => {
    await renderPanel({ isSubmitting: true })

    const checkbox = checkboxByLabel(container, '取消选择队列第 1 项 作业一')
    expect(checkbox?.getAttribute('aria-checked')).toBe('true')
    expect(checkbox?.getAttribute('aria-disabled')).toBe('true')
    expect(buttonByLabel(container, '删除第 1 项 作业一')?.disabled).toBe(true)
  })
})
