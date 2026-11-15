// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import {
  ExecutionController,
  type AgentRun,
  type RunProgress,
  type RunSnapshot,
  type RunTaskResult,
  type StopRunResult,
} from '@/features/task-execution'
import { userConfigCoordinator } from '@/features/user-config'
import CombatTasks from './CombatTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const selectOptionLabels = async (trigger: HTMLElement) => {
  await act(async () => trigger.click())
  const popupId = trigger.getAttribute('aria-controls')
  const labels = popupId
    ? [...(document.getElementById(popupId)?.querySelectorAll('[role="option"]') ?? [])].map(node => node.textContent?.trim())
    : []
  await act(async () => {
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await act(async () => {})
  return labels
}

const mocks = vi.hoisted(() => ({
  controller: { current: null as unknown as ExecutionController },
  executePredefinedTaskArgs: vi.fn(),
  executeCopilotSetPlan: vi.fn(),
  continueCopilotSet: vi.fn(),
  executeCopilotQueue: vi.fn(),
  continueCopilotQueue: vi.fn(),
  skipCopilotQueueEntry: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  getCopilotInfo: vi.fn(),
  getCopilotSet: vi.fn(),
  getCopilotSetPlan: vi.fn(),
  resetCopilotSetProgress: vi.fn(),
  searchCopilot: vi.fn(),
  searchParadoxCopilot: vi.fn(),
  getCopilotStages: vi.fn(),
  getOperBoxData: vi.fn(),
  uploadCopilotFile: vi.fn(),
  getRealtimeLogs: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

const renderCounts = vi.hoisted(() => ({ setPanel: 0 }))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) =>
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

vi.mock('@/shared/api', async () => {
  const actual = await vi.importActual<typeof import('@/shared/api')>('@/shared/api')
  return {
    ...actual,
    API_BASE_URL: '/api',
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  }
})

vi.mock('@/features/task-execution', async () => {
  const actual = await vi.importActual<typeof import('@/features/task-execution')>('@/features/task-execution')
  return {
    ...actual,
    get executionController() {
      return mocks.controller.current
    },
    executePredefinedTaskArgs: mocks.executePredefinedTaskArgs,
    useExecutionSnapshot: () => actual.useExecutionSnapshot(mocks.controller.current),
  }
})

vi.mock('@/features/user-config', async () => {
  const actual = await vi.importActual<typeof import('@/features/user-config')>('@/features/user-config')
  return {
    ...actual,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
  }
})

vi.mock('@/features/combat/api', () => ({
  executeCopilotSetPlan: mocks.executeCopilotSetPlan,
  continueCopilotSet: mocks.continueCopilotSet,
  executeCopilotQueue: mocks.executeCopilotQueue,
  continueCopilotQueue: mocks.continueCopilotQueue,
  skipCopilotQueueEntry: mocks.skipCopilotQueueEntry,
  getCopilotInfo: mocks.getCopilotInfo,
  getCopilotSet: mocks.getCopilotSet,
  getCopilotSetPlan: mocks.getCopilotSetPlan,
  resetCopilotSetProgress: mocks.resetCopilotSetProgress,
  searchCopilot: mocks.searchCopilot,
  searchParadoxCopilot: mocks.searchParadoxCopilot,
  getCopilotStages: mocks.getCopilotStages,
  uploadCopilotFile: mocks.uploadCopilotFile,
}))

vi.mock('@/features/game-data/api', async () => {
  const actual = await vi.importActual<typeof import('@/features/game-data/api')>('@/features/game-data/api')
  return {
    ...actual,
    getOperBoxData: mocks.getOperBoxData,
  }
})

vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('@/shared/notifications', () => ({
  notify: mocks.notify,
  notifyProgress: mocks.notifyProgress,
  dismissNotice: mocks.dismissNotice,
  detectNoticeType: () => 'default',
  EXECUTION_NOTICE_ID: 'execution',
  STATISTICS_NOTICE_ID: 'statistics',
  SETTINGS_UPDATE_NOTICE_ID: 'settings-update',
  COMBAT_PREVIEW_NOTICE_ID: 'combat-preview',
  COMBAT_QUEUE_PREVIEW_NOTICE_ID: 'combat-queue-preview',
  COMBAT_PARADOX_SEARCH_NOTICE_ID: 'combat-paradox-search',
}))

vi.mock('@/features/logs/api', () => ({
  getRealtimeLogs: mocks.getRealtimeLogs,
  clearRealtimeLogs: vi.fn(),
  getLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  cleanupLogs: vi.fn(),
}))

vi.mock('@/features/device-mirror', () => ({ DeviceMonitorPanel: () => <div data-testid="screen-monitor" /> }))

vi.mock('@/features/combat/components/CombatCopilotSetPanel', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('@/features/combat/components/CombatCopilotSetPanel')>()
  const CountingSetPanel = (props: Parameters<typeof actual.default>[0]) => {
    renderCounts.setPanel += 1
    return React.createElement(actual.default, props)
  }
  return { ...actual, default: CountingSetPanel }
})

const CONTROLLER_INTERVALS = { active: 1_000, idle: 5_000, disconnected: 2_000 }

const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data })
const failed = (code: string, message: string): ApiResponse => ({
  success: false,
  error: message,
  message,
  errorInfo: { code, message },
})

function activeRun(
  runId: string,
  state: AgentRun['state'] = 'running',
  overrides: Partial<AgentRun> = {},
): AgentRun {
  return {
    runId,
    operationId: 'run_task',
    state,
    acceptedAt: '2026-10-25T00:00:00.000Z',
    links: {
      self: `/api/agent/runs/${runId}`,
      stop: `/api/agent/actions/stop?runId=${runId}`,
    },
    ...overrides,
  }
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const activeRuns = overrides.activeRuns ?? []
  const run = overrides.run ?? activeRuns[0] ?? null
  return {
    isRunning: activeRuns.length > 0,
    run,
    activeRuns,
    lastRun: overrides.lastRun ?? null,
    occupancy: {
      state: activeRuns.length ? 'run' : 'idle',
      runId: run?.runId ?? null,
      runState: run?.state ?? null,
      sources: activeRuns.length ? ['run'] : [],
      lease: { state: 'free', owner: null },
      task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
      schedule: {},
    },
    ...overrides,
  }
}

type ItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'stopped'

function planEntry(
  itemIndex: number,
  status: ItemStatus,
  overrides: Partial<RunTaskResult> = {},
): RunTaskResult {
  return {
    key: `${itemIndex}:${101 + itemIndex}:normal`,
    itemIndex,
    copilotId: 101 + itemIndex,
    stageId: `test_${itemIndex + 1}`,
    displayStage: `TEST-${itemIndex + 1}`,
    stage: `TEST-${itemIndex + 1}`,
    mode: 'normal',
    presetFormation: false,
    status,
    ...overrides,
  }
}

function setProgress(
  taskResults: RunTaskResult[],
  overrides: Partial<RunProgress> = {},
): RunProgress {
  const count = (status: ItemStatus) => taskResults.filter(entry => entry.status === status).length
  return {
    setId: '48990',
    name: '作业集 48990',
    mode: 'continuous',
    phase: 'running',
    currentStep: taskResults.length - count('pending'),
    totalSteps: taskResults.length,
    currentTask: null,
    currentEntry: taskResults.find(entry => entry.status === 'running') ?? null,
    nextEntry: null,
    shouldStop: false,
    successCount: count('success'),
    failedCount: count('failed'),
    stoppedCount: count('stopped'),
    pendingCount: count('pending'),
    message: '作业集执行中',
    taskResults,
    ...overrides,
  }
}

function setResult(
  taskResults: RunTaskResult[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const count = (status: ItemStatus) => taskResults.filter(entry => entry.status === status).length
  return {
    success: true,
    stopped: false,
    finished: true,
    mode: 'continuous',
    setId: '48990',
    name: '作业集 48990',
    raid: 'normal',
    message: '作业集执行完成',
    plan: { items: [], entries: [] },
    completed: [],
    pending: [],
    results: [],
    summary: {
      setId: '48990',
      name: '作业集 48990',
      mode: 'continuous',
      raid: 'normal',
      totalEntries: taskResults.length,
      queuedEntries: taskResults.length,
      attemptedCount: taskResults.length - count('pending'),
      alreadyCompletedCount: 0,
      successCount: count('success'),
      failedCount: count('failed'),
      stoppedCount: count('stopped'),
      pendingCount: count('pending'),
      durationMs: 5_000,
      errors: taskResults
        .filter(entry => entry.status === 'failed')
        .map(entry => ({ key: entry.key, stage: entry.displayStage, error: entry.error })),
      taskResults,
    },
    ...overrides,
  }
}

function setRun(
  runId: string,
  state: AgentRun['state'],
  options: { progress?: RunProgress; result?: Record<string, unknown>; error?: AgentRun['error'] } = {},
): AgentRun {
  return activeRun(runId, state, {
    operationId: 'run_copilot_set',
    ...(options.progress ? { progress: options.progress } : {}),
    ...(options.result ? { result: options.result } : {}),
    ...(options.error ? { error: options.error } : {}),
  })
}

type QueueItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'stopped'

function queueEntry(
  clientId: string,
  itemIndex: number,
  status: QueueItemStatus,
  overrides: Partial<RunTaskResult> = {},
): RunTaskResult {
  return {
    clientId,
    itemIndex,
    stage: `QUEUE-${itemIndex + 1}`,
    mode: 'normal',
    status,
    ...overrides,
  }
}

function queueProgress(
  taskResults: RunTaskResult[],
  overrides: Partial<RunProgress> = {},
): RunProgress {
  const count = (status: QueueItemStatus) => taskResults.filter(entry => entry.status === status).length
  return {
    queueId: 'copilot-queue',
    name: '作业队列',
    mode: 'continuous',
    failurePolicy: 'continue',
    phase: 'running',
    currentStep: taskResults.length - count('pending'),
    totalSteps: taskResults.length,
    currentClientId: taskResults.find(entry => entry.status === 'running')?.clientId ?? null,
    currentTask: null,
    nextEntry: null,
    shouldStop: false,
    successCount: count('success'),
    failedCount: count('failed'),
    skippedCount: count('skipped'),
    stoppedCount: count('stopped'),
    pendingCount: count('pending'),
    message: '作业队列执行中',
    taskResults,
    ...overrides,
  }
}

function queueResult(
  taskResults: RunTaskResult[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const count = (status: QueueItemStatus) => taskResults.filter(entry => entry.status === status).length
  return {
    success: true,
    finished: true,
    mode: 'continuous',
    queueId: 'copilot-queue',
    name: '作业队列',
    failurePolicy: 'continue',
    message: '作业队列执行完成',
    summary: {
      queueId: 'copilot-queue',
      name: '作业队列',
      mode: 'continuous',
      failurePolicy: 'continue',
      totalEntries: taskResults.length,
      successCount: count('success'),
      failedCount: count('failed'),
      skippedCount: count('skipped'),
      stoppedCount: count('stopped'),
      pendingCount: count('pending'),
      durationMs: 5_000,
      errors: taskResults
        .filter(entry => entry.status === 'failed')
        .map(entry => ({ clientId: entry.clientId, stage: entry.stage, error: entry.error })),
      taskResults,
    },
    ...overrides,
  }
}

function queueRun(
  runId: string,
  state: AgentRun['state'],
  options: { progress?: RunProgress; result?: Record<string, unknown>; error?: AgentRun['error'] } = {},
): AgentRun {
  return activeRun(runId, state, {
    operationId: 'run_copilot_queue',
    ...(options.progress ? { progress: options.progress } : {}),
    ...(options.result ? { result: options.result } : {}),
    ...(options.error ? { error: options.error } : {}),
  })
}

interface TestExecutionIdentity {
  runId: string
  operationId: string | null
  scope?: string | null
}

function createApi() {
  return {
    fetchSnapshot: vi.fn<(signal?: AbortSignal) => Promise<ApiResponse<RunSnapshot>>>(),
    fetchRun: vi.fn<(runId: string, signal?: AbortSignal) => Promise<ApiResponse<AgentRun>>>(),
    stopRun: vi.fn<(runId: string) => Promise<ApiResponse<StopRunResult>>>(),
  }
}

function memoryStorage(initial: TestExecutionIdentity | null = null) {
  let value = initial
  return {
    read: () => value,
    write: (identity: TestExecutionIdentity | null) => {
      value = identity
    },
  }
}

let api: ReturnType<typeof createApi>
let controller: ExecutionController
let releases: Array<() => void>
let container: HTMLDivElement
let root: Root
let client: ReturnType<typeof createQueryClient>

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  })
}

