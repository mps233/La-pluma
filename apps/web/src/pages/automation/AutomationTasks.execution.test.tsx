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
import AutomationTasks from './AutomationTasks'
import type { TaskFlowItem } from '@/features/automation/types'
import type { TaskExecutionState } from '@/features/automation/utils/automationTaskProgress'

const mocks = vi.hoisted(() => ({
  controller: { current: null as unknown as ExecutionController },
  getActivity: vi.fn(),
  executeScheduleNow: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
  testConnection: vi.fn(),
  generateTrainingPlan: vi.fn(),
  getAllOperators: vi.fn(),
  getOperBoxData: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, layout: _layout, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/features/automation/api', () => ({
  getActivity: mocks.getActivity,
  executeScheduleNow: mocks.executeScheduleNow,
  setupSchedule: mocks.setupSchedule,
  stopSchedule: mocks.stopSchedule,
}))

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
  getOperBoxData: mocks.getOperBoxData,
}))

vi.mock('@/features/task-execution', async () => {
  const actual = await vi.importActual<typeof import('@/features/task-execution')>('@/features/task-execution')
  return {
    ...actual,
    get executionController() {
      return mocks.controller.current
    },
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

vi.mock('@/features/settings', () => ({ testConnection: mocks.testConnection }))
vi.mock('@/features/training', () => ({
  generateTrainingPlan: mocks.generateTrainingPlan,
  OperatorSelectModal: () => null,
}))
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
}))
type DeviceMonitorLayoutMockProps = {
  variant?: 'standard' | 'workbench' | 'mode'
  children?: ReactNode
  sequence?: ReactNode
  editor?: ReactNode
  support?: ReactNode
  mode?: ReactNode
  content?: ReactNode
}

vi.mock('@/features/device-mirror', () => ({
  DeviceMonitorPanel: () => null,
  DeviceMonitorLayout: ({ variant, children, sequence, editor, support, mode, content }: DeviceMonitorLayoutMockProps) => {
    if (variant === 'workbench') return <>{sequence}{editor}<div>{support}</div></>
    if (variant === 'mode') return <>{mode}{content}</>
    return <>{children}</>
  },
}))
vi.mock('@/features/automation/components/NotificationSettings', () => ({ default: () => null }))

const CONTROLLER_INTERVALS = { active: 1_000, idle: 5_000, disconnected: 2_000 }
const LEGACY_KEY = 'maa-task-flow-execution'

const flow: TaskFlowItem[] = [
  ['startup', '启动游戏'], ['fight', '理智作战'], ['recruit', '自动公招'],
].map(([command, name]) => ({
  id: `${command}-1`,
  commandId: command as TaskFlowItem['commandId'],
  name: name!,
  icon: null,
  description: `${name!}说明`,
  defaultParams: {},
  paramFields: [],
  params: {},
  enabled: true,
}))

const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data })
const failed = (code: string, message: string): ApiResponse => ({
  success: false,
  error: message,
  message,
  errorInfo: { code, message },
})