const settleQueries = async () => {
  await flush()
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

const buttonsByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .filter(button => button.textContent?.trim() === text) as HTMLButtonElement[]

const buttonByText = (text: string) => buttonsByText(text)[0]

const copilotDrawer = () => document.getElementById('combat-copilot-detail-panel')

const discoveryDialog = () => document.getElementById('combat-copilot-discovery-dialog')

const discoverySearchInput = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索作业关键词"]')

const discoverySearchButton = () => Array.from(
  discoveryDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [],
).find(button => button.textContent?.trim() === '搜索')

const DEFAULT_DISCOVERY_REQUEST = {
  keyword: '',
  level: '',
  includedOperators: [],
  excludedOperators: [],
  orderBy: 'hot',
  page: 1,
  limit: 30,
}

const openDiscovery = async () => {
  const trigger = buttonByText('发现')
  expect(trigger).toBeDefined()
  await click(trigger!)
}

const submitDiscoverySearch = async (keyword: string) => {
  const input = discoverySearchInput()
  expect(input).not.toBeNull()
  await setInputValue(input!, keyword)
  const submit = discoverySearchButton()
  expect(submit).toBeDefined()
  await click(submit!)
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

const keyDown = async (element: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    element.dispatchEvent(event)
  })
  return event
}

const useIdentity = (identity: TestExecutionIdentity | null) => {
  controller = new ExecutionController({
    api,
    storage: memoryStorage(identity),
    intervals: CONTROLLER_INTERVALS,
  })
  mocks.controller.current = controller
}

const startController = () => {
  const release = controller.start()
  releases.push(release)
}

const refreshController = async (reason: 'poll' | 'reconnect' = 'poll') => {
  await act(async () => {
    await controller.refresh(reason)
  })
  await flush()
}

const renderComponent = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CombatTasks />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const renderActivityMode = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <CombatTasks />
        </Activity>
      </QueryClientProvider>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  await flush()
}

const setInputValue = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const selectNativeValue = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const setRecognitionMode = async (mode: 'auto' | 'single' | 'set') => {
  const select = container.querySelector<HTMLSelectElement>('select[name="maa-copilot-preview-mode"]')
  expect(select, '识别方式下拉').not.toBeNull()
  await selectNativeValue(select as HTMLSelectElement, mode)
}

const chooseComboboxOption = async (trigger: HTMLElement, optionLabel: string) => {
  await act(async () => trigger.click())
  const popupId = trigger.getAttribute('aria-controls')
  const option = popupId
    ? [...(document.getElementById(popupId)?.querySelectorAll('[role="option"]') ?? [])]
      .find(node => node.textContent?.trim() === optionLabel)
    : undefined
  expect(option, `选项 ${optionLabel}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
  await flush()
}

const RAID_LABELS: Record<string, string> = {
  auto: '按作业标注',
  normal: '普通模式',
  raid: '突袭模式',
  both: '普通+突袭',
}

const difficultySelect = (): HTMLElement => {
  const trigger = container.querySelector<HTMLElement>('#combat-copilot-raid')
  expect(trigger, '难度下拉').not.toBeNull()
  return trigger as HTMLElement
}

const selectDifficulty = async (value: 'auto' | 'normal' | 'raid' | 'both') => {
  await chooseComboboxOption(difficultySelect(), RAID_LABELS[value]!)
}

const expectDifficulty = (value: 'auto' | 'normal' | 'raid' | 'both') => {
  expect(difficultySelect().textContent).toContain(RAID_LABELS[value]!)
}

const segmentedGroup = (label: string) => {
  const group = container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)
  expect(group, `${label} 分段控件`).not.toBeNull()
  return group as HTMLElement
}

const segmentedButton = (label: string, option: string) => {
  const button = Array.from(segmentedGroup(label).querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim() === option)
  expect(button, `${label} 的「${option}」`).toBeDefined()
  return button as HTMLButtonElement
}

const clickSegment = async (label: string, option: string) => {
  await click(segmentedButton(label, option))
}

const pressedSegment = (label: string) => Array.from(
  segmentedGroup(label).querySelectorAll<HTMLButtonElement>('button'),
).filter(button => button.getAttribute('aria-pressed') === 'true')
  .map(button => button.textContent?.trim())

const mockSetPlan = () => mocks.getCopilotSetPlan.mockResolvedValue({
  success: true,
  data: {
    items: [
      { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
      { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
    ],
    entries: [],
  },
})

const previewSet = async (uri = 'prts://s48990') => {
  mockSetPlan()
  await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, uri)
  await click(buttonByText('预览')!)
  await flush()
}

const selectCopilotFile = async (file: File) => {
  const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-file"]')
  expect(input, '作业文件选择框').not.toBeNull()
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => {
    input!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

const seedCopilotQueue = (entries: Array<Record<string, unknown>>) => {
  localStorage.setItem('la-pluma-copilot-queue-v1', JSON.stringify({ version: 1, entries }))
}

const buttonByAriaLabel = (label: string) => Array.from(document.querySelectorAll('button'))
  .find(button => button.getAttribute('aria-label') === label) as HTMLButtonElement | undefined

describe('CombatTasks execution', () => {
  beforeEach(() => {
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
    // 协调器是应用级单例：每个用例从空通道与空存储开始，避免跨用例沿用草稿/队列。
    userConfigCoordinator.dispose()
    localStorage.clear()
    // 搜索/预览 Query 缓存按用例隔离，避免复用上一个用例的 mock 结果。
    client = createQueryClient()
    mocks.executePredefinedTaskArgs.mockReset().mockResolvedValue({ success: true })
    mocks.executeCopilotSetPlan.mockReset().mockResolvedValue({ success: true })
    mocks.continueCopilotSet.mockReset().mockResolvedValue({ success: true, data: { accepted: true } })
    mocks.executeCopilotQueue.mockReset().mockResolvedValue({ success: true })
    mocks.continueCopilotQueue.mockReset().mockResolvedValue({ success: true, data: { accepted: true } })
    mocks.skipCopilotQueueEntry.mockReset().mockResolvedValue({ success: true, data: { skippedClientId: 'queue-a' } })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: false })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.getCopilotInfo.mockReset()
    mocks.getCopilotSet.mockReset()
    mocks.getCopilotSetPlan.mockReset()
    mocks.resetCopilotSetProgress.mockReset()
    mocks.searchCopilot.mockReset().mockResolvedValue(ok({ stage: '', copilots: [] }))
    mocks.searchParadoxCopilot.mockReset()
    mocks.getCopilotStages.mockReset().mockResolvedValue(ok([
      { stageId: 'main_01-07', code: '1-7', name: '暴君', category: '主题曲', zone: '第一章 黑暗时代·下' },
      { stageId: 'act55side_ex07', code: 'TL-EX-7', name: '时间啊，向前！', category: '活动关卡', zone: '火山旅梦' },
    ]))
    mocks.getOperBoxData.mockReset().mockResolvedValue(ok(null))
    mocks.uploadCopilotFile.mockReset()
    mocks.getRealtimeLogs.mockReset()
    mocks.notify.mockReset()
    mocks.notifyProgress.mockReset()
    mocks.dismissNotice.mockReset()
    renderCounts.setPanel = 0

    api = createApi()
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot()))
    api.fetchRun.mockResolvedValue(failed('AGENT_RUN_NOT_FOUND', '未找到 Agent run'))
    api.stopRun.mockResolvedValue(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: activeRun('run-1', 'stopping'),
    }))
    useIdentity(null)
    releases = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    for (const release of releases) release()
    document.body.style.overflow = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('submits one idempotent continuous set run for the default cli mode', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executeCopilotSetPlan.mockReturnValueOnce(submission.promise)
    await renderComponent()
    await previewSet()
    expect(pressedSegment('执行方式')).toEqual(['连续执行'])

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledOnce()
    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith(
      '48990',
      expect.objectContaining({
        mode: 'continuous',
        waitForCompletion: false,
        raid: 'auto',
        selectedIndexes: [0, 1],
      }),
      { idempotencyKey: expect.stringMatching(/^run_copilot_set-/) },
    )
    expect(buttonByText('正在启动')?.disabled).toBe(true)

    // 提交在途时重复点击（含直接派发）不会产生第二个请求。
    await act(async () => {
      buttonByText('正在启动')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => submission.resolve(ok({
      runId: 'run-set-1',
      state: 'accepted',
      run: setRun('run-set-1', 'accepted'),
    })))
    await flush()

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledOnce()
    expect(buttonByText('终止执行')).toBeDefined()
  })

  it('persists formation, raid and set mode chosen from the settings controls', async () => {
    await renderComponent()
    await previewSet()

    expect(pressedSegment('编队')).toEqual(['自动决定'])
    expectDifficulty('auto')
    expect(pressedSegment('执行方式')).toEqual(['连续执行'])

    await clickSegment('编队', '保留当前编队')
    await selectDifficulty('both')
    await clickSegment('执行方式', '手动逐关')

    expect(pressedSegment('编队')).toEqual(['保留当前编队'])
    expectDifficulty('both')
    expect(pressedSegment('执行方式')).toEqual(['手动逐关'])
    expect(JSON.parse(localStorage.getItem('combatAutoFormation') || '{}')).toMatchObject({ copilot: 'off' })
    expect(JSON.parse(localStorage.getItem('combatAdvancedParams') || '{}')).toMatchObject({
      copilot: { raid: 'both' },
    })
    expect(localStorage.getItem('combatCopilotSetExecutionMode')).toBe('manual')

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith(
      '48990',
      expect.objectContaining({
        mode: 'manual',
        raid: 'both',
        selectedIndexes: [0, 1],
        options: expect.objectContaining({ formationMode: 'off' }),
      }),
      expect.anything(),
    )
  })

  it('keeps the setting controls accessible and 44px high', async () => {
    await renderComponent()

    for (const [label, count] of [['编队', 3], ['执行方式', 2]] as const) {
      const group = segmentedGroup(label)
      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))
      expect(buttons).toHaveLength(count)
      expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
      buttons.forEach(button => {
        expect(button.className).toContain('min-h-11')
        expect(button.disabled).toBe(false)
      })
    }

    const difficulty = difficultySelect()
    expect(await selectOptionLabels(difficulty)).toHaveLength(4)
    expect(difficulty.getAttribute('aria-disabled')).toBeNull()
  })

  it('keeps execution progress without a separate log observer or entry', async () => {
    useIdentity({ runId: 'run-9', operationId: 'run_task', scope: 'combat' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      activeRuns: [activeRun('run-9', 'running', { progress: { currentTask: '自动战斗作业' } })],
    })))
    startController()
    await flush()
    await renderComponent()

    expect(container.querySelectorAll('[aria-label="本次执行进度"]')).toHaveLength(1)
    expect(container.querySelector('[aria-label="本次执行进度"]')?.textContent).toContain('本次执行进度')
    expect(container.querySelector('[role="log"]')).toBeNull()
    expect(container.textContent).not.toContain('查看本次日志')
    expect(mocks.getRealtimeLogs).not.toHaveBeenCalled()
  })

  it('does not offer a workspace log entry without a tracked run', async () => {
    await renderComponent()

    expect(container.querySelector('section[aria-label="本次执行日志"]')).toBeNull()
    expect(container.textContent).not.toContain('查看本次日志')
  })

  it('maps the app execution mode to a continuous server run', async () => {
    localStorage.setItem('combatCopilotSetExecutionMode', 'app')
    await renderComponent()
    await previewSet()
    expect(pressedSegment('执行方式')).toEqual(['连续执行'])

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith(
      '48990',
      expect.objectContaining({ mode: 'continuous', selectedIndexes: [0, 1] }),
      expect.anything(),
    )
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('starts a manual set, waits for the server next entry, and continues it', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executeCopilotSetPlan.mockReturnValueOnce(submission.promise)
    await renderComponent()
    await previewSet()
    await clickSegment('执行方式', '手动逐关')

    await click(buttonByText('立即执行')!)
    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith(
      '48990',
      expect.objectContaining({ mode: 'manual', selectedIndexes: [0, 1] }),
      expect.anything(),
    )

    const waiting = setRun('run-set-2', 'waiting', {
      progress: setProgress(
        [planEntry(0, 'success'), planEntry(1, 'pending')],
        {
          mode: 'manual',
          phase: 'waiting_for_next',
          nextEntry: planEntry(1, 'pending'),
          currentEntry: null,
          message: '等待开始下一关',
        },
      ),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waiting] })))
    await act(async () => submission.resolve(ok({ runId: 'run-set-2', state: 'waiting', run: waiting })))
    await flush()

    expect(container.textContent).toContain('下一关')
    expect(copilotDrawer()?.textContent).toContain('第 2 / 2 关')
    await click(buttonByAriaLabel('关闭详情')!)
    expect(buttonByText('开始下一关')).toBeDefined()
    expect(buttonByText('终止执行')?.disabled).toBe(false)

    await click(buttonByText('开始下一关')!)

    expect(mocks.continueCopilotSet).toHaveBeenCalledOnce()
    expect(mocks.continueCopilotSet).toHaveBeenCalledWith('run-set-2', { waitForCompletion: false })
    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledOnce()

    await click(buttonByText('终止执行')!)

    expect(api.stopRun).toHaveBeenCalledOnce()
    expect(api.stopRun).toHaveBeenCalledWith('run-set-2')
  })

  it('keeps the waiting set when the device is busy and allows retry', async () => {
    useIdentity({ runId: 'run-set-3', operationId: 'run_copilot_set', scope: 'combat' })
    const waiting = setRun('run-set-3', 'waiting', {
      progress: setProgress(
        [planEntry(0, 'success'), planEntry(1, 'pending')],
        { mode: 'manual', phase: 'waiting_for_next', nextEntry: planEntry(1, 'pending'), currentEntry: null },
      ),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waiting] })))
    api.fetchRun.mockResolvedValue(ok(waiting))
    startController()
    await flush()
    await renderComponent()
    await previewSet()
    await flush()

    mocks.continueCopilotSet.mockResolvedValueOnce(failed('MAA_EXECUTION_BUSY', '设备正在被其他任务占用'))
    await click(buttonByText('开始下一关')!)
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith('设备正被其他任务占用，请稍后重试', 'warning', { id: 'execution' })
    expect(buttonByText('开始下一关')?.disabled).toBe(false)
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()

    mocks.continueCopilotSet.mockResolvedValueOnce(ok({ success: true, accepted: true }))
    await click(buttonByText('开始下一关')!)
    await flush()

    expect(mocks.continueCopilotSet).toHaveBeenCalledTimes(2)
  })

  it('reports the failure summary of a failed set run', async () => {
    useIdentity({ runId: 'run-set-4', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-4', 'running', {
      progress: setProgress([planEntry(0, 'success'), planEntry(1, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()
    await flush()
    expect(buttonByText('终止执行')).toBeDefined()

    const failedRun = setRun('run-set-4', 'failed', {
      result: setResult([planEntry(0, 'success'), planEntry(1, 'failed', { error: '作战失败' })]),
      error: { code: 'COPILOT_PLAN_FAILED', message: '作业集执行失败，1 项未完成' },
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: failedRun })))
    api.fetchRun.mockResolvedValue(ok(failedRun))
    await refreshController()

    expect(mocks.notify).toHaveBeenCalledWith(
      '作业集执行失败: 作业集执行失败，1 项未完成',
      'error',
      { id: 'execution' },
    )
    expect(copilotDrawer()?.textContent).toContain('失败 1')
    expect(buttonByText('立即执行')).toBeDefined()

    const detail = buttonByAriaLabel('查看队列第 2 项详情 TEST-2')
    expect(detail).toBeDefined()
    await click(detail!)
    const drawer = document.querySelector('[role="dialog"]')
    expect(drawer?.textContent).toContain('待重试')
    expect(drawer?.textContent).toContain('失败原因')
    expect(drawer?.textContent).toContain('作战失败')
  })

  it('stops the tracked run and does not submit any further entry', async () => {
    useIdentity({ runId: 'run-set-5', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-5', 'running', {
      progress: setProgress([planEntry(0, 'success'), planEntry(1, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()
    await flush()

    await click(buttonByText('终止执行')!)

    expect(api.stopRun).toHaveBeenCalledOnce()
    expect(api.stopRun).toHaveBeenCalledWith('run-set-5')
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在终止自动战斗...', 'execution')

    const stopped = setRun('run-set-5', 'stopped', {
      result: setResult([planEntry(0, 'success'), planEntry(1, 'pending')], {
        stopped: true,
        message: '作业集已被终止',
      }),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: stopped })))
    api.fetchRun.mockResolvedValue(ok(stopped))
    await refreshController()

    expect(mocks.notify).toHaveBeenCalledWith('作业集已终止：1/2 成功', 'warning', { id: 'execution' })
    expect(buttonByText('立即执行')).toBeDefined()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('unlocks the stop action when confirmation times out so it can be retried', async () => {
    vi.useFakeTimers()
    useIdentity({ runId: 'run-set-6', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-6', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()
    await flush()

    // 停止请求被接受但 run 仍显示 running：确认超时后必须解锁重试。
    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: running,
    }))
    await click(buttonByText('终止执行')!)
    expect(buttonByText('正在终止')?.disabled).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith(
      '终止失败: 终止请求已发送，但尚未确认任务停止',
      'error',
      { id: 'execution' },
    )
    expect(buttonByText('终止执行')?.disabled).toBe(false)

    await click(buttonByText('终止执行')!)
    expect(api.stopRun).toHaveBeenCalledTimes(2)
  })

  it('keeps running state across Activity hide/show without stopping or resubmitting', async () => {
    useIdentity({ runId: 'run-set-7', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-7', 'running', {
      progress: setProgress([planEntry(0, 'success'), planEntry(1, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()

    await renderActivityMode('visible')
    await previewSet()
    expect(buttonByText('终止执行')).toBeDefined()

    await renderActivityMode('hidden')
    expect(api.stopRun).not.toHaveBeenCalled()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()

    const stopped = setRun('run-set-7', 'stopped', {
      result: setResult([planEntry(0, 'success'), planEntry(1, 'stopped', { error: '已终止' })], {
        stopped: true,
      }),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: stopped })))
    api.fetchRun.mockResolvedValue(ok(stopped))

    await renderActivityMode('visible')
    await refreshController()

    expect(buttonByText('立即执行')).toBeDefined()
    expect(api.stopRun).not.toHaveBeenCalled()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('执行完成'), 'success', { id: 'execution' })
  })

  it('replaces the execution progress when a submitted set finishes while hidden', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executeCopilotSetPlan.mockReturnValueOnce(submission.promise)
    useIdentity(null)
    startController()
    await flush()
    await renderActivityMode('visible')
    await previewSet()

    await click(buttonByText('立即执行')!)
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在连续执行作业集', 'execution')

    await renderActivityMode('hidden')
    const running = setRun('run-set-hidden', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    await act(async () => submission.resolve(ok({
      runId: 'run-set-hidden',
      state: 'accepted',
      run: running,
    })))
    await flush()

    const terminal = setRun('run-set-hidden', 'succeeded', {
      result: setResult([planEntry(0, 'success')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminal })))
    api.fetchRun.mockResolvedValue(ok(terminal))
    await refreshController()
    await renderActivityMode('visible')

    expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('作业集执行完成'), 'success', { id: 'execution' })
  })

  it('keeps the last running state when a snapshot fails and recovers on reconnect', async () => {
    useIdentity({ runId: 'run-set-8', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-8', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()

    api.fetchSnapshot.mockRejectedValueOnce(new Error('network down'))
    await refreshController('reconnect')

    expect(controller.getState().phase).toBe('disconnected')
    expect(buttonByText('终止执行')).toBeDefined()

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    await refreshController('reconnect')

    expect(controller.getState().phase).toBe('live')
    expect(buttonByText('终止执行')).toBeDefined()
    expect(api.fetchRun).toHaveBeenLastCalledWith('run-set-8', expect.anything())
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
  })

  it('recovers its own set run identity after a refresh without resubmitting', async () => {
    useIdentity({ runId: 'run-set-9', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-9', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()

    await renderComponent()

    expect(buttonByText('终止执行')).toBeDefined()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('stops a manual set from the failure strategy instead of offering the next entry', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
          { id: 103, stage: 'TEST-3', stageId: 'test_3', supportsRaid: true },
        ],
        entries: [],
      },
    })
    useIdentity({ runId: 'run-set-manual', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-manual', 'running', {
      progress: setProgress([planEntry(0, 'running'), planEntry(1, 'pending'), planEntry(2, 'pending')], {
        mode: 'manual',
        totalSteps: 3,
      }),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()

    const strategySelect = container.querySelector<HTMLElement>('[id="combat-copilot-executionStrategy"]')!
    await chooseComboboxOption(strategySelect, '失败后停止')

    const waitingAfterFailure = setRun('run-set-manual', 'waiting', {
      progress: setProgress(
        [planEntry(0, 'success'), planEntry(1, 'failed', { error: '作战失败' }), planEntry(2, 'pending')],
        {
          mode: 'manual',
          phase: 'waiting_for_next',
          totalSteps: 3,
          nextEntry: planEntry(2, 'pending'),
        },
      ),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waitingAfterFailure] })))
    api.fetchRun.mockResolvedValue(ok(waitingAfterFailure))
    await refreshController()

    expect(mocks.notify).toHaveBeenCalledWith('作业 2/3 执行失败: 作战失败，已按队列策略停止', 'error')
    expect(api.stopRun).toHaveBeenCalledWith('run-set-manual')
    expect(buttonByText('开始下一关')).toBeUndefined()
  })

  it('keeps the new run when an older terminal record is also in the snapshot', async () => {
    useIdentity({ runId: 'run-set-new', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-new', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    const olderTerminal = setRun('run-set-old', 'failed', {
      result: setResult([planEntry(0, 'failed', { error: '旧的失败' })]),
      error: { message: '旧的执行失败' },
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      activeRuns: [running],
      lastRun: olderTerminal,
    })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()

    expect(buttonByText('终止执行')).toBeDefined()
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('旧的执行失败'), 'error', { id: 'execution' })
    expect(controller.getState().trackedRunId).toBe('run-set-new')
  })

  it('does not turn an unknown run identity into completion or a resubmission', async () => {
    useIdentity({ runId: 'run-set-now', operationId: 'run_copilot_set', scope: 'combat' })
    const running = setRun('run-set-now', 'running', {
      progress: setProgress([planEntry(0, 'running')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    startController()
    await flush()
    await renderComponent()
    await previewSet()

    const otherTerminal = setRun('run-set-old', 'succeeded', {
      result: setResult([planEntry(0, 'success')]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: otherTerminal })))
    api.fetchRun.mockResolvedValue(failed('AGENT_RUN_NOT_FOUND', '未找到 Agent run'))
    await refreshController()

    expect(controller.getState().identity).toBe('unknown')
    expect(buttonByText('立即执行')).toBeDefined()
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('作业集执行完成'), 'success', { id: 'execution' })
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('作业集执行失败'), 'error', { id: 'execution' })
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
  })

  it('does not present another domain run as a combat execution', async () => {
    useIdentity({ runId: 'run-rogue', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-rogue')] })))
    api.fetchRun.mockResolvedValue(ok(activeRun('run-rogue')))
    startController()
    await flush()

    await renderComponent()

    expect(buttonByText('终止执行')).toBeUndefined()
    expect(buttonByText('立即执行')).toBeDefined()
  })

  it('does not show another set run next entry for the previewed set', async () => {
    useIdentity({ runId: 'run-set-other', operationId: 'run_copilot_set', scope: 'combat' })
    const otherWaiting = setRun('run-set-other', 'waiting', {
      progress: setProgress([planEntry(0, 'success'), planEntry(1, 'pending')], {
        setId: '11111',
        mode: 'manual',
        phase: 'waiting_for_next',
        nextEntry: planEntry(1, 'pending'),
      }),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [otherWaiting] })))
    api.fetchRun.mockResolvedValue(ok(otherWaiting))
    startController()
    await flush()

    await renderComponent()
    await previewSet()

    expect(buttonByText('开始下一关')).toBeUndefined()
    expect(container.textContent).not.toContain('下一关')
    expect(buttonByText('终止执行')).toBeDefined()
    expect(container.textContent).not.toContain('执行中')
  })

  it('runs a single task as a tracked run_task without waiting for completion', async () => {
    const execution = deferred<ApiResponse>()
    mocks.executePredefinedTaskArgs.mockReturnValueOnce(execution.promise)
    await renderComponent()

    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://1234')
    await click(buttonByText('立即执行')!)

    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledOnce()
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['prts://1234']),
      null,
      null,
      '自动战斗作业',
      'combat',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )

    await act(async () => execution.resolve(ok({
      runId: 'run-task-1',
      state: 'accepted',
      run: activeRun('run-task-1', 'accepted'),
    })))
    await flush()
    expect(buttonByText('终止执行')).toBeDefined()
  })

  it('previews an explicit PRTS single code without guessing a set with the same id', async () => {
    mocks.getCopilotInfo.mockResolvedValue({
      success: true,
      data: {
        status_code: 200,
        stage: 'TEST-1',
        stageId: 'test_1',
        data: { content: JSON.stringify({
          stage_name: 'test_1', doc: { title: 'PRTS 单作业' }, difficulty: 3,
          opers: [{ name: '桃金娘' }], groups: [{ name: '输出组' }],
        }) },
      },
    })
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://1234')
    await click(buttonByText('预览')!)
    expect(mocks.getCopilotInfo).toHaveBeenCalledWith('1234', expect.any(AbortSignal))
    expect(mocks.getCopilotSet).not.toHaveBeenCalled()
    expect(mocks.getCopilotSetPlan).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('PRTS 单作业')
    expect(copilotDrawer()?.textContent).toContain('PRTS 单作业')
    expect(copilotDrawer()?.textContent).toContain('TEST-1')
    expect(copilotDrawer()?.textContent).toContain('test_1')
    expect(copilotDrawer()?.textContent).toContain('桃金娘')
    expect(copilotDrawer()?.textContent).toContain('输出组')
    expect(copilotDrawer()?.textContent).toContain('作业标注普通+突袭')
  })

  it('links to the prts.plus copilot station', async () => {
    await renderComponent()
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://prts.plus/"]')
    expect(link?.textContent).toBe('prts.plus')
  })

  it('submits checked queue entries from the header as one ordered queue run', async () => {
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
      { id: 'queue-b', source: 'file', uri: '/data/my job.json', title: '本地作业', fileName: 'my job.json', addedAt: 2 },
      { id: 'queue-c', source: 'set', uri: 'prts://102', title: '作业集成员', setId: '48990', addedAt: 3 },
    ])
    await renderComponent()

    expect(buttonByText('执行队列')).toBeUndefined()
    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotQueue).toHaveBeenCalledOnce()
    expect(mocks.executeCopilotQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueId: 'copilot-queue',
        name: '作业队列',
        mode: 'continuous',
        failurePolicy: 'continue',
        waitForCompletion: false,
        options: expect.objectContaining({ formationMode: 'auto' }),
        entries: [
          { clientId: 'queue-a', source: 'prts', copilotId: 101, mode: 'auto' },
          { clientId: 'queue-b', source: 'file', filename: '/data/my job.json', mode: 'auto' },
          { clientId: 'queue-c', source: 'prts', copilotId: 102, mode: 'auto' },
        ],
      }),
      { idempotencyKey: expect.stringMatching(/^run_copilot_queue-/) },
    )
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('submits both difficulties for every eligible queue entry in queue order', async () => {
    localStorage.setItem('combatAdvancedParams', JSON.stringify({ copilot: { raid: 'both' } }))
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
      { id: 'queue-b', source: 'file', uri: '/data/my job.json', title: '本地作业', addedAt: 2 },
      { id: 'queue-c', source: 'set', uri: 'prts://102', title: '预设编队', presetFormation: true, addedAt: 3 },
    ])
    await renderComponent()

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotQueue).toHaveBeenCalledWith(expect.objectContaining({
      entries: [
        { clientId: 'queue-a', source: 'prts', copilotId: 101, mode: 'both' },
        { clientId: 'queue-b', source: 'file', filename: '/data/my job.json', mode: 'both' },
        { clientId: 'queue-c', source: 'prts', copilotId: 102, mode: 'normal' },
      ],
    }), expect.anything())
  })

  it('submits an unquoted original path for quoted local queue files', async () => {
    seedCopilotQueue([
      { id: 'local', source: 'file', uri: '"/data/my job.json"', title: '', fileName: 'my job.json', addedAt: 1 },
    ])
    await renderComponent()

    await click(buttonByText('立即执行')!)

    const [payload] = mocks.executeCopilotQueue.mock.calls[0] as [{ entries: unknown[] }]
    expect(payload.entries).toEqual([
      { clientId: 'local', source: 'file', filename: '/data/my job.json', mode: 'auto' },
    ])
  })

  it('maps the stop execution strategy to the queue failure policy', async () => {
    localStorage.setItem('combatAdvancedParams', JSON.stringify({
      copilot: { executionStrategy: 'stop' },
    }))
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
    ])
    await renderComponent()

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotQueue).toHaveBeenCalledWith(
      expect.objectContaining({ failurePolicy: 'stop' }),
      expect.anything(),
    )
  })

  it('falls back to a queue run when the queue mixes set members with custom entries', async () => {
    seedCopilotQueue([
      { id: 'custom', source: 'link', uri: 'prts://900', title: '自定义作业', addedAt: 1 },
    ])
    mockSetPlan()
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    expect(container.textContent).toContain('自定义作业')
    expect(container.textContent).toContain('共 3 项')
    await click(buttonByText('立即执行')!)

    const [payload] = mocks.executeCopilotQueue.mock.calls[0] as [{
      entries: Array<{ clientId: string; source: string; copilotId?: number }>
    }]
    expect(payload.entries.map(entry => entry.clientId)).toHaveLength(3)
    expect(payload.entries.map(entry => entry.copilotId)).toEqual([900, 101, 102])
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
  })

  it('keeps the queue order when set members are reordered before a queue run', async () => {
    mockSetPlan()
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    await click(buttonByAriaLabel('上移第 2 项 TEST-2')!)
    await flush()
    await click(buttonByText('立即执行')!)

    const [payload] = mocks.executeCopilotQueue.mock.calls[0] as [{
      entries: Array<{ copilotId?: number }>
    }]
    expect(payload.entries.map(entry => entry.copilotId)).toEqual([102, 101])
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
  })

  it('preserves set queue order, unchecked rows and removals when changing difficulty', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue(ok({
      items: [1, 2, 3].map(index => ({ id: 100 + index, stage: `TEST-${index}`, supportsRaid: true })),
      entries: [],
    }))
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await click(buttonByAriaLabel('上移第 2 项 TEST-2')!)
    await click(buttonByAriaLabel('取消选择队列第 1 项 TEST-2')!)
    await click(buttonByAriaLabel('删除第 3 项 TEST-3')!)

    await selectDifficulty('both')

    expect(buttonByAriaLabel('选择队列第 1 项 TEST-2')).toBeDefined()
    expect(buttonByAriaLabel('取消选择队列第 2 项 TEST-1')).toBeDefined()
    expect(container.querySelectorAll('section[aria-label="作业队列"] [role="listitem"]')).toHaveLength(2)
  })

  it('prompts for a queue selection before running a single job with an empty queue', async () => {
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
    ])
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://102')

    await click(buttonByAriaLabel('取消选择队列第 1 项 链接作业')!)
    await flush()
    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotQueue).not.toHaveBeenCalled()
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('请至少勾选一项队列作业', 'warning')

    await click(buttonByAriaLabel('删除第 1 项 链接作业')!)
    await flush()

    expect(container.textContent).toContain('队列为空')
    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotQueue).not.toHaveBeenCalled()
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledOnce()
  })

  it('shows queue run item states and continues or skips a waiting manual queue', async () => {
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
      { id: 'queue-b', source: 'link', uri: 'prts://102', title: '第二个作业', addedAt: 2 },
    ])
    useIdentity({ runId: 'run-queue-waiting', operationId: 'run_copilot_queue', scope: 'combat' })
    const waiting = queueRun('run-queue-waiting', 'waiting', {
      progress: queueProgress(
        [
          queueEntry('queue-a', 0, 'success'),
          queueEntry('queue-b', 1, 'success'),
          queueEntry('queue-b', 1, 'pending', { mode: 'raid' }),
        ],
        {
          mode: 'manual',
          phase: 'waiting_for_next',
          nextEntry: { clientId: 'queue-b', itemIndex: 1, stage: 'QUEUE-2', mode: 'raid' },
        },
      ),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waiting] })))
    api.fetchRun.mockResolvedValue(ok(waiting))
    startController()
    await flush()
    await renderComponent()

    const rows = container.querySelectorAll('[role="listitem"]')
    expect(rows[0]?.textContent).toContain('已完成')
    expect(rows[1]?.textContent).toContain('待执行')

    await click(buttonByText('跳过此项')!)
    expect(mocks.skipCopilotQueueEntry).toHaveBeenCalledWith('run-queue-waiting')
    expect(mocks.notify).toHaveBeenCalledWith('已跳过当前项', 'success', { id: 'execution' })

    await click(buttonByText('开始下一项（突袭）')!)
    expect(mocks.continueCopilotQueue).toHaveBeenCalledWith('run-queue-waiting', false)
  })

  it('retries only failed queue difficulties in their original entry order', async () => {
    seedCopilotQueue([
      { id: 'queue-a', source: 'link', uri: 'prts://101', title: '链接作业', addedAt: 1 },
      { id: 'queue-b', source: 'link', uri: 'prts://102', title: '第二个作业', addedAt: 2 },
      { id: 'queue-c', source: 'link', uri: 'prts://103', title: '第三个作业', addedAt: 3 },
    ])
    useIdentity({ runId: 'run-queue-done', operationId: 'run_copilot_queue', scope: 'combat' })
    const done = queueRun('run-queue-done', 'succeeded', {
      result: queueResult([
        queueEntry('queue-a', 0, 'success'),
        queueEntry('queue-b', 1, 'success'),
        queueEntry('queue-b', 1, 'failed', { mode: 'raid', error: '作战失败' }),
        queueEntry('queue-c', 2, 'failed', { error: '缺少干员' }),
        queueEntry('queue-c', 2, 'failed', { mode: 'raid', error: '缺少干员' }),
      ]),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [], lastRun: done })))
    api.fetchRun.mockResolvedValue(ok(done))
    startController()
    await flush()
    await renderComponent()

    expect(container.textContent).toContain('执行失败')
    expect(container.textContent).toContain('作战失败')

    await click(buttonByAriaLabel('上移第 3 项 第三个作业')!)
    await click(buttonByText('重试失败项')!)
    await flush()

    const [payload] = mocks.executeCopilotQueue.mock.calls[0] as [{ entries: unknown[] }]
    expect(payload.entries).toEqual([
      { clientId: 'queue-b', source: 'prts', copilotId: 102, mode: 'raid' },
      { clientId: 'queue-c', source: 'prts', copilotId: 103, mode: 'both' },
    ])
    expect(buttonByAriaLabel('选择队列第 1 项 链接作业')?.getAttribute('aria-pressed')).toBe('false')
    expect(buttonByAriaLabel('取消选择队列第 2 项 第三个作业')?.getAttribute('aria-pressed')).toBe('true')
    expect(buttonByAriaLabel('取消选择队列第 3 项 第二个作业')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the URI source and the discovery entry without an inline stage search', async () => {
    await renderComponent()

    expect(container.querySelector('input[name="maa-copilot-uri"]')).not.toBeNull()
    expect(container.querySelector('input[name="maa-copilot-stage-search"]')).toBeNull()
    expect(buttonByText('发现')).toBeDefined()
    expect(container.querySelector('section[aria-label="作业集摘要"]')).toBeNull()

    const queue = container.querySelector<HTMLElement>('section[aria-label="作业队列"]')
    expect(queue).not.toBeNull()
    expect(queue?.querySelectorAll('.app-empty-state')).toHaveLength(1)
    expect(queue?.querySelector('.app-empty-state')?.textContent).toContain('队列为空')
    expect(queue?.querySelector('.app-empty-state')?.textContent)
      .toContain('输入作业集链接会自动展开到队列')
    expect(container.querySelectorAll('section[aria-label="作业队列"]')).toHaveLength(1)
  })

  it('imports a local copilot file without writing the uploaded path into the input', async () => {
    await renderComponent()
    await previewSet()
    expect(container.textContent).toContain('TEST-1')

    mocks.uploadCopilotFile.mockResolvedValueOnce(ok({
      path: '/data/copilot-files/job.json',
    }))
    await selectCopilotFile(new File(['{"stage_name":"1-7"}'], 'job.json', { type: 'application/json' }))

    expect(mocks.uploadCopilotFile).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value)
      .toBe('prts://s48990')
    expect(mocks.notify).toHaveBeenCalledWith('已导入本地作业: job.json', 'success')
    const queue = container.querySelector<HTMLElement>('section[aria-label="作业队列"]')
    expect(queue?.querySelectorAll('[role="listitem"]')).toHaveLength(3)
    expect(queue?.textContent).toContain('job.json')
    expect(container.querySelector('section[aria-label="作业集摘要"]')).toBeNull()
  })

  it('keeps the original input when a file import fails', async () => {
    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await setInputValue(input, 'prts://1234')

    mocks.uploadCopilotFile.mockResolvedValueOnce(failed('COPILOT_FILE_INVALID', '作业文件不是合法 JSON'))
    await selectCopilotFile(new File(['not-json'], 'bad.json', { type: 'application/json' }))

    expect(input.value).toBe('prts://1234')
    expect(mocks.notify).toHaveBeenCalledWith('作业文件不是合法 JSON', 'error')

    mocks.uploadCopilotFile.mockRejectedValueOnce(new Error('网络连接中断'))
    await selectCopilotFile(new File(['{}'], 'retry.json', { type: 'application/json' }))

    expect(input.value).toBe('prts://1234')
    expect(mocks.notify).toHaveBeenLastCalledWith('网络连接中断', 'error')
  })

  it('keeps the current preview and skips the upload when the queue is full', async () => {
    seedCopilotQueue(Array.from({ length: 50 }, (_, index) => ({
      id: `job-${index}`, source: 'link', uri: `prts://${index + 200}`, title: `作业 ${index}`, addedAt: 1,
    })))
    mocks.uploadCopilotFile.mockResolvedValueOnce(ok({ path: '/data/copilot-files/job.json' }))
    await renderComponent()
    await previewSet()
    expect(document.querySelector('section[aria-label="作业集摘要"]')).not.toBeNull()

    await selectCopilotFile(new File(['{}'], 'job.json', { type: 'application/json' }))

    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenLastCalledWith('队列已满，最多 50 个作业', 'warning')
    expect(document.querySelector('section[aria-label="作业集摘要"]')).not.toBeNull()
  })

  it('preserves the preview when the queue fills while an upload is pending', async () => {
    seedCopilotQueue(Array.from({ length: 49 }, (_, index) => ({
      id: `job-${index}`, source: 'link', uri: `prts://${index + 200}`, title: `作业 ${index}`, addedAt: 1,
    })))
    const pending = deferred<ApiResponse>()
    mocks.uploadCopilotFile.mockReturnValueOnce(pending.promise)
    mocks.getCopilotInfo.mockResolvedValueOnce(ok({
      status_code: 200,
      data: { content: JSON.stringify({ doc: { title: '另一份作业' }, stage_name: '1-7' }) },
    }))
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://101')
    await click(buttonByText('预览')!)
    expect(copilotDrawer()?.textContent).toContain('另一份作业')

    await selectCopilotFile(new File(['{}'], 'job.json', { type: 'application/json' }))
    await click(buttonByText('加入队列')!)
    expect(container.querySelectorAll('section[aria-label="作业队列"] [role="listitem"]')).toHaveLength(50)

    await act(async () => pending.resolve(ok({ path: '/data/copilot-files/job.json' })))
    await flush()

    expect(mocks.notify).toHaveBeenLastCalledWith('队列已满，最多 50 个作业', 'warning')
    expect(copilotDrawer()?.textContent).toContain('另一份作业')
    expect(container.textContent).not.toContain('job.json')
  })

  it('submits only one file import while a request is in flight', async () => {
    const pending = deferred<ApiResponse>()
    mocks.uploadCopilotFile.mockReturnValueOnce(pending.promise)
    await renderComponent()

    const file = new File(['{}'], 'job.json', { type: 'application/json' })
    await selectCopilotFile(file)
    expect(buttonByAriaLabel('导入 JSON 作业文件')?.disabled).toBe(true)

    await selectCopilotFile(file)

    expect(mocks.uploadCopilotFile).toHaveBeenCalledOnce()

    await act(async () => pending.resolve(ok({
      path: '/data/copilot-files/job.json',
      name: 'job.json',
    })))
    await flush()

    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('')
    expect(mocks.notify).toHaveBeenCalledWith('已导入本地作业: job.json', 'success')
    expect(buttonByAriaLabel('导入 JSON 作业文件')?.disabled).toBe(false)
  })

  it.each(['prts://s48990', 'PRTS://S48990'])(
    'previews %s as a set with its plan entries',
    async uri => {
      mocks.getCopilotSetPlan.mockResolvedValue({
        success: true,
        data: { items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }], entries: [] },
      })
      await renderComponent()
      await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, uri)
      await click(buttonByText('预览')!)
      expect(mocks.getCopilotSetPlan).toHaveBeenCalledWith('48990', 'auto', expect.any(AbortSignal))
      expect(mocks.getCopilotInfo).not.toHaveBeenCalled()
      expect(copilotDrawer()?.textContent).toContain('续跑目标')
    },
  )

  it('falls back to the set list when the plan request fails', async () => {
    mocks.getCopilotSetPlan.mockRejectedValue(new Error('plan unavailable'))
    mocks.getCopilotSet.mockResolvedValue({
      success: true,
      data: { status_code: 200, data: { copilot_ids: [101] } },
    })
    mocks.getCopilotInfo.mockResolvedValue({
      success: true,
      data: { status_code: 200, data: { content: JSON.stringify({
        stage_name: 'TEST-1', doc: { title: '兜底作业' },
      }) } },
    })

    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    expect(mocks.getCopilotSetPlan).toHaveBeenCalledWith('48990', 'auto', expect.any(AbortSignal))
    expect(mocks.getCopilotSet).toHaveBeenCalledWith('48990', expect.any(AbortSignal))
    expect(mocks.getCopilotInfo).toHaveBeenCalledWith('101', expect.any(AbortSignal))
    expect(copilotDrawer()?.textContent).toContain('共 1 个作业')
    expect(container.textContent).toContain('兜底作业')
  })

  it('supports roving focus across combat modes', async () => {
    await renderComponent()

    const modeToolbar = container.querySelector<HTMLElement>('[role="toolbar"][aria-label="作业类型"]')
    expect(modeToolbar, 'combat mode toolbar').not.toBeNull()
    const modeButtons = Array.from(modeToolbar!.querySelectorAll<HTMLButtonElement>('button'))
    expect(modeButtons).toHaveLength(3)
    expect(Array.from(modeButtons).filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(Array.from(modeButtons).map(button => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    const firstModeButton = modeButtons[0] as HTMLButtonElement
    const secondModeButton = modeButtons[1] as HTMLButtonElement
    firstModeButton.focus()
    await keyDown(firstModeButton, 'ArrowRight')
    expect(secondModeButton.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(secondModeButton)

    await keyDown(secondModeButton, 'Home')
    expect(firstModeButton.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(firstModeButton)

    const arrowDownEvent = await keyDown(firstModeButton, 'ArrowDown')
    expect(arrowDownEvent.defaultPrevented).toBe(false)
    expect(firstModeButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps an unsynced local draft across remounts and retries the save', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockResolvedValueOnce({ success: false, message: '配置存储暂不可用' })
    await renderComponent()

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://24680')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(localStorage.getItem('combatConfigSyncPending')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('combatTaskInputs') || '{}')).toMatchObject({ copilot: 'prts://24680' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('配置存储暂不可用')

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.loadUserConfig.mockClear()
    await renderComponent()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('prts://24680')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未同步到服务器')

    await click(buttonByText('重新同步')!)
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('combatConfigSyncPending')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.notify).toHaveBeenCalledWith('自动战斗配置已同步', 'success')
  })

  it('migrates a saved app set mode to cli and normalizes legacy raid values on load', async () => {
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: {
        taskInputs: { copilot: 'prts://s1' },
        advancedParams: {
          copilot: { ignoreRequirements: true, loopTimes: '1', executionStrategy: 'continue', raid: '1' },
          paradoxcopilot: { executionStrategy: 'continue' },
          ssscopilot: { loopTimes: '1' },
        },
        copilotSetExecutionMode: 'app',
      },
    })

    await renderComponent()

    expect(pressedSegment('执行方式')).toEqual(['连续执行'])
    expect(localStorage.getItem('combatCopilotSetExecutionMode')).toBe('cli')
    expect(JSON.parse(localStorage.getItem('combatAdvancedParams') || '{}')).toMatchObject({
      copilot: { raid: 'raid' },
    })
    expect(mocks.saveUserConfig).not.toHaveBeenCalled()
  })

  it('migrates a local app set mode to cli and normalizes legacy raid values when the server copy is unavailable', async () => {
    localStorage.setItem('combatTaskInputs', JSON.stringify({ copilot: 'prts://local' }))
    localStorage.setItem('combatAdvancedParams', JSON.stringify({ copilot: { raid: '2' } }))
    localStorage.setItem('combatCopilotSetExecutionMode', 'app')

    await renderComponent()

    expect(pressedSegment('执行方式')).toEqual(['连续执行'])
    expectDifficulty('both')
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(localStorage.getItem('combatCopilotSetExecutionMode')).toBe('cli')
    expect(JSON.parse(localStorage.getItem('combatAdvancedParams') || '{}')).toMatchObject({
      copilot: { raid: 'both' },
    })
  })

  it('restores a previous session draft with set mode migration and saved selections without reading the server', async () => {
    localStorage.setItem('combatConfigSyncPending', 'previous-session-token')
    localStorage.setItem('combatTaskInputs', JSON.stringify({ copilot: 'prts://s48990' }))
    localStorage.setItem('combatAdvancedParams', JSON.stringify({ copilot: { raid: '2' } }))
    localStorage.setItem('combatAutoFormation', JSON.stringify({ copilot: 'off' }))
    localStorage.setItem('combatCopilotSetExecutionMode', 'app')
    localStorage.setItem('combatCopilotSetSelections', JSON.stringify({ '48990': [1] }))
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskInputs: { copilot: 'prts://server' } },
    })

    await renderComponent()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(mocks.saveUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value)
      .toBe('prts://s48990')
    expectDifficulty('both')
    expect(pressedSegment('编队')).toEqual(['保留当前编队'])
    expect(pressedSegment('执行方式')).toEqual(['连续执行'])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未同步到服务器')

    await previewSet('prts://s48990')
    expect(copilotDrawer()?.textContent).toContain('待 1')
    expect(copilotDrawer()?.textContent).toContain('共 2 个作业')
  })

  it('drops a pending marker whose local draft is unreadable and falls back to the server', async () => {
    localStorage.setItem('combatTaskInputs', '{not-json')
    localStorage.setItem('combatAdvancedParams', JSON.stringify({ copilot: 'invalid' }))
    localStorage.setItem('combatConfigSyncPending', 'stale-token')
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskInputs: { copilot: 'prts://server' } },
    })

    await renderComponent()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(localStorage.getItem('combatConfigSyncPending')).toBeNull()
    expect(localStorage.getItem('combatTaskInputs')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value)
      .toBe('prts://server')
  })

  it('keeps a manual retry single-flight and announces success only after confirmation', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockRejectedValueOnce(new Error('网络连接中断'))
    await renderComponent()

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://24680')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('网络连接中断')
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.notify).not.toHaveBeenCalledWith('自动战斗配置已同步', 'success')

    const retrySave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(retrySave.promise)
    await click(buttonByText('重新同步')!)
    expect(buttonByText('同步中')?.disabled).toBe(true)

    // 重试请求在途时再次点击不会产生第二个提交。
    await click(buttonByText('同步中')!)
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.notify).not.toHaveBeenCalledWith('自动战斗配置已同步', 'success')

    await act(async () => retrySave.resolve({ success: true }))
    await flush()

    expect(localStorage.getItem('combatConfigSyncPending')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.notify).toHaveBeenCalledWith('自动战斗配置已同步', 'success')
  })

  it('keeps the hydrated draft and does not reload config after Activity restore', async () => {
    vi.useFakeTimers()
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: { taskInputs: { copilot: 'prts://server' } },
    })

    await renderActivityMode('visible')
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('prts://draft')
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
  })

  it('clears retained request loading when Activity restores the combat workspace', async () => {
    mocks.getCopilotInfo.mockReturnValueOnce(deferred<any>().promise)
    mocks.searchParadoxCopilot.mockReturnValueOnce(deferred<any>().promise)

    await renderActivityMode('visible')
    await setRecognitionMode('single')

    const previewInput = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await setInputValue(previewInput, 'prts://1234')
    const previewButton = buttonByText('预览')
    await click(previewButton!)
    expect(previewButton?.disabled).toBe(true)
    expect(mocks.getCopilotInfo).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(previewButton?.disabled).toBe(false)
    expect(previewButton?.textContent).toContain('预览')
    expect(previewInput.value).toBe('prts://1234')

    await openDiscovery()
    mocks.searchCopilot.mockReturnValueOnce(deferred<any>().promise)
    const searchInput = discoverySearchInput()!
    await setInputValue(searchInput, '1-7')
    const searchButton = discoverySearchButton()!
    await click(searchButton!)
    expect(searchButton?.disabled).toBe(true)
    expect(mocks.searchCopilot).toHaveBeenCalledTimes(3)

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    const restoredSearchButton = discoverySearchButton()
    expect(restoredSearchButton?.disabled).toBe(false)
    expect(restoredSearchButton?.textContent).toContain('搜索')
    expect(discoverySearchInput()?.value).toBe('1-7')

    await click(buttonByAriaLabel('关闭对话框')!)
    expect(discoveryDialog()).toBeNull()

    const paradoxModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
      .find(button => button.textContent?.includes('悖论模拟'))
    expect(paradoxModeButton).toBeDefined()
    await click(paradoxModeButton!)
    const paradoxInput = container.querySelector<HTMLInputElement>('input[name="maa-paradox-operator"]')!
    await setInputValue(paradoxInput, '能天使')
    const paradoxSearchButton = buttonByText('搜索')
    await click(paradoxSearchButton!)
    expect(paradoxSearchButton?.disabled).toBe(true)
    expect(mocks.searchParadoxCopilot).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(paradoxSearchButton?.disabled).toBe(false)
    expect(paradoxSearchButton?.textContent).toContain('搜索')
    expect(paradoxInput.value).toBe('能天使')
  })

  it('reports paradox search progress and result under one id', async () => {
    mocks.searchParadoxCopilot.mockResolvedValueOnce(ok({
      copilots: [{ id: 1, uri: 'prts://1', title: '悖论作业' }],
    }))
    await renderComponent()

    const paradoxModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
      .find(button => button.textContent?.includes('悖论模拟'))
    expect(paradoxModeButton).toBeDefined()
    await click(paradoxModeButton!)

    const paradoxInput = container.querySelector<HTMLInputElement>('input[name="maa-paradox-operator"]')!
    await setInputValue(paradoxInput, '能天使')
    await click(buttonByText('搜索')!)

    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在搜索作业...', 'combat-paradox-search')
    expect(mocks.notify).toHaveBeenCalledWith('找到 1 个作业', undefined, {
      id: 'combat-paradox-search',
    })
  })

  it('ignores an older search response after the keyword changes', async () => {
    const olderSearch = deferred<any>()
    const newerSearch = deferred<any>()
    await renderComponent()
    await openDiscovery()

    const searchInput = discoverySearchInput()!
    await setInputValue(searchInput, '旧关卡')
    mocks.searchCopilot.mockReturnValueOnce(olderSearch.promise)
    await click(discoverySearchButton()!)
    const olderSignal = mocks.searchCopilot.mock.calls[2]?.[1] as AbortSignal
    expect(olderSignal.aborted).toBe(false)

    await setInputValue(searchInput, '新关卡')
    // 输入变化立即取消旧读取，连接层收到的是真实 AbortSignal。
    expect(olderSignal.aborted).toBe(true)
    mocks.searchCopilot.mockReturnValueOnce(newerSearch.promise)
    await click(discoverySearchButton()!)

    await act(async () => newerSearch.resolve({
      success: true,
      data: { copilots: [{ id: 2, uri: 'prts://2', title: '新作业' }] },
    }))
    await flush()
    expect(discoveryDialog()?.textContent).toContain('新作业')

    await act(async () => olderSearch.resolve({
      success: true,
      data: { copilots: [{ id: 1, uri: 'prts://1', title: '旧作业' }] },
    }))
    await flush()
    expect(discoveryDialog()?.textContent).toContain('新作业')
    expect(discoveryDialog()?.textContent).not.toContain('旧作业')
  })

  it('ignores an older copilot preview after the URI changes', async () => {
    const olderPreview = deferred<any>()
    const newerPreview = deferred<any>()
    mocks.getCopilotInfo
      .mockReturnValueOnce(olderPreview.promise)
      .mockReturnValueOnce(newerPreview.promise)
    await renderComponent()
    await setRecognitionMode('single')

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await setInputValue(input, 'prts://1')
    await click(buttonByText('预览')!)
    const olderSignal = mocks.getCopilotInfo.mock.calls[0]?.[1] as AbortSignal
    expect(olderSignal.aborted).toBe(false)
    await setInputValue(input, 'prts://2')
    // 新输入取消旧预览读取，迟到的旧响应不能覆盖新预览。
    expect(olderSignal.aborted).toBe(true)
    await click(buttonByText('预览')!)

    const previewResponse = (title: string, stage: string) => ({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title }, stage_name: stage }) },
      },
    })
    await act(async () => newerPreview.resolve(previewResponse('新预览', 'NEW-2')))
    await flush()
    expect(copilotDrawer()?.textContent).toContain('新预览')

    await act(async () => olderPreview.resolve(previewResponse('旧预览', 'OLD-1')))
    await flush()
    expect(copilotDrawer()?.textContent).toContain('新预览')
    expect(copilotDrawer()?.textContent).not.toContain('旧预览')
  })

  it('dismisses stale preview progress when the input changes and keeps the next preview notice', async () => {
    const stalePreview = deferred<ApiResponse>()
    const nextPreview = deferred<ApiResponse>()
    mocks.getCopilotInfo
      .mockReturnValueOnce(stalePreview.promise)
      .mockReturnValueOnce(nextPreview.promise)
    await renderComponent()
    await setRecognitionMode('single')
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!

    await setInputValue(input, 'prts://1')
    mocks.dismissNotice.mockClear()
    await click(buttonByText('预览')!)
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在获取作业信息...', 'combat-preview')
    expect(mocks.dismissNotice).not.toHaveBeenCalled()

    await setInputValue(input, 'prts://2')
    await flush()

    expect(mocks.dismissNotice).toHaveBeenCalledTimes(1)
    expect(mocks.dismissNotice).toHaveBeenCalledWith('combat-preview')
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.anything(), undefined, {
      id: 'combat-preview',
    })

    await click(buttonByText('预览')!)
    expect(mocks.notifyProgress).toHaveBeenCalledTimes(2)
    expect(mocks.notifyProgress).toHaveBeenLastCalledWith('正在获取作业信息...', 'combat-preview')
    expect(mocks.dismissNotice).toHaveBeenCalledTimes(1)

    await act(async () => stalePreview.resolve({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title: '旧预览' }, stage_name: 'OLD-1' }) },
      },
    }))
    await flush()
    expect(mocks.notify).not.toHaveBeenCalledWith('已加载作业：旧预览', undefined, {
      id: 'combat-preview',
    })
    expect(mocks.dismissNotice).toHaveBeenCalledTimes(1)

    await act(async () => nextPreview.resolve({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title: '新预览' }, stage_name: 'NEW-2' }) },
      },
    }))
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith('已加载作业：新预览', undefined, {
      id: 'combat-preview',
    })
    expect(mocks.dismissNotice).toHaveBeenCalledTimes(1)
  })

  it('syncs a previewed set into the queue and submits its checked members as a set run', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
          { id: 103, stage: 'TEST-3', stageId: 'test_3', supportsRaid: true },
        ],
        entries: [{ itemIndex: 0, mode: 'normal', completed: true }],
      },
    })
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    const lists = container.querySelectorAll('[role="list"]')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.getAttribute('aria-label')).toBe('作业队列')
    expect(container.querySelectorAll('[data-copilot-set-item-index]')).toHaveLength(3)
    expect(container.querySelector('section[aria-label="作业集摘要"]')).toBeNull()
    expect(copilotDrawer()?.textContent).toContain('prts://s48990')
    expect(copilotDrawer()?.textContent).toContain('历史续跑进度')
    expect(buttonByAriaLabel('选择队列第 1 项 TEST-1')?.getAttribute('aria-pressed')).toBe('false')
    expect(buttonByAriaLabel('取消选择队列第 2 项 TEST-2')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('共 3 项')
    expect(container.textContent).toContain('已勾选 2 / 3 项')
    const storedQueue = JSON.parse(localStorage.getItem('la-pluma-copilot-queue-v1') || '{}')
    expect(storedQueue.entries).toHaveLength(3)
    expect(storedQueue.entries[0]).toMatchObject({ setId: '48990', setItemIndex: 0 })

    await click(buttonByAriaLabel('查看队列第 2 项详情 TEST-2')!)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(copilotDrawer()?.textContent).toContain('prts://102')
    expect(copilotDrawer()?.textContent).not.toContain('历史续跑进度')
    await click(buttonByAriaLabel('关闭详情')!)
    expect(copilotDrawer()).toBeNull()
    await click(buttonByText('预览')!)
    expect(copilotDrawer()?.textContent).toContain('历史续跑进度')

    await click(buttonByText('立即执行')!)

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith(
      '48990',
      expect.objectContaining({
        mode: 'continuous',
        selectedIndexes: [1, 2],
      }),
      expect.anything(),
    )
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('reports a preview failure without discarding the current preview', async () => {
    mocks.getCopilotSetPlan.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-ONLY', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()
    expect(container.textContent).toContain('TEST-ONLY')

    await selectDifficulty('raid')
    mocks.getCopilotSetPlan.mockRejectedValueOnce(new Error('plan unavailable'))
    mocks.getCopilotSet.mockRejectedValueOnce(new Error('set unavailable'))
    await click(buttonByText('预览')!)
    await flush()

    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在获取作业信息...', 'combat-preview')
    expect(mocks.notify).toHaveBeenCalledWith('网络错误: set unavailable', undefined, {
      id: 'combat-preview',
    })
    expect(container.textContent).toContain('TEST-ONLY')
  })

  it('replaces the loaded preview notice when it is added to the queue', async () => {
    mocks.getCopilotInfo.mockResolvedValueOnce({
      success: true,
      data: {
        status_code: 200,
        stage: 'TEST-1',
        stageId: 'test_1',
        data: { content: JSON.stringify({ stage_name: 'test_1', doc: { title: '队列预览作业' } }) },
      },
    })
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://1234')
    await click(buttonByText('预览')!)
    await flush()

    await click(buttonByText('加入队列')!)

    expect(mocks.notify).toHaveBeenCalledWith('已加入 1 个作业到队列', 'success', {
      id: 'combat-preview',
    })
    expect(mocks.notify).not.toHaveBeenCalledWith('已加入 1 个作业到队列', 'success')
  })

  it('reports restored set progress under the preview notice when the set preview is ready', async () => {
    mockSetPlan()
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')

    await click(buttonByText('立即执行')!)

    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在获取作业信息...', 'combat-preview')
    expect(mocks.notify).toHaveBeenCalledWith(
      '已恢复作业集进度，请确认待执行关卡后再次执行',
      undefined,
      { id: 'combat-preview' },
    )
  })

  it('does not report restored set progress when the set preview fails', async () => {
    await renderComponent()
    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    mocks.getCopilotSetPlan.mockRejectedValueOnce(new Error('plan unavailable'))
    mocks.getCopilotSet.mockRejectedValueOnce(new Error('set unavailable'))

    await click(buttonByText('立即执行')!)

    expect(mocks.notify.mock.calls
      .filter(([message]) => String(message).includes('已恢复作业集进度'))).toHaveLength(0)
    expect(mocks.notify).toHaveBeenCalledWith('网络错误: set unavailable', undefined, {
      id: 'combat-preview',
    })
  })

  it('replaces the queue preview notice when a searched job is added', async () => {
    await renderComponent()
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      copilots: [{ id: 1, uri: 'prts://1234', title: '队列预览作业' }],
    }))
    await submitDiscoverySearch('1-7')
    mocks.getCopilotInfo.mockResolvedValueOnce({
      success: true,
      data: {
        status_code: 200,
        stage: 'TEST-1',
        stageId: 'test_1',
        data: { content: JSON.stringify({ stage_name: 'test_1', doc: { title: '队列预览作业' } }) },
      },
    })

    await click(buttonByAriaLabel('加入队列: 队列预览作业')!)

    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在获取作业信息...', 'combat-queue-preview')
    expect(mocks.notify).toHaveBeenCalledWith('已加入 1 个作业到队列', 'success', {
      id: 'combat-queue-preview',
    })
    expect(mocks.notify).not.toHaveBeenCalledWith('已加入 1 个作业到队列', 'success')
    expect(mocks.dismissNotice).not.toHaveBeenCalledWith('combat-queue-preview')
  })

  it('replaces the queue preview notice when a searched job fails', async () => {
    await renderComponent()
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      copilots: [{ id: 1, uri: 'prts://1235', title: '失败预览作业' }],
    }))
    await submitDiscoverySearch('1-7')
    mocks.getCopilotInfo.mockRejectedValueOnce(new Error('queue unavailable'))

    await click(buttonByAriaLabel('加入队列: 失败预览作业')!)

    expect(mocks.notify).toHaveBeenCalledWith('网络错误: queue unavailable', 'error', {
      id: 'combat-queue-preview',
    })
    expect(mocks.notify).not.toHaveBeenCalledWith('网络错误: queue unavailable', 'error')
    expect(mocks.dismissNotice).not.toHaveBeenCalledWith('combat-queue-preview')
  })

  it('dismisses the queue preview notice when the add request is cancelled', async () => {
    await renderComponent()
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      copilots: [{ id: 1, uri: 'prts://s1236', title: '取消预览作业' }],
    }))
    await submitDiscoverySearch('1-7')
    const plan = deferred<ApiResponse>()
    mocks.getCopilotSetPlan.mockReturnValueOnce(plan.promise)
    mocks.notify.mockClear()

    await click(buttonByAriaLabel('加入队列: 取消预览作业')!)
    await renderActivityMode('hidden')
    await act(async () => plan.resolve(ok({ setId: '1236', name: '作业集', items: [], entries: [] })))
    await settleQueries()

    expect(mocks.dismissNotice).toHaveBeenCalledWith('combat-queue-preview')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('shows recommendations without changing the current job input', async () => {
    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await setInputValue(input, 'prts://1234')
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '推荐作业' }],
      recommended: { uri: 'prts://1' },
    }))
    await submitDiscoverySearch('1-7')

    const card = buttonByAriaLabel('查看作业 推荐作业')?.closest('article')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('推荐')
    expect(card?.textContent).not.toContain('已选中')
    expect(input.value).toBe('prts://1234')
    expect(mocks.getCopilotInfo).not.toHaveBeenCalled()
  })

  it('shows the server message for a failed search and keeps the last results', async () => {
    await renderComponent()
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '旧作业' }],
    }))
    await submitDiscoverySearch('1-7')
    expect(discoveryDialog()?.textContent).toContain('旧作业')

    mocks.searchCopilot.mockResolvedValueOnce(failed('AGENT_COPILOT_SEARCH_FAILED', '未找到关卡"1-7"的作业'))
    await click(discoverySearchButton()!)
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith('未找到关卡"1-7"的作业')
    expect(discoveryDialog()?.textContent).toContain('旧作业')
  })

  it('prefetches the hot list on mount and shows the cache as soon as discovery opens', async () => {
    mocks.searchCopilot.mockResolvedValue(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 7, uri: 'prts://7', title: '热度榜作业' }],
    }))
    await renderComponent()

    expect(mocks.searchCopilot).toHaveBeenCalledOnce()
    expect(mocks.searchCopilot).toHaveBeenCalledWith(
      DEFAULT_DISCOVERY_REQUEST,
      expect.any(AbortSignal),
    )

    await openDiscovery()

    expect(mocks.searchCopilot).toHaveBeenCalledTimes(2)
    expect(discoveryDialog()?.textContent).toContain('热度榜作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在加载作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('也可以直接搜索浏览热度榜')
  })

  it('prefetches with saved operator filters and keeps the default cache on reopen', async () => {
    localStorage.setItem('la-pluma-copilot-operator-filter-v1', JSON.stringify({
      included: ['阿米娅'],
      excluded: ['陈'],
      enabled: true,
      remember: true,
    }))
    mocks.searchCopilot.mockResolvedValue(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 3, uri: 'prts://3', title: '筛选作业' }],
    }))

    await renderComponent()

    expect(mocks.searchCopilot).toHaveBeenCalledOnce()
    expect(mocks.searchCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ includedOperators: ['阿米娅'], excludedOperators: ['陈'] }),
      expect.any(AbortSignal),
    )

    await openDiscovery()
    expect(discoveryDialog()?.textContent).toContain('筛选作业')
    expect(buttonByText('干员 2')).toBeDefined()
    expect(buttonByAriaLabel('停用干员筛选')).toBeDefined()

    await click(buttonByAriaLabel('关闭对话框')!)
    expect(discoveryDialog()).toBeNull()

    await openDiscovery()
    expect(discoveryDialog()?.textContent).toContain('筛选作业')
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      expect.objectContaining({ includedOperators: ['阿米娅'], excludedOperators: ['陈'] }),
      expect.any(AbortSignal),
    )
  })

  it('keeps a saved disabled operator filter out of the default request', async () => {
    localStorage.setItem('la-pluma-copilot-operator-filter-v1', JSON.stringify({
      included: ['阿米娅'],
      excluded: [],
      enabled: false,
      remember: true,
    }))
    await renderComponent()

    expect(mocks.searchCopilot).toHaveBeenCalledOnce()
    expect(mocks.searchCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ includedOperators: [], excludedOperators: [] }),
      expect.any(AbortSignal),
    )

    await openDiscovery()
    expect(buttonByText('干员 1')).toBeDefined()
    expect(buttonByAriaLabel('启用干员筛选')).toBeDefined()
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      expect.objectContaining({ includedOperators: [], excludedOperators: [] }),
      expect.any(AbortSignal),
    )
  })

  it('clears explicit results and filters after closing while keeping the default cache', async () => {
    mocks.searchCopilot.mockResolvedValue(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 2, uri: 'prts://2', title: '默认作业' }],
    }))
    await renderComponent()
    await openDiscovery()
    expect(discoveryDialog()?.textContent).toContain('默认作业')

    await click(buttonByAriaLabel('关卡筛选')!)
    await click(buttonByAriaLabel('选择关卡 1-7 暴君 第一章 黑暗时代·下')!)
    const orderTrigger = document.querySelector<HTMLElement>('[aria-label="排序"]')
  expect(orderTrigger, '排序下拉').not.toBeNull()
  await chooseComboboxOption(orderTrigger!, '访问量')
    await setInputValue(discoverySearchInput()!, '1-7')
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '旧搜索作业' }],
    }))
    await click(discoverySearchButton()!)
    expect(discoveryDialog()?.textContent).toContain('旧搜索作业')
    expect(discoverySearchInput()?.value).toBe('1-7')
    expect(buttonByAriaLabel('关卡筛选：1-7')).toBeDefined()
    expect(document.querySelector('[aria-label="排序"]')?.textContent).toContain('访问量')

    await click(buttonByAriaLabel('关闭对话框')!)
    expect(discoveryDialog()).toBeNull()

    await openDiscovery()

    expect(discoverySearchInput()?.value).toBe('')
    expect(buttonByAriaLabel('关卡筛选')).toBeDefined()
    expect(buttonByAriaLabel('关卡筛选：1-7')).toBeUndefined()
    expect(document.querySelector('[aria-label="排序"]')?.textContent).toContain('热度')
    expect(discoveryDialog()?.textContent).toContain('默认作业')
    expect(discoveryDialog()?.textContent).not.toContain('旧搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在加载作业')
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      DEFAULT_DISCOVERY_REQUEST,
      expect.any(AbortSignal),
    )
  })

  it('keeps cached results visible while the background refresh is still running', async () => {
    mocks.searchCopilot.mockResolvedValue(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 2, uri: 'prts://2', title: '缓存作业' }],
    }))
    await renderComponent()
    const refresh = deferred<ApiResponse>()
    mocks.searchCopilot.mockReturnValueOnce(refresh.promise)

    await openDiscovery()

    expect(discoveryDialog()?.textContent).toContain('缓存作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在加载作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在请求')

    await act(async () => refresh.resolve(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 5, uri: 'prts://5', title: '刷新作业' }],
    })))
    await settleQueries()
    expect(discoveryDialog()?.textContent).toContain('刷新作业')
  })

  it('keeps an explicit search result when the background refresh finishes later', async () => {
    mocks.searchCopilot.mockResolvedValue(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 2, uri: 'prts://2', title: '默认作业' }],
    }))
    await renderComponent()
    const background = deferred<ApiResponse>()
    mocks.searchCopilot.mockReturnValueOnce(background.promise)
    await openDiscovery()
    expect(discoveryDialog()?.textContent).toContain('默认作业')

    const explicit = deferred<ApiResponse>()
    mocks.searchCopilot.mockReturnValueOnce(explicit.promise)
    await submitDiscoverySearch('1-7')
    expect(discoveryDialog()?.textContent).toContain('正在搜索作业')

    await act(async () => background.resolve(ok({
      stage: '',
      copilots: [{ id: 9, uri: 'prts://9', title: '后台刷新作业' }],
    })))
    await flush()
    expect(discoveryDialog()?.textContent).toContain('正在搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('后台刷新作业')

    await act(async () => explicit.resolve(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '显式作业' }],
    })))
    await flush()
    expect(discoveryDialog()?.textContent).toContain('显式作业')
    expect(discoveryDialog()?.textContent).not.toContain('后台刷新作业')
  })

  it('shows the first-load placeholder only while the default request has no cache', async () => {
    const loading = deferred<ApiResponse>()
    mocks.searchCopilot.mockReturnValue(loading.promise)
    await renderComponent()

    await openDiscovery()

    expect(discoveryDialog()?.textContent).toContain('正在加载作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在搜索作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在请求')

    await act(async () => loading.resolve(ok({
      stage: '',
      total: 1,
      copilots: [{ id: 2, uri: 'prts://2', title: '首次作业' }],
    })))
    await settleQueries()
    expect(discoveryDialog()?.textContent).toContain('首次作业')
    expect(discoveryDialog()?.textContent).not.toContain('正在加载作业')
  })

  it('filters by the stage chosen from the catalogue', async () => {
    await renderComponent()
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 9, uri: 'prts://9', title: '1-7 作业' }],
    }))
    await click(buttonByAriaLabel('关卡筛选')!)
    await click(buttonByAriaLabel('选择关卡 1-7 暴君 第一章 黑暗时代·下')!)

    expect(mocks.searchCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'main_01-07', page: 1, limit: 30 }),
      expect.any(AbortSignal),
    )
    expect(discoveryDialog()?.textContent).toContain('1-7 作业')
    expect(buttonByAriaLabel('关卡筛选：1-7')).toBeDefined()
  })

  it('keeps an active run untouched by searches', async () => {
    useIdentity({ runId: 'run-combat', operationId: 'run_task', scope: 'combat' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-combat')] })))
    api.fetchRun.mockResolvedValue(ok(activeRun('run-combat')))
    startController()
    await flush()
    await renderComponent()
    expect(buttonByText('终止执行')).toBeDefined()

    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '搜索结果' }],
    }))
    await submitDiscoverySearch('1-7')

    expect(discoveryDialog()?.textContent).toContain('搜索结果')
    expect(buttonByText('终止执行')).toBeDefined()
    expect(api.stopRun).not.toHaveBeenCalled()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()
    expect(mocks.executePredefinedTaskArgs).not.toHaveBeenCalled()
  })

  it('keeps the set list out of discovery input and recognition-mode renders', async () => {
    await renderComponent()
    await previewSet()
    expect(renderCounts.setPanel).toBeGreaterThan(0)

    await openDiscovery()
    await settleQueries()
    renderCounts.setPanel = 0
    await setInputValue(discoverySearchInput()!, '1-7')
    expect(renderCounts.setPanel).toBe(0)

    await click(buttonByAriaLabel('关闭对话框')!)
    await flush()
    renderCounts.setPanel = 0
    await setRecognitionMode('single')
    expect(renderCounts.setPanel).toBe(0)

    await click(buttonByAriaLabel('取消选择队列第 1 项 TEST-1')!)
    expect(renderCounts.setPanel).toBeGreaterThan(0)
  })

  it('resets the discovery keyword on reopen and retains the recognition mode across combat mode switches', async () => {
    await renderComponent()
    await openDiscovery()
    await setInputValue(discoverySearchInput()!, '1-7')
    await click(buttonByAriaLabel('关闭对话框')!)
    await setRecognitionMode('single')

    const modeButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    ).find(button => button.textContent?.includes(label))!

    await click(modeButton('悖论模拟'))
    expect(discoveryDialog()).toBeNull()

    await click(modeButton('普通作业'))
    await openDiscovery()
    expect(discoverySearchInput()?.value).toBe('')
    expect(container.querySelector<HTMLSelectElement>('select[name="maa-copilot-preview-mode"]')?.value)
      .toBe('single')
    await click(buttonByAriaLabel('关闭对话框')!)

    // prts.plus 链接在自动模式下会同时探测作业集，单作业模式只读作业详情。
    mocks.getCopilotInfo.mockResolvedValueOnce({
      success: true,
      data: { status_code: 200, data: { content: JSON.stringify({ doc: { title: '单作业预览' } }) } },
    })
    await setInputValue(
      container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!,
      'https://prts.plus/a?id=1234',
    )
    await click(buttonByText('预览')!)
    await flush()

    expect(mocks.getCopilotInfo).toHaveBeenCalledOnce()
    expect(mocks.getCopilotSetPlan).not.toHaveBeenCalled()
    expect(mocks.getCopilotSet).not.toHaveBeenCalled()
  })

  it('previews a clicked search result without touching the job input', async () => {
    mocks.getCopilotInfo.mockResolvedValueOnce({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title: '搜索预览' }, stage_name: '1-7' }) },
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await setInputValue(input, 'prts://1234')
    await openDiscovery()
    mocks.searchCopilot.mockResolvedValueOnce(ok({
      stage: '1-7',
      copilots: [{ id: 1, uri: 'prts://1', title: '搜索结果作业' }],
    }))
    await submitDiscoverySearch('1-7')
    expect(discoveryDialog()?.textContent).toContain('搜索结果作业')

    const resultButton = buttonByAriaLabel('查看作业 搜索结果作业')!
    await click(resultButton)

    expect(input.value).toBe('prts://1234')
    expect(mocks.getCopilotInfo).toHaveBeenCalledWith('1', expect.any(AbortSignal))
    expect(copilotDrawer()?.textContent).toContain('搜索预览')
    expect(resultButton.closest('article')?.textContent).not.toContain('已选中')
  })

  it('renders per-item set results and the waiting progress', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
          { id: 103, stage: 'TEST-3', stageId: 'test_3', supportsRaid: true },
        ],
        entries: [],
      },
    })
    useIdentity({ runId: 'run-set-items', operationId: 'run_copilot_set', scope: 'combat' })
    const waiting = setRun('run-set-items', 'waiting', {
      progress: setProgress(
        [planEntry(0, 'success'), planEntry(1, 'failed', { error: '作战失败' }), planEntry(2, 'pending')],
        {
          mode: 'manual',
          phase: 'waiting_for_next',
          totalSteps: 3,
          nextEntry: planEntry(2, 'pending'),
        },
      ),
    })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waiting] })))
    api.fetchRun.mockResolvedValue(ok(waiting))
    startController()
    await flush()
    await renderComponent()

    await setInputValue(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    const setRowText = (index: number) => container
      .querySelector<HTMLElement>(`[data-copilot-set-item-index="${index}"]`)?.textContent ?? ''
    expect(setRowText(0)).toContain('已完成')
    expect(setRowText(1)).toContain('待重试')
    expect(setRowText(2)).toContain('待执行')
    expect(copilotDrawer()?.textContent).toContain('待 2')
    expect(copilotDrawer()?.textContent).toContain('本次成功 1')
    expect(copilotDrawer()?.textContent).toContain('失败 1')
    expect(copilotDrawer()?.textContent).toContain('本次已执行 2 个')
    expect(copilotDrawer()?.textContent).toContain('第 3 / 3 关')
    expect(buttonByText('开始下一关')).toBeDefined()
  })

  it('executes the selected special task with its own command', async () => {
    await renderComponent()
    const modeButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="toolbar"][aria-label="作业类型"] button'),
    ).find(button => button.textContent?.includes(label))!

    await click(modeButton('保全派驻'))
    const sssInput = container.querySelector<HTMLTextAreaElement>('textarea[name="maa-ssscopilot-uris"]')!
    await setInputValue(sssInput, 'prts://1234')
    await click(buttonByText('立即执行')!)

    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledWith(
      'ssscopilot',
      expect.arrayContaining(['prts://1234']),
      null,
      null,
      '保全派驻',
      'combat',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )

    await click(modeButton('悖论模拟'))
    const paradoxInput = container.querySelector<HTMLTextAreaElement>('textarea[name="maa-paradoxcopilot-uris"]')!
    await setInputValue(paradoxInput, 'prts://5678')
    await click(buttonByText('立即执行')!)

    expect(mocks.executePredefinedTaskArgs).toHaveBeenLastCalledWith(
      'paradoxcopilot',
      expect.arrayContaining(['prts://5678']),
      null,
      null,
      '悖论模拟',
      'combat',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('associates every visible form control with a label', async () => {
    await renderComponent()

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>('input:not([aria-hidden="true"]), [role="combobox"], [role="checkbox"], [role="switch"]'),
    )
    expect(controls.length).toBeGreaterThan(0)
    controls.forEach(control => {
      if (control.matches('[role="checkbox"], [role="switch"]')) {
        const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
          .find(candidate => candidate.contains(control))
        expect(label ?? control.getAttribute('aria-label')).toBeTruthy()
        return
      }
      expect(control.id).not.toBe('')
      const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
        .find(candidate => candidate.htmlFor === control.id)
      expect(label ?? control.getAttribute('aria-label')).toBeTruthy()
    })
  })

  it('keeps the reset dialog open when resetting progress fails', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })
    mocks.resetCopilotSetProgress.mockResolvedValue({ success: false, message: '进度存储不可用' })

    await renderComponent()
    await setRecognitionMode('set')

    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(input).not.toBeNull()
    await setInputValue(input!, 'prts://s48990')
    await click(buttonByText('预览')!)
    await flush()

    await click(buttonByText('重置进度')!)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await click(buttonByText('确认重置')!)
    await flush()

    expect(mocks.resetCopilotSetProgress).toHaveBeenCalledWith('48990')
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(buttonByText('确认重置')?.disabled).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('重置失败: 进度存储不可用', 'error')
  })
})