function dailyRun(
  runId: string,
  state: AgentRun['state'],
  overrides: Partial<AgentRun> = {},
): AgentRun {
  const terminal = state === 'succeeded' || state === 'failed' || state === 'stopped' || state === 'interrupted'
  return {
    runId,
    operationId: 'run_daily_flow',
    state,
    acceptedAt: '2026-10-25T12:00:00.000Z',
    startedAt: state === 'accepted' ? null : '2026-10-25T12:00:01.000Z',
    finishedAt: terminal ? '2026-10-25T12:01:00.000Z' : null,
    links: {
      self: `/api/agent/runs/${runId}`,
      stop: `/api/agent/actions/stop?runId=${runId}`,
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const activeRuns = overrides.activeRuns ?? []
  const run = overrides.run ?? activeRuns[0] ?? null
  return {
    isRunning: activeRuns.length > 0,
    run,
    activeRuns,
    lastRun: overrides.lastRun ?? null,
    schedule: overrides.schedule ?? {},
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

function taskResults(statuses: TaskExecutionState[]): RunTaskResult[] {
  return flow.map((task, index) => ({
    taskId: task.id,
    task: task.name,
    status: statuses[index] ?? 'pending',
  }))
}

function summary(statuses: TaskExecutionState[], overrides: Record<string, unknown> = {}) {
  const count = (status: TaskExecutionState) => statuses.filter(value => value === status).length
  return {
    successCount: count('success'),
    failedCount: count('failed'),
    skippedCount: count('skipped'),
    durationMs: 60_000,
    taskResults: taskResults(statuses),
    summaries: [],
    reports: [],
    actions: [],
    errors: statuses.includes('failed')
      ? [{ task: '理智作战', error: '关卡不可用' }]
      : [],
    warnings: [],
    ...overrides,
  }
}

function activeSnapshot({
  runId = 'run-1',
  state = 'running',
  progress = { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
  statuses = ['running', 'pending', 'pending'] as TaskExecutionState[],
  scheduleRunId = runId,
  scheduleOverrides = {},
}: {
  runId?: string
  state?: AgentRun['state']
  progress?: RunProgress
  statuses?: TaskExecutionState[]
  scheduleRunId?: string | null
  scheduleOverrides?: Record<string, unknown>
} = {}): RunSnapshot {
  const run = dailyRun(runId, state, { progress })
  return snapshot({
    activeRuns: [run],
    schedule: {
      isRunning: true,
      runId: scheduleRunId,
      currentStep: progress.currentStep ?? null,
      totalSteps: 3,
      currentTaskId: flow[progress.currentStep ?? 0]?.id ?? null,
      currentTask: progress.currentTask ?? null,
      message: progress.message ?? undefined,
      shouldStop: state === 'stopping',
      taskResults: taskResults(statuses),
      ...scheduleOverrides,
    },
  })
}

function terminalSnapshot(
  state: 'succeeded' | 'failed' | 'stopped' | 'interrupted',
  result: Record<string, unknown> | null,
  error?: AgentRun['error'],
): RunSnapshot {
  return snapshot({ lastRun: dailyRun('run-1', state, {
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
    finishedAt: '2026-10-25T12:01:00.000Z',
  }) })
}

interface TestIdentity {
  runId: string
  operationId: string | null
  scope?: string | null
}

function memoryStorage(initial: TestIdentity | null = null) {
  let value = initial
  return {
    read: () => value,
    write: (identity: TestIdentity | null) => {
      value = identity
    },
    current: () => value,
  }
}

function createApi() {
  return {
    fetchSnapshot: vi.fn<(signal?: AbortSignal) => Promise<ApiResponse<RunSnapshot>>>(),
    fetchRun: vi.fn<(runId: string, signal?: AbortSignal) => Promise<ApiResponse<AgentRun>>>(),
    stopRun: vi.fn<(runId: string) => Promise<ApiResponse<StopRunResult>>>(),
  }
}

let api: ReturnType<typeof createApi>
let storage: ReturnType<typeof memoryStorage>
let releases: Array<() => void>
let container: HTMLDivElement
let root: Root
let queryClient: ReturnType<typeof createQueryClient>

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const useIdentity = (identity: TestIdentity | null = null) => {
  storage = memoryStorage(identity)
  mocks.controller.current = new ExecutionController({
    api,
    storage,
    intervals: CONTROLLER_INTERVALS,
  })
  const release = mocks.controller.current.start()
  releases.push(release)
}

const renderPage = async () => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <AutomationTasks />
    </QueryClientProvider>,
  ))
  await flush()
}

const renderActivityMode = async (mode: 'visible' | 'hidden') => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <Activity mode={mode}><AutomationTasks /></Activity>
    </QueryClientProvider>,
  ))
  await flush()
}

const click = async (element: HTMLElement | null) => {
  expect(element).not.toBeNull()
  await act(async () => element?.click())
  await flush()
}

const isDisabled = (element: Element | null) => Boolean(element && (
  element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
))
const runButton = () => container.querySelector<HTMLButtonElement>(
  'button[data-status-key="ready"], button[data-status-key="running"]',
)
const stopButton = () => container.querySelector<HTMLButtonElement>(
  'button[data-status-key="stop-ready"], button[data-status-key="stopping"]',
)
const sequenceLabels = () => Array.from(container.querySelectorAll('[data-automation-sequence-state-label]'))
  .map(item => item.textContent)
const completedItems = () => container.querySelectorAll('[data-execution-state="completed"]')
const runningItems = () => container.querySelectorAll('[data-execution-state="running"]')

const refreshController = async (reason: 'poll' | 'reconnect' = 'poll') => {
  await act(async () => {
    await mocks.controller.current.refresh(reason)
  })
  await flush()
}

const legacyCheckpoint = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  isExecuting: true,
  tasks: flow.map(task => ({ id: task.id, commandId: task.commandId, name: task.name })),
  currentIndex: 1,
  startTime: Date.now() - 60_000,
  ...overrides,
})

beforeEach(() => {
  // 终态 Run 与旧断点使用同一时钟，避免固定 fixture 随真实日期超过 24h 保留期。
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T12:02:00.000Z'))
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  }))
  localStorage.clear()
  // 协调器是应用级单例：每个用例从空通道与空存储开始，避免跨用例沿用草稿/队列。
  userConfigCoordinator.dispose()
  // 活动读取走 Query：每个用例独立客户端，避免复用上一个用例的 mock 结果。
  queryClient = createQueryClient()
  mocks.getActivity.mockReset().mockResolvedValue({ success: false })
  mocks.loadUserConfig.mockReset().mockResolvedValue({ success: true, data: { taskFlow: flow } })
  mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
  mocks.setupSchedule.mockReset().mockResolvedValue({ success: true })
  mocks.stopSchedule.mockReset().mockResolvedValue({ success: true })
  mocks.testConnection.mockReset().mockResolvedValue({ success: true })
  mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: false })
  mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
  mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: null })
  mocks.notify.mockReset()
  mocks.notifyProgress.mockReset()
  mocks.dismissNotice.mockReset()
  mocks.executeScheduleNow.mockReset().mockResolvedValue(ok({
    accepted: true,
    runId: 'run-1',
    run: dailyRun('run-1', 'running'),
  }))

  api = createApi()
  api.fetchSnapshot.mockResolvedValue(ok(snapshot()))
  api.fetchRun.mockResolvedValue(failed('AGENT_RUN_NOT_FOUND', '未找到 Agent run'))
  api.stopRun.mockResolvedValue(ok({} as StopRunResult))
  releases = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  releases.forEach(release => release())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AutomationTasks execution', () => {
  it('restores and submits dynamic game tasks with an omitted profession and observes their Run terminal result', async () => {
    const gameFlow: TaskFlowItem[] = [
      { ...flow[0]!, id: 'operprogress-1', commandId: 'operprogress', name: '游戏内培养', taskType: 'OperProgress', params: { plans: [{ name: '阿米娅', skill_level: 7, skill_mastery: [0, 3, 0] }] } },
      { ...flow[0]!, id: 'switchtheme-1', commandId: 'switchtheme', name: '更换游戏主题', taskType: 'SwitchTheme', params: { themes: ['明日方舟', '新主题'] } },
    ]
    mocks.loadUserConfig.mockResolvedValue(ok({ taskFlow: gameFlow }))
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot()))
    useIdentity()
    await renderPage()
    await click(runButton())
    expect(mocks.executeScheduleNow).toHaveBeenCalledOnce()
    expect(mocks.executeScheduleNow.mock.calls[0]?.[1]).toEqual(gameFlow.map(({ icon: _icon, paramFields: _fields, defaultParams: _defaults, description: _description, ...task }) => task))
    expect(stopButton()).not.toBeNull()
    const result = summary(['success', 'skipped'], {
      actions: [
        { task: '游戏内培养', action: 'operprogress', status: 'success', message: '已启动专精训练' },
        { task: '更换游戏主题', action: 'switchtheme', status: 'skipped', message: '主题已设置' },
      ],
      taskResults: gameFlow.map((task, index) => ({ taskId: task.id, task: task.name, status: index === 0 ? 'success' : 'skipped' })),
    })
    api.fetchSnapshot.mockResolvedValue(ok(snapshot({ lastRun: dailyRun('run-1', 'succeeded', { result: { summary: result } }) })))
    await refreshController()
    expect(stopButton()).toBeNull()
    expect(container.textContent).toContain('游戏任务 · 跳过 1 项')
    await click(container.querySelector<HTMLButtonElement>('[aria-label="展开执行详情"]'))
    expect(container.textContent).toContain('已启动专精训练')
    expect(container.textContent).toContain('主题已设置')
  })

  it('submits one background daily flow with an idempotency key', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
      statuses: ['running', 'pending', 'pending'],
    })))
    useIdentity()
    await renderPage()

    await click(runButton())

    expect(mocks.executeScheduleNow).toHaveBeenCalledOnce()
    const [scheduleId, submittedFlow, options] = mocks.executeScheduleNow.mock.calls[0] as [
      string,
      TaskFlowItem[],
      { waitForCompletion: boolean; idempotencyKey: string },
    ]
    expect(scheduleId).toBe('manual')
    expect(submittedFlow.map(task => task.id)).toEqual(['startup-1', 'fight-1', 'recruit-1'])
    expect(submittedFlow[0]).not.toHaveProperty('icon')
    expect(submittedFlow[0]).not.toHaveProperty('paramFields')
    expect(options.waitForCompletion).toBe(false)
    expect(options.idempotencyKey).toMatch(/^run_daily_flow-/)
    expect(stopButton()).not.toBeNull()
    expect(stopButton()?.textContent?.trim()).toBe('终止')
    expect(stopButton()?.querySelector('svg')).toBeNull()

    expect(runButton()).toBeNull()
    expect(mocks.executeScheduleNow).toHaveBeenCalledOnce()
  })

  it('moves focus to the stop action after this page starts the flow', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(snapshot()))
    useIdentity()
    await renderPage()
    const submission = deferred<ApiResponse<Record<string, unknown>>>()
    mocks.executeScheduleNow.mockReturnValue(submission.promise)

    await click(runButton())

    expect(runButton()?.textContent).toContain('正在启动')
    document.body.tabIndex = -1
    document.body.focus()
    expect(document.activeElement).toBe(document.body)

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot()))
    await act(async () => submission.resolve(ok({
      accepted: true,
      runId: 'run-1',
      run: dailyRun('run-1', 'running'),
    })))
    await flush()

    expect(runButton()).toBeNull()
    expect(document.activeElement).toBe(stopButton())
    document.body.removeAttribute('tabindex')
  })

  it('does not take focus when an external run appears after a rejected local start', async () => {
    const invalidFlow: TaskFlowItem[] = [
      flow[0]!,
      {
        id: 'infrast-1',
        commandId: 'infrast',
        name: '基建换班',
        icon: null,
        description: '自动基建换班收菜',
        defaultParams: {},
        paramFields: [],
        params: { mode: '10000', filename: '' },
        enabled: true,
        taskType: 'Infrast',
      },
    ]
    mocks.loadUserConfig.mockResolvedValue(ok({ taskFlow: invalidFlow }))
    useIdentity()
    await renderPage()

    await click(runButton())

    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    document.body.tabIndex = -1
    document.body.focus()
    expect(document.activeElement).toBe(document.body)

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({ runId: 'run-ext' })))
    await act(async () => {
      mocks.controller.current.observeRun('run-ext', 'run_daily_flow', 'dashboard')
    })
    await flush()

    expect(stopButton()).not.toBeNull()
    expect(document.activeElement).toBe(document.body)
    document.body.removeAttribute('tabindex')
  })

  it('closes the add-task picker when a run starts', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
      statuses: ['running', 'pending', 'pending'],
    })))
    useIdentity()
    await renderPage()

    await click(container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]'))
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    await click(runButton())

    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.disabled).toBe(true)
  })

  it('locks flow editing while a submission is pending but keeps schedule editing available', async () => {
    useIdentity()
    await renderPage()
    const submission = deferred<ApiResponse<Record<string, unknown>>>()
    mocks.executeScheduleNow.mockReturnValue(submission.promise)

    await click(runButton())

    const submittingRunButton = runButton()
    expect(submittingRunButton?.textContent).toContain('正在启动')
    expect(submittingRunButton?.getAttribute('data-status-key')).toBe('running')
    expect(submittingRunButton?.getAttribute('aria-busy')).toBe('true')
    expect(submittingRunButton?.disabled).toBe(true)
    const dragHandles = [...container.querySelectorAll('[aria-label^="调整"]')]
    expect(dragHandles.length).toBeGreaterThan(0)
    expect(dragHandles.every(isDisabled)).toBe(true)
    expect(dragHandles[0]?.getAttribute('title')).toBe('执行或启动期间不能排序')
    expect([...container.querySelectorAll('[aria-controls="automation-task-editor"]')].every(isDisabled)).toBe(true)
    expect([...container.querySelectorAll('[role="switch"][aria-label$="启用状态"]')].every(isDisabled)).toBe(true)
    expect([...container.querySelectorAll('[aria-label^="删除"]')].every(isDisabled)).toBe(true)
    expect(isDisabled(container.querySelector('[aria-haspopup="menu"]'))).toBe(true)
    expect(isDisabled(container.querySelector('#automation-startup-1-accountName'))).toBe(true)
    expect(isDisabled(container.querySelector('[aria-label="启用定时执行"]'))).toBe(false)

    await act(async () => submission.resolve(ok({
      accepted: true,
      runId: 'run-1',
      run: dailyRun('run-1', 'running'),
    })))
    await flush()
  })

  it('hides flow delete actions while submitting or running and restores them when idle', async () => {
    const deleteButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label^="删除"]')]
    const enabledSwitches = () => [...container.querySelectorAll('[role="switch"][aria-label$="启用状态"]')]

    useIdentity()
    await renderPage()
    const submission = deferred<ApiResponse<Record<string, unknown>>>()
    mocks.executeScheduleNow.mockReturnValue(submission.promise)

    await click(runButton())

    expect(deleteButtons().length).toBeGreaterThan(0)
    expect(deleteButtons().every(isDisabled)).toBe(true)
    expect(deleteButtons().every(button => button.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(deleteButtons().every(button => button.classList.contains('is-execution-hidden'))).toBe(true)
    expect(enabledSwitches().length).toBeGreaterThan(0)
    expect(enabledSwitches().every(isDisabled)).toBe(true)
    expect(enabledSwitches().every(element => element.getAttribute('aria-hidden') === null)).toBe(true)

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot()))
    await act(async () => submission.resolve(ok({
      accepted: true,
      runId: 'run-1',
      run: dailyRun('run-1', 'running'),
    })))
    await flush()

    expect(stopButton()).not.toBeNull()
    expect(runningItems()).toHaveLength(1)
    expect(deleteButtons().length).toBeGreaterThan(0)
    expect(deleteButtons().every(isDisabled)).toBe(true)
    expect(deleteButtons().every(button => button.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(deleteButtons().every(button => button.classList.contains('is-execution-hidden'))).toBe(true)
    expect(enabledSwitches().length).toBeGreaterThan(0)
    expect(enabledSwitches().every(isDisabled)).toBe(true)
    expect(enabledSwitches().every(element => element.getAttribute('aria-hidden') === null)).toBe(true)

    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成',
      summary: summary(['success', 'success', 'success']),
    })))
    await refreshController()

    expect(stopButton()).toBeNull()
    expect(runButton()?.textContent).toContain('开始')
    expect(deleteButtons().length).toBeGreaterThan(0)
    expect(deleteButtons().every(button => button.getAttribute('aria-hidden') === null)).toBe(true)
    expect(deleteButtons().every(button => !button.classList.contains('is-execution-hidden'))).toBe(true)
    expect(deleteButtons().every(button => !isDisabled(button))).toBe(true)
  })

  it('keeps the deleted-task restore action from editing the flow during a run', async () => {
    useIdentity()
    await renderPage()

    await click(container.querySelector<HTMLButtonElement>('[aria-label="删除启动游戏"]'))
    const deletedNotice = mocks.notify.mock.calls.find(([message]) => (
      String(message).includes('已删除“启动游戏”')
    ))
    expect(deletedNotice).toBeDefined()
    const { action } = deletedNotice![2] as {
      action: { label: string; onClick: () => void }
    }

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot()))
    await click(runButton())
    expect(container.querySelectorAll('[aria-controls="automation-task-editor"]')).toHaveLength(2)

    await act(async () => action.onClick())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith(
      '执行或启动期间不能恢复已删除的任务',
      'warning',
      { id: 'automation-restore-blocked' },
    )
    expect(container.querySelectorAll('[aria-controls="automation-task-editor"]')).toHaveLength(2)
  })

  it('keeps the deleted-task restore action from editing the flow while a submission is pending', async () => {
    useIdentity()
    await renderPage()

    await click(container.querySelector<HTMLButtonElement>('[aria-label="删除启动游戏"]'))
    const deletedNotice = mocks.notify.mock.calls.find(([message]) => (
      String(message).includes('已删除“启动游戏”')
    ))
    expect(deletedNotice).toBeDefined()
    const { action } = deletedNotice![2] as {
      action: { label: string; onClick: () => void }
    }

    const submission = deferred<ApiResponse<Record<string, unknown>>>()
    mocks.executeScheduleNow.mockReturnValue(submission.promise)
    await click(runButton())
    expect(runButton()?.textContent).toContain('正在启动')

    await act(async () => action.onClick())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith(
      '执行或启动期间不能恢复已删除的任务',
      'warning',
      { id: 'automation-restore-blocked' },
    )
    expect(container.querySelectorAll('[aria-controls="automation-task-editor"]')).toHaveLength(2)

    await act(async () => submission.resolve(ok({
      accepted: true,
      runId: 'run-1',
      run: dailyRun('run-1', 'running'),
    })))
    await flush()
  })

  it('blocks a custom shift without a schedule file and selects it for editing', async () => {
    const infrastFlow: TaskFlowItem[] = [
      flow[0]!,
      {
        id: 'infrast-1',
        commandId: 'infrast',
        name: '基建换班',
        icon: null,
        description: '自动基建换班收菜',
        defaultParams: {},
        paramFields: [],
        params: { mode: '10000', filename: '' },
        enabled: true,
        taskType: 'Infrast',
      },
    ]
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: infrastFlow } })
    useIdentity()
    await renderPage()

    await click(runButton())

    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('自定义换班需要填写排班文件路径', 'error')
    expect(container.querySelector('#automation-task-editor')?.textContent).toContain('基建换班')
  })

  it('blocks an invalid drop target before starting the run', async () => {
    const invalidFlow = flow.map(task => (
      task.commandId === 'fight'
        ? { ...task, params: { ...task.params, drops: '30011' } }
        : task
    ))
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: invalidFlow } })
    useIdentity()
    await renderPage()

    await click(runButton())

    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(
      '掉落目标格式应为物品 ID=数量，多个目标用逗号分隔',
      'error',
    )
  })

  it('keeps the run alive through the step delay and completes only on the terminal run', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
      statuses: ['running', 'pending', 'pending'],
    })))
    useIdentity()
    await renderPage()
    await click(runButton())

    expect(runningItems()).toHaveLength(1)
    expect(completedItems()).toHaveLength(0)
    expect(runButton()).toBeNull()
    expect(stopButton()).not.toBeNull()

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 1, totalSteps: 3, currentTask: '理智作战', message: '正在执行: 理智作战' },
      statuses: ['success', 'running', 'pending'],
    })))
    await refreshController()
    expect(completedItems()).toHaveLength(1)
    expect(runningItems()).toHaveLength(1)
    expect(sequenceLabels()).toEqual(['已完成', '正在执行', '等待执行'])
    const completedRow = container.querySelector<HTMLElement>('[data-execution-state="completed"]')
    expect(completedRow?.querySelector('[role="img"][aria-label="已完成"]')).toBeNull()
    expect(isDisabled(completedRow?.querySelector('button[aria-label^="删除"]') ?? null)).toBe(true)

    // 第二项已完成、流程处于两项之间的延迟：Run 仍活动，不能提前标成完成。
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 1, totalSteps: 3, currentTask: '理智作战', message: '正在执行: 理智作战' },
      statuses: ['success', 'success', 'pending'],
    })))
    await refreshController()
    expect(completedItems()).toHaveLength(2)
    expect(runningItems()).toHaveLength(0)
    expect(sequenceLabels()).toEqual(['已完成', '已完成', '等待执行'])
    expect(stopButton()).not.toBeNull()
    expect(mocks.notifyProgress).toHaveBeenCalledWith('今日流程执行中', 'execution')

    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成',
      summary: summary(['success', 'success', 'success']),
    })))
    await refreshController()

    expect(completedItems()).toHaveLength(3)
    expect(runningItems()).toHaveLength(0)
    expect(stopButton()).toBeNull()
    expect(runButton()?.textContent).toContain('开始')
    expect(container.textContent).toContain('最近执行')
    expect(mocks.notify).toHaveBeenLastCalledWith('任务流程执行完成', 'success', { id: 'execution' })
  })

  it('ignores a schedule projection owned by another run and restores observation without resubmitting', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '正在执行: 启动游戏' },
      scheduleRunId: 'run-other',
      statuses: ['success', 'success', 'success'],
      scheduleOverrides: { currentStep: 2, currentTaskId: 'recruit-1' },
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'automation' })
    await renderPage()

    expect(stopButton()).not.toBeNull()
    expect(completedItems()).toHaveLength(0)
    expect(sequenceLabels()).toEqual(['正在执行', '等待执行', '等待执行'])

    await refreshController()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(stopButton()).not.toBeNull()
  })

  it('takes over the daily flow started from the dashboard entry and can stop it', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
      statuses: ['running', 'pending', 'pending'],
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'dashboard' })
    await renderPage()

    expect(runButton()).toBeNull()
    expect(stopButton()).not.toBeNull()
    expect(stopButton()?.textContent?.trim()).toBe('终止')
    expect(document.activeElement).not.toBe(stopButton())
    expect(sequenceLabels()).toEqual(['正在执行', '等待执行', '等待执行'])
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()

    api.stopRun.mockResolvedValue(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: dailyRun('run-1', 'stopping'),
    }))
    await click(stopButton())

    expect(api.stopRun).toHaveBeenCalledWith('run-1')
  })

  it('does not claim an active run that belongs to another operation', async () => {
    const foreignRun = dailyRun('run-1', 'running', { operationId: 'run_task' })
    api.fetchSnapshot.mockResolvedValue(ok(snapshot({
      activeRuns: [foreignRun],
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'dashboard' })
    await renderPage()

    expect(runButton()?.textContent).toContain('开始')
    expect(stopButton()).toBeNull()
  })

  it('stops the tracked run by id and waits for the terminal state', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '正在执行: 启动游戏' },
      statuses: ['running', 'pending', 'pending'],
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'automation' })
    await renderPage()

    api.stopRun.mockResolvedValue(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: dailyRun('run-1', 'stopping'),
    }))
    api.fetchRun.mockResolvedValue(ok(dailyRun('run-1', 'stopping')))
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      state: 'stopping',
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '正在终止任务流程' },
      statuses: ['stopped', 'pending', 'pending'],
    })))
    await click(stopButton())

    expect(api.stopRun).toHaveBeenCalledWith('run-1')
    expect(stopButton()?.textContent).toContain('正在终止')
    expect(api.stopRun).toHaveBeenCalledOnce()

    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('stopped', {
      message: '任务流程已被用户终止',
      summary: summary(['stopped', 'pending', 'pending']),
    })))
    await refreshController()

    expect(stopButton()).toBeNull()
    expect(mocks.notify).toHaveBeenLastCalledWith('任务流程已被用户终止', 'warning', { id: 'execution' })
    expect(sequenceLabels()).toEqual(['已终止', '未执行', '未执行'])
  })

  it('adopts a valid legacy checkpoint and never resubmits it', async () => {
    localStorage.setItem(LEGACY_KEY, legacyCheckpoint())
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 1, totalSteps: 3, currentTask: '理智作战', message: '正在执行: 理智作战' },
      statuses: ['success', 'running', 'pending'],
    })))
    useIdentity()
    await renderPage()
    await flush()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(storage.current()).toEqual({
      runId: 'run-1',
      operationId: 'run_daily_flow',
      scope: 'automation',
    })
    expect(stopButton()).not.toBeNull()
    expect(mocks.notify).toHaveBeenCalledWith('已恢复上次任务流程，继续观察运行进度', 'info')
  })

  it('adopts a terminal legacy checkpoint for display without announcing a new run', async () => {
    localStorage.setItem(LEGACY_KEY, legacyCheckpoint({
      startTime: Date.parse('2026-10-25T12:00:30.000Z'),
    }))
    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成',
      summary: summary(['success', 'success', 'success']),
    })))
    useIdentity()
    await renderPage()
    await flush()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(completedItems()).toHaveLength(3)
    expect(container.textContent).toContain('最近执行')
    expect(storage.current()).toBeNull()
  })

  it('clears malformed and expired checkpoints without starting a flow', async () => {
    localStorage.setItem(LEGACY_KEY, '{')
    useIdentity()
    await renderPage()
    await flush()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('上次任务流程断点无法识别，已清理，请重新开始', 'warning')

    await act(async () => root.unmount())
    root = createRoot(container)
    localStorage.setItem(LEGACY_KEY, legacyCheckpoint({ startTime: Date.now() - 25 * 60 * 60 * 1000 }))
    useIdentity()
    await renderPage()
    await flush()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('上次任务流程断点已过期，未重新提交，请重新开始', 'warning')
  })

  it('discards a legacy checkpoint when another execution owns the device', async () => {
    localStorage.setItem(LEGACY_KEY, legacyCheckpoint())
    api.fetchSnapshot.mockResolvedValue(ok(snapshot({
      activeRuns: [dailyRun('run-2', 'running', {
        operationId: 'run_task',
        progress: { currentStep: 0, totalSteps: 1, currentTask: '作业' },
      })],
    })))
    useIdentity()
    await renderPage()
    await flush()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
    expect(stopButton()).toBeNull()
    expect(mocks.notify).toHaveBeenCalledWith(
      '检测到其他执行或本页已有运行身份，已清理上次任务流程断点',
      'warning',
    )
  })

  it('shows failed, skipped and unexecuted terminal results without inventing successes', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成，1 项任务失败',
      summary: summary(['failed', 'skipped', 'pending']),
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'automation' })
    await renderPage()

    expect(sequenceLabels()).toEqual(['执行失败', '已跳过', '未执行'])
    expect(completedItems()).toHaveLength(0)
    expect(container.textContent).toContain('最近执行')
    expect(container.textContent).toContain('理智作战：关卡不可用')
  })

  it('keeps observing a finishing run while the page is hidden', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      progress: { currentStep: 2, totalSteps: 3, currentTask: '自动公招', message: '正在执行: 自动公招' },
      statuses: ['success', 'success', 'running'],
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'automation' })
    await renderActivityMode('visible')

    expect(completedItems()).toHaveLength(2)
    expect(runningItems()).toHaveLength(1)

    await renderActivityMode('hidden')
    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成',
      summary: summary(['success', 'success', 'success']),
    })))
    await refreshController()
    await renderActivityMode('visible')

    expect(completedItems()).toHaveLength(3)
    expect(runningItems()).toHaveLength(0)
    expect(api.stopRun).not.toHaveBeenCalled()
  })

  it('shows the server flow summary when the page does not own a run', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(snapshot({
      schedule: {
        isRunning: false,
        lastResult: {
          successCount: 6,
          failedCount: 0,
          skippedCount: 1,
          durationMs: 952_000,
        },
      },
    })))
    useIdentity()
    await renderPage()

    expect(container.textContent).toContain('最近执行')
    expect(container.textContent).toContain('用时 952 秒')
    expect(container.textContent).toContain('1 项任务已跳过')
    expect(container.textContent).not.toContain('成功 6')
    expect(mocks.executeScheduleNow).not.toHaveBeenCalled()
  })

  it('clears the previous results as soon as a new submission starts', async () => {
    api.fetchSnapshot.mockResolvedValue(ok(terminalSnapshot('succeeded', {
      message: '任务流程执行完成',
      summary: summary(['success', 'success', 'success']),
    })))
    useIdentity({ runId: 'run-1', operationId: 'run_daily_flow', scope: 'automation' })
    await renderPage()
    expect(completedItems()).toHaveLength(3)

    const submission = deferred<ApiResponse<Record<string, unknown>>>()
    mocks.executeScheduleNow.mockReturnValue(submission.promise)
    await click(runButton())

    expect(completedItems()).toHaveLength(0)
    expect(runButton()?.textContent).toContain('正在启动')

    api.fetchSnapshot.mockResolvedValue(ok(activeSnapshot({
      runId: 'run-2',
      progress: { currentStep: 0, totalSteps: 3, currentTask: '启动游戏', message: '今日流程执行中' },
      statuses: ['running', 'pending', 'pending'],
    })))
    await act(async () => submission.resolve(ok({
      accepted: true,
      runId: 'run-2',
      run: dailyRun('run-2', 'running'),
    })))
    await flush()

    expect(stopButton()).not.toBeNull()
    expect(mocks.executeScheduleNow).toHaveBeenCalledOnce()
  })
})
