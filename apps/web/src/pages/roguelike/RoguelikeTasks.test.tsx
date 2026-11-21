// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import {
  ExecutionController,
  type AgentRun,
  type RunSnapshot,
  type StopRunResult,
} from '@/features/task-execution'
import { userConfigCoordinator } from '@/features/user-config'
import RoguelikeTasks from './RoguelikeTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  controller: { current: null as unknown as ExecutionController },
  availability: { available: true, message: '' },
  executePredefinedTask: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  getRealtimeLogs: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
  getOperBoxData: vi.fn(),
  getAllOperators: vi.fn(),
}))

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

vi.mock('@/shared/api', () => ({
  API_BASE_URL: '/api',
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
  getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  unwrapApiResponse: (response: { data?: unknown }) => response.data,
}))

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getOperBoxData: mocks.getOperBoxData,
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

// 页面只依赖干员选择模态窗；按公开面契约挑出这一项，避免把整个养成页工作区
// 及其传输层拖进本用例。
vi.mock('@/features/training', async () => {
  const modal = await vi.importActual<typeof import('@/features/training/components/OperatorSelectModal')>(
    '@/features/training/components/OperatorSelectModal',
  )
  return { OperatorSelectModal: modal.default }
})

vi.mock('@/features/task-execution', async () => {
  const actual = await vi.importActual<typeof import('@/features/task-execution')>('@/features/task-execution')
  return {
    ...actual,
    get executionController() {
      return mocks.controller.current
    },
    executePredefinedTask: mocks.executePredefinedTask,
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

vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => ({
    isAvailable: mocks.availability.available,
    unavailableMessage: mocks.availability.message,
  }),
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

vi.mock('@/features/logs/api', () => ({
  getRealtimeLogs: mocks.getRealtimeLogs,
  clearRealtimeLogs: vi.fn(),
  getLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  cleanupLogs: vi.fn(),
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
  DeviceMonitorPanel: () => <div data-testid="screen-monitor" />,
  DeviceMonitorLayout: ({ variant, children, sequence, editor, support, mode, content }: DeviceMonitorLayoutMockProps) => {
    if (variant === 'workbench') {
      return <>{sequence}{editor}<div><div data-testid="screen-monitor" />{support}</div></>
    }
    if (variant === 'mode') return <>{mode}{content}<div data-testid="screen-monitor" /></>
    return <>{children}<div data-testid="screen-monitor" /></>
  },
}))

const CONTROLLER_INTERVALS = { active: 1_000, idle: 5_000, disconnected: 2_000 }

const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data })
const failed = (code: string, message: string): ApiResponse => ({
  success: false,
  error: message,
  message,
  errorInfo: { code, message },
})

function activeRun(runId: string, state: AgentRun['state'] = 'running'): AgentRun {
  return {
    runId,
    operationId: 'run_task',
    state,
    acceptedAt: '2026-10-25T00:00:00.000Z',
    links: {
      self: `/api/agent/runs/${runId}`,
      stop: `/api/agent/actions/stop?runId=${runId}`,
    },
  }
}

function waitingForCombatRun(runId: string): AgentRun {
  return {
    ...activeRun(runId),
    progress: {
      message: '等待战斗结束后终止',
      stopIntent: {
        mode: 'after-combat',
        requestedAt: '2026-10-25T00:00:00.000Z',
        deadline: '2026-10-25T00:10:00.000Z',
        combat: true,
      },
    },
  }
}

function progressSnapshot(
  command: 'roguelike' | 'reclamation' = 'roguelike',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    command,
    theme: command === 'roguelike' ? 'Phantom' : 'Tales',
    mode: 0,
    phase: 'exploring',
    currentRound: 1,
    roundStartedAt: '2026-10-25T00:00:10.000Z',
    targetRounds: 2,
    roundsStarted: 1,
    roundsEnded: 0,
    roundsSettled: 0,
    roundsPassed: 0,
    settlementSupported: true,
    currentAction: 'StartExplore',
    lastEventKind: 'round',
    lastEventName: null,
    lastEventAt: '2026-10-25T00:00:10.000Z',
    combatCount: 0,
    investment: null,
    recentRounds: [],
    blackflow: null,
    updatedAt: '2026-10-25T00:00:10.000Z',
    degraded: false,
    observed: true,
    ...overrides,
  }
}

function blackflowProgress(): Record<string, unknown> {
  const observedAt = new Date(Date.now() - 10_000).toISOString()
  return {
    floor: 3,
    floorAt: new Date(Date.now() - 15_000).toISOString(),
    currentNode: { id: '281475010265088', name: '不期而遇', type: 'incident' },
    currentNodeAt: observedAt,
    actionPoints: { before: 7, after: 6, at: observedAt },
    lastRoute: null,
    lastNodeResolution: null,
    milestones: [],
    strategy: null,
    updatedAt: observedAt,
  }
}

function runWithProgress(
  runId: string,
  command: 'roguelike' | 'reclamation' = 'roguelike',
): AgentRun {
  return {
    ...activeRun(runId),
    progress: { roguelike: progressSnapshot(command) },
  }
}

function roguelikeSummary(command: 'roguelike' | 'reclamation' = 'roguelike'): Record<string, unknown> {
  return {
    command,
    theme: command === 'roguelike' ? 'Phantom' : 'Tales',
    status: 'success',
    observed: true,
    message: command === 'roguelike' ? '肉鸽结算：第 5 层 · 得分 1200' : '生息演算执行完成',
    settlement: null,
    investment: null,
    events: [],
    coppers: [],
    milestones: [],
    warnings: [],
    strategy: null,
    combats: 0,
    taskChain: { started: true, completed: true, failed: false, stopped: false },
  }
}

function terminalRunWithSummary(
  runId: string,
  command: 'roguelike' | 'reclamation' = 'roguelike',
): AgentRun {
  return {
    ...activeRun(runId, 'succeeded'),
    result: {
      summary: {
        ...roguelikeSummary(command),
        progress: progressSnapshot(command, {
          phase: 'ended',
          currentRound: null,
          roundsEnded: 2,
          roundsPassed: 1,
          roundsSettled: 1,
        }),
      },
    },
  }
}

function terminalRunWithBlackflow(runId: string): AgentRun {
  return {
    ...activeRun(runId, 'succeeded'),
    result: {
      summary: {
        ...roguelikeSummary('roguelike'),
        progress: progressSnapshot('roguelike', {
          phase: 'ended',
          currentRound: null,
          roundsEnded: 2,
          roundsPassed: 1,
          roundsSettled: 1,
          blackflow: blackflowProgress(),
        }),
      },
    },
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

interface TestExecutionIdentity {
  runId: string
  operationId: string | null
  scope?: string | null
}

interface TestIdentityStorage {
  read(): TestExecutionIdentity | null
  write(identity: TestExecutionIdentity | null): void
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
  const storage: TestIdentityStorage & { current: () => TestExecutionIdentity | null } = {
    read: () => value,
    write: (identity) => {
      value = identity
    },
    current: () => value,
  }
  return storage
}

let api: ReturnType<typeof createApi>
let controller: ExecutionController
let releases: Array<() => void>
let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function TestApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <RoguelikeTasks />
    </QueryClientProvider>
  )
}

const resetGameDataMocks = () => {
  mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: { data: [] } })
  mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
}

const resetQueryClient = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  })
}

const flushAsync = async () => {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const waitForConfigCommit = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 350))
  })
  await flush()
}

const buttonByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === text) as HTMLButtonElement | undefined

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

const focus = async (element: HTMLElement) => {
  await act(async () => element.focus())
  await flush()
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

const renderPage = async () => {
  await act(async () => root.render(<TestApp />))
  await flush()
}

const setTheme = async (value: string) => {
  const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(themeInput, value)
    themeInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const setControlValue = async (
  selector: string,
  value: string,
  eventName: 'input' | 'change' = 'input',
) => {
  const control = container.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(control, value)
    control.dispatchEvent(new Event(eventName, { bubbles: true }))
  })
  await flush()
}

const controlForName = (name: string) => {
  const field = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (!field) throw new Error(`missing control: ${name}`)
  const control = field.previousElementSibling
  if (!(control instanceof HTMLElement)) throw new Error(`missing control element: ${name}`)
  return control
}

const pressTrigger = async (trigger: HTMLElement) => {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    trigger.click()
  })
}

const chooseSelectOption = async (name: string, optionLabel: string) => {
  const trigger = controlForName(name)
  await pressTrigger(trigger)
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  const options = popup ? [...popup.querySelectorAll('[role="option"]')] : []
  const targetIndex = options.findIndex(node => node.textContent?.trim() === optionLabel)
  expect(targetIndex, `option ${optionLabel} for ${name}`).toBeGreaterThanOrEqual(0)

  const highlightedOf = () => popup?.querySelector('[role="option"][data-highlighted]') as HTMLElement | null
  const pressKey = async (key: string) => {
    await act(async () => {
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }

  let highlighted = highlightedOf()
  if (!highlighted) {
    await pressKey(targetIndex === 0 ? 'ArrowUp' : 'ArrowDown')
    highlighted = highlightedOf()
  }
  expect(highlighted, `highlighted option for ${name}`).toBeTruthy()
  const startIndex = options.indexOf(highlighted!)
  const key = targetIndex >= startIndex ? 'ArrowDown' : 'ArrowUp'
  for (let step = 0; step < Math.abs(targetIndex - startIndex); step += 1) {
    await pressKey(key)
  }
  const finalHighlighted = highlightedOf()
  expect(finalHighlighted?.textContent?.trim(), `highlighted option for ${name}`).toBe(optionLabel)
  await act(async () => (finalHighlighted as HTMLElement).click())
  await flush()
}

const selectOptionLabels = async (name: string) => {
  const trigger = controlForName(name)
  await pressTrigger(trigger)
  const popupId = trigger.getAttribute('aria-controls')
  const labels = popupId
    ? [...(document.getElementById(popupId)?.querySelectorAll('[role="option"]') ?? [])].map(node => node.textContent?.trim())
    : []
  await act(async () => {
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await flush()
  return labels
}

const selectValueFor = (name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value

const toggleSwitchByName = async (name: string) => {
  await act(async () => controlForName(name).click())
  await flush()
}

const setReclamationCraftValues = async (tools = '荧光棒', batches = '16') => {
  await setControlValue('input[name="maa-reclamation-toolsToCraft"]', tools)
  await setControlValue('input[name="maa-reclamation-numBatches"]', batches)
}

const findModeButton = (name: string) => Array.from(
  container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
).find(button => button.textContent?.includes(name))

const findConfigSaveErrorNotice = () => [...mocks.notify.mock.calls].reverse().find(
  ([, type, options]) => type === 'error' && options?.id === 'roguelike-config-save',
)

const fieldError = (id: string) => document.getElementById(`${id}-error`)

const tooltipText = () => {
  const tooltip = document.querySelector('[role="tooltip"]')
  return tooltip ? tooltip.textContent : null
}

describe('RoguelikeTasks execution', () => {
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
    mocks.availability.available = true
    mocks.availability.message = ''
    mocks.executePredefinedTask.mockReset()
    mocks.loadUserConfig.mockReset().mockResolvedValue({
      success: true,
      data: { taskInputs: {}, advancedParams: {} },
    })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.getRealtimeLogs.mockReset()
    mocks.notify.mockReset()
    mocks.notifyProgress.mockReset()
    mocks.dismissNotice.mockReset()
    resetGameDataMocks()
    resetQueryClient()

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
    queryClient.clear()
    container.remove()
    for (const release of releases) release()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps execution controls without a separate log observer or entry', async () => {
    useIdentity({ runId: 'run-rl-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-rl-1')] })))
    startController()
    await flush()
    await renderPage()

    expect(buttonByText('终止')).toBeDefined()
    expect(buttonByText('终止')?.querySelector('svg')).toBeNull()
    expect(buttonByText('等待战斗结束')).toBeDefined()
    expect(buttonByText('终止执行')).toBeUndefined()
    expect(container.querySelector('[role="log"]')).toBeNull()
    expect(container.textContent).not.toContain('查看本次日志')
    expect(mocks.getRealtimeLogs).not.toHaveBeenCalled()
  })

  it('submits one idempotent run with the original command semantics', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executePredefinedTask.mockReturnValueOnce(submission.promise)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1', 'accepted')] })))
    useIdentity(null)
    startController()
    await flush()
    await renderPage()
    await setTheme('Phantom')

    expect(buttonByText('开始')?.querySelector('svg')).toBeNull()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledOnce()
    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Phantom --roles 稳扎稳打',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
    expect(buttonByText('正在启动')?.disabled).toBe(true)
    expect(findModeButton('生息演算')?.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-startCount"]')?.disabled).toBe(true)
    expect((controlForName('maa-roguelike-mode') as HTMLButtonElement).disabled).toBe(true)
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).every(button => button.disabled))
      .toBe(true)
    expect(container.querySelector('[role="switch"][aria-label="使用助战"]')?.getAttribute('aria-disabled'))
      .toBe('true')

    // 提交在途时重复点击（含直接派发）不会产生第二个请求。
    await click(buttonByText('正在启动')!)

    await act(async () => submission.resolve(ok({ runId: 'run-1', run: activeRun('run-1', 'accepted') })))
    await flush()

    expect(mocks.executePredefinedTask).toHaveBeenCalledOnce()
    expect(buttonByText('终止')).toBeDefined()
  })

  it('replaces the execution progress when a submitted run finishes while hidden', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executePredefinedTask.mockReturnValueOnce(submission.promise)
    useIdentity(null)
    startController()
    await flush()
    const renderActivity = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <TestApp />
          </Activity>,
        )
      })
      await flush()
    }
    await renderActivity('visible')
    await setTheme('Phantom')

    await click(buttonByText('开始')!)
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在执行命令...', 'execution')

    await renderActivity('hidden')
    const running = activeRun('run-rl-hidden', 'running')
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [running] })))
    api.fetchRun.mockResolvedValue(ok(running))
    await act(async () => submission.resolve(ok({
      runId: 'run-rl-hidden',
      run: running,
    })))
    await flush()

    const terminal = activeRun('run-rl-hidden', 'succeeded')
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminal })))
    api.fetchRun.mockResolvedValue(ok(terminal))
    await refreshController()
    await renderActivity('visible')

    expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('执行成功'), 'success', { id: 'execution' })
  })

  it('builds the command from the active mode and advanced fields', async () => {
    await renderPage()
    await setTheme('Phantom')
    await chooseSelectOption('maa-roguelike-mode', '刷源石锭')
    await chooseSelectOption('maa-roguelike-squad', '指挥分队')
    await toggleSwitchByName('maa-roguelike-useSupport')

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Phantom --mode 1 --squad 指挥分队 --roles 稳扎稳打 --use-support',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('submits the starting roles chosen in the panel', async () => {
    await renderPage()
    await setTheme('JieGarden')

    const roles = controlForName('maa-roguelike-roles')
    expect(roles.textContent).toContain('稳扎稳打')
    await chooseSelectOption('maa-roguelike-roles', '先手必胜（先锋、狙击、特种）')

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'JieGarden --roles 先手必胜',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('swaps squad and theme-only fields with the active theme', async () => {
    await renderPage()
    await setTheme('Sami')

    const samiSquads = await selectOptionLabels('maa-roguelike-squad')
    expect(samiSquads).toContain('生活至上分队')
    expect(container.querySelector('input[name="maa-roguelike-useFoldartal"]')).not.toBeNull()
    expect(container.querySelector('input[name="maa-roguelike-startWithSeed"]')).toBeNull()
    expect(container.querySelector('input[name="maa-roguelike-startFoldartals"]')).toBeNull()

    await chooseSelectOption('maa-roguelike-mode', '刷开局')
    expect(container.querySelector('input[name="maa-roguelike-startFoldartals"]')).toBeNull()

    await chooseSelectOption('maa-roguelike-squad', '生活至上分队')
    expect(container.querySelector('input[name="maa-roguelike-startFoldartals"]')).not.toBeNull()

    await setTheme('Sarkaz')

    const sarkazSquads = await selectOptionLabels('maa-roguelike-squad')
    expect(sarkazSquads).toContain('蓝图测绘分队')
    expect(container.querySelector('input[name="maa-roguelike-useFoldartal"]')).toBeNull()

    await chooseSelectOption('maa-roguelike-mode', '刷源石锭')
    expect(container.querySelector('input[name="maa-roguelike-startWithSeed"]')).toBeNull()

    await chooseSelectOption('maa-roguelike-squad', '点刺成锭分队')
    expect(container.querySelector('input[name="maa-roguelike-startWithSeed"]')).not.toBeNull()
  })

  it('submits the seed string for the eligible Sarkaz investment squad', async () => {
    await renderPage()
    await setTheme('Sarkaz')
    await chooseSelectOption('maa-roguelike-mode', '刷源石锭')
    await chooseSelectOption('maa-roguelike-squad', '点刺成锭分队')
    await setControlValue('input[name="maa-roguelike-startWithSeed"]', '2b3c4d,rogue_1,120')

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Sarkaz --mode 1 --squad 点刺成锭分队 --roles 稳扎稳打 --start-with-seed 2b3c4d,rogue_1,120',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('marks a squad left over from another theme and focuses its field error', async () => {
    await renderPage()
    await setTheme('Sarkaz')
    await chooseSelectOption('maa-roguelike-squad', '蓝图测绘分队')

    await setTheme('Sami')

    const squad = () => controlForName('maa-roguelike-squad')
    expect(squad().textContent).toContain('蓝图测绘分队（不适用于当前主题）')

    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    const message = '起始分队「蓝图测绘分队」不在当前主题的可选范围内，请重新选择'
    expect(squad().getAttribute('aria-invalid')).toBe('true')
    expect(squad().getAttribute('aria-errormessage')).toBe('roguelike-roguelike-squad-error')
    expect(fieldError('roguelike-roguelike-squad')?.textContent).toBe(message)
    expect(document.activeElement).toBe(squad())
    expect(mocks.notify).not.toHaveBeenCalled()

    await chooseSelectOption('maa-roguelike-squad', '指挥分队')
    expect(squad().getAttribute('aria-invalid')).toBeNull()
    expect(fieldError('roguelike-roguelike-squad')).toBeNull()

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Sami --squad 指挥分队 --roles 稳扎稳打',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('shows an inline error for non-integer counts and focuses the field', async () => {
    await renderPage()
    await setTheme('Phantom')
    await setControlValue('input[name="maa-roguelike-startCount"]', '1.5')

    const countInput = () => container.querySelector<HTMLInputElement>('input[name="maa-roguelike-startCount"]')!
    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    expect(countInput().getAttribute('aria-invalid')).toBe('true')
    expect(fieldError('roguelike-roguelike-startCount')?.textContent).toBe('运行次数需为整数')
    expect(document.activeElement).toBe(countInput())
    expect(mocks.notify).not.toHaveBeenCalled()

    await setControlValue('input[name="maa-roguelike-startCount"]', '3')
    expect(countInput().getAttribute('aria-invalid')).toBeNull()
    expect(fieldError('roguelike-roguelike-startCount')).toBeNull()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Phantom --roles 稳扎稳打 --start-count 3',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('rejects the collapsal mode with an inline error and resets it on theme change', async () => {
    await renderPage()
    await setTheme('Sami')
    await chooseSelectOption('maa-roguelike-mode', '刷坍缩范式')

    expect(container.querySelector('input[name="maa-roguelike-expectedCollapsalParadigms"]')).not.toBeNull()

    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    const paradigms = () => container.querySelector<HTMLInputElement>(
      'input[name="maa-roguelike-expectedCollapsalParadigms"]',
    )!
    expect(paradigms().getAttribute('aria-invalid')).toBe('true')
    expect(fieldError('roguelike-roguelike-expectedCollapsalParadigms')?.textContent)
      .toBe('刷坍缩范式模式需要填写期望坍缩范式')
    expect(document.activeElement).toBe(paradigms())
    expect(mocks.notify).not.toHaveBeenCalled()

    await setControlValue('input[name="maa-roguelike-expectedCollapsalParadigms"]', '目空一些，图像损坏')
    expect(fieldError('roguelike-roguelike-expectedCollapsalParadigms')).toBeNull()
    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Sami --mode 5 --roles 稳扎稳打 --expected-collapsal-paradigms 目空一些 --expected-collapsal-paradigms 图像损坏',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )

    await setTheme('Sarkaz')
    expect(selectValueFor('maa-roguelike-mode')).toBe('0')
    expect(container.querySelector('input[name="maa-roguelike-expectedCollapsalParadigms"]')).toBeNull()
  })

  it('submits the task selected by the active mode', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')
    await setReclamationCraftValues()

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'reclamation',
      'Tales -m 1 -C 荧光棒 --num-craft-batches 16',
      null,
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('asks for the reclamation crafting configuration with an inline field error', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    const tools = () => container.querySelector<HTMLInputElement>('input[name="maa-reclamation-toolsToCraft"]')!
    expect(tools().getAttribute('aria-invalid')).toBe('true')
    expect(fieldError('roguelike-reclamation-toolsToCraft')?.textContent)
      .toBe('请填写「制作工具名称」：留空时 maa-cli 会默认制作 16 批荧光棒')
    expect(document.activeElement).toBe(tools())
    expect(mocks.notify).not.toHaveBeenCalled()

    await setReclamationCraftValues()
    expect(fieldError('roguelike-reclamation-toolsToCraft')).toBeNull()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'reclamation',
      'Tales -m 1 -C 荧光棒 --num-craft-batches 16',
      null,
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('shows and submits the same default reclamation mode without a saved config', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)

    expect(selectValueFor('maa-reclamation-mode')).toBe('1')

    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')
    await setReclamationCraftValues()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenLastCalledWith(
      'reclamation',
      'Tales -m 1 -C 荧光棒 --num-craft-batches 16',
      null,
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )

    await chooseSelectOption('maa-reclamation-mode', '刷繁荣度（无存档）')
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenLastCalledWith(
      'reclamation',
      'Tales -m 0',
      null,
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('hides the reclamation tool fields in mode 0', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)

    expect(container.querySelector('input[name="maa-reclamation-toolsToCraft"]')).not.toBeNull()
    expect(container.querySelector('input[name="maa-reclamation-numBatches"]')).not.toBeNull()

    await chooseSelectOption('maa-reclamation-mode', '刷繁荣度（无存档）')

    expect(container.querySelector('input[name="maa-reclamation-toolsToCraft"]')).toBeNull()
    expect(container.querySelector('input[name="maa-reclamation-numBatches"]')).toBeNull()
  })

  it('shows the default reclamation mode for a legacy payload without one', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskInputs: { reclamation: 'Tales' } },
    })

    await renderPage()
    await click(findModeButton('生息演算')!)

    expect(selectValueFor('maa-reclamation-mode')).toBe('1')
    expect(mocks.saveUserConfig).not.toHaveBeenCalled()

    await setReclamationCraftValues()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'reclamation',
      'Tales -m 1 -C 荧光棒 --num-craft-batches 16',
      null,
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('moves the reclamation guidance into field hint tooltips', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')

    const cases = [
      ['模式', '沙洲遗闻：模式 0 仅在没有存档时使用'],
      ['制作工具名称', '必填，不能留空'],
      ['加号点击方式', '增加组装数量时与加号按钮的交互方式'],
      ['批次数', '必填，每批 99 个'],
    ]
    for (const [label, fragment] of cases) {
      const trigger = container.querySelector<HTMLElement>(`button[aria-label="${label}说明"]`)
      expect(trigger, `${label} hint trigger`).not.toBeNull()
      await focus(trigger!)
      expect(tooltipText()).toContain(fragment)
      await act(async () => trigger!.blur())
    }

    expect(container.textContent).not.toContain('沙洲遗闻：模式 0 仅在没有存档时使用')
    expect(container.textContent).not.toContain('必填，不能留空')
    expect(container.textContent).not.toContain('增加组装数量时与加号按钮的交互方式')
    expect(container.textContent).not.toContain('必填，每批 99 个')
  })

  it('rejects an empty theme with a focused field error before creating a run', async () => {
    await renderPage()

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    const themeInput = () => container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    expect(themeInput().getAttribute('aria-invalid')).toBe('true')
    expect(themeInput().getAttribute('aria-errormessage')).toBe('roguelike-roguelike-theme-error')
    expect(fieldError('roguelike-roguelike-theme')?.textContent).toBe('请输入主题名称')
    expect(document.activeElement).toBe(themeInput())
    expect(mocks.notify).not.toHaveBeenCalled()

    await setTheme('Phantom')
    expect(themeInput().getAttribute('aria-invalid')).toBeNull()
    expect(fieldError('roguelike-roguelike-theme')).toBeNull()
  })

  it('keeps the run observable after the page unmounts without sending a stop', async () => {
    vi.useFakeTimers()
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()
    expect(buttonByText('终止')).toBeDefined()

    await act(async () => root.unmount())
    root = createRoot(document.createElement('div'))
    const snapshotCalls = api.fetchSnapshot.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(api.stopRun).not.toHaveBeenCalled()
    expect(api.fetchSnapshot.mock.calls.length).toBeGreaterThan(snapshotCalls)
  })

  it('recovers its own run identity after a refresh without resubmitting', async () => {
    useIdentity({ runId: 'run-7', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-7')] })))
    startController()
    await flush()
    await renderPage()

    expect(buttonByText('终止')).toBeDefined()
    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: activeRun('run-7', 'succeeded') })))
    await refreshController()

    expect(buttonByText('开始')).toBeDefined()
    expect(mocks.notify).toHaveBeenCalledWith('肉鸽任务执行成功', 'success', { id: 'execution' })
  })

  it('feeds the page-owned active run into the progress panel', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('集成战略进度')
    expect(progressPanel()?.textContent).toContain('运行中')
    expect(progressPanel()?.textContent).toContain('正在启动')
  })

  it('feeds an active blackflow snapshot into the progress panel', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    const run = runWithProgress('run-1')
    run.progress = {
      ...run.progress,
      roguelike: {
        ...progressSnapshot(),
        blackflow: blackflowProgress(),
      },
    }
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [run] })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('黑流进度')
    expect(progressPanel()?.textContent).toContain('第 3 层')
    expect(progressPanel()?.textContent).toContain('行动力 7')
  })

  it('does not carry a roguelike blackflow result into the reclamation panel', async () => {
    useIdentity(null)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      lastRun: terminalRunWithBlackflow('run-1'),
    })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('黑流进度')

    await click(findModeButton('生息演算')!)

    expect(progressPanel()?.textContent).toContain('生息演算进度')
    expect(progressPanel()?.textContent).not.toContain('黑流进度')
    expect(progressPanel()?.textContent).not.toContain('第 3 层')
  })

  it('keeps the progress panel loading while the restored run identity is being resolved', async () => {
    const runResponse = deferred<ApiResponse<AgentRun>>()
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminalRunWithSummary('run-old') })))
    api.fetchRun.mockReturnValueOnce(runResponse.promise)
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('正在确认执行状态…')
    expect(progressPanel()?.textContent).not.toContain('最近一次执行')
    expect(progressPanel()?.textContent).not.toContain('还没有开始探索')

    await act(async () => runResponse.resolve(ok(activeRun('run-1'))))
    await flush()

    expect(progressPanel()?.textContent).toContain('运行中')
  })

  it('shows a matching terminal lastRun after a refresh without page-owned identity', async () => {
    useIdentity(null)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminalRunWithSummary('run-1') })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('集成战略进度')
    expect(progressPanel()?.textContent).toContain('已完成')
    expect(progressPanel()?.textContent).toContain('最近一次执行已结束')
    expect(progressPanel()?.textContent).not.toContain('正在确认执行状态')
  })

  it('does not show another mode or another operation lastRun in the roguelike panel', async () => {
    useIdentity(null)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      lastRun: terminalRunWithSummary('run-reclamation', 'reclamation'),
    })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('还没有开始探索')
    expect(progressPanel()?.textContent).not.toContain('已完成')

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      lastRun: {
        ...terminalRunWithSummary('run-copilot'),
        operationId: 'run_copilot_set',
      },
    })))
    await refreshController()

    expect(progressPanel()?.textContent).toContain('还没有开始探索')
    expect(progressPanel()?.textContent).not.toContain('已完成')
  })

  it('does not present another domain run as a roguelike execution', async () => {
    useIdentity({ runId: 'run-combat', operationId: 'run_task', scope: 'combat' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-combat')] })))
    startController()
    await flush()
    await renderPage()

    expect(buttonByText('开始')).toBeDefined()
    expect(buttonByText('终止')).toBeUndefined()
    expect(buttonByText('等待战斗结束')).toBeUndefined()
  })

  it('stops by runId once and keeps confirming until the run reaches a terminal state', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('终止')!)

    expect(api.stopRun).toHaveBeenCalledOnce()
    expect(api.stopRun).toHaveBeenCalledWith('run-1', { mode: 'now' })
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在终止肉鸽任务...', 'execution')
    expect(buttonByText('正在终止')?.disabled).toBe(true)

    // 停止确认中的重复点击不会重复发送停止请求。
    await click(buttonByText('正在终止')!)
    expect(api.stopRun).toHaveBeenCalledOnce()

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: activeRun('run-1', 'stopped') })))
    await refreshController()

    expect(buttonByText('开始')).toBeDefined()
    expect(mocks.notify).toHaveBeenCalledWith('肉鸽任务已终止', 'warning', { id: 'execution' })
  })

  it('keeps the stop confirmation across Activity hide/show and never leaves a locked button', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await act(async () => {
      root.render(
        <Activity mode="visible">
          <TestApp />
        </Activity>,
      )
    })
    await flush()

    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: activeRun('run-1', 'running'),
    }))
    await click(buttonByText('终止')!)
    expect(buttonByText('正在终止')?.disabled).toBe(true)

    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <TestApp />
          </Activity>,
        )
      })
      await flush()
    }
    await renderMode('hidden')
    await renderMode('visible')
    expect(buttonByText('正在终止')?.disabled).toBe(true)
    expect(api.stopRun).toHaveBeenCalledOnce()

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: activeRun('run-1', 'stopped') })))
    await refreshController()

    expect(buttonByText('开始')?.disabled).toBe(false)
    expect(buttonByText('正在终止')).toBeUndefined()
  })

  it('unlocks the stop action when confirmation times out so it can be retried', async () => {
    vi.useFakeTimers()
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: activeRun('run-1', 'running'),
    }))
    await click(buttonByText('终止')!)
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
    expect(buttonByText('终止')?.disabled).toBe(false)

    await click(buttonByText('终止')!)
    expect(api.stopRun).toHaveBeenCalledTimes(2)
  })

  it('unlocks the stop action when the stop request is rejected', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    api.stopRun.mockResolvedValueOnce(failed('AGENT_RUN_NOT_CURRENT', '目标运行已不是当前运行'))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('终止')!)

    expect(mocks.notify).toHaveBeenCalledWith('终止失败: 目标运行已不是当前运行', 'error', { id: 'execution' })
    expect(buttonByText('终止')?.disabled).toBe(false)
  })

  it('requests the wait-for-combat stop and keeps the immediate stop available', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: false,
      deviceStopRequested: false,
      run: activeRun('run-1'),
      pendingStop: {
        mode: 'after-combat',
        requestedAt: '2026-10-25T00:00:00.000Z',
        deadline: '2026-10-25T00:10:00.000Z',
        combat: true,
      },
    }))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('等待战斗结束')!)

    expect(api.stopRun).toHaveBeenCalledWith('run-1', { mode: 'after-combat' })
    expect(mocks.notify).toHaveBeenCalledWith('已受理，等待战斗结束后终止', 'warning', { id: 'execution' })
    expect(buttonByText('等待战斗结束')?.disabled).toBe(true)
    const waitTrigger = container.querySelector<HTMLElement>('[aria-label="等待战斗结束：最多等待 10 分钟"]')
    expect(waitTrigger?.tabIndex).toBe(0)
    await focus(waitTrigger!)
    expect(tooltipText()).toBe('最多等待 10 分钟')
    expect(buttonByText('终止')?.disabled).toBe(false)
    expect(buttonByText('正在终止')).toBeUndefined()
  })

  it('keeps the wait state from the run progress without tripping the stop confirm timeout', async () => {
    vi.useFakeTimers()
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waitingForCombatRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    expect(buttonByText('等待战斗结束')?.disabled).toBe(true)
    const waitTrigger = container.querySelector<HTMLElement>('[aria-label="等待战斗结束：最多等待 10 分钟"]')
    expect(waitTrigger?.tabIndex).toBe(0)
    await focus(waitTrigger!)
    expect(tooltipText()).toBe('最多等待 10 分钟')
    expect(buttonByText('终止')?.disabled).toBe(false)
    expect(api.stopRun).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    await flush()

    expect(mocks.notify).not.toHaveBeenCalledWith(
      '终止失败: 终止请求已发送，但尚未确认任务停止',
      'error',
      { id: 'execution' },
    )
    expect(buttonByText('等待战斗结束')?.disabled).toBe(true)
    expect(buttonByText('终止')?.disabled).toBe(false)
  })

  it('cancels the wait by sending an immediate stop from the left action', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [waitingForCombatRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('终止')!)

    expect(api.stopRun).toHaveBeenCalledWith('run-1', { mode: 'now' })
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在终止肉鸽任务...', 'execution')

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1', 'stopping')] })))
    await refreshController()

    expect(buttonByText('正在终止')?.disabled).toBe(true)
  })

  it('reports a degraded wait as an immediate stop outside combat', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: activeRun('run-1'),
    }))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('等待战斗结束')!)

    expect(mocks.notify).toHaveBeenCalledWith('未在战斗中，已立即终止', 'warning', { id: 'execution' })
    expect(buttonByText('正在终止')?.disabled).toBe(true)
    expect(container.querySelector('[aria-label^="等待战斗结束："]')).toBeNull()
  })

  it('does not claim an immediate stop when the run is already stopping', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    api.stopRun.mockResolvedValueOnce(ok({
      stopRequested: true,
      deviceStopRequested: false,
      alreadyStopping: true,
      run: activeRun('run-1', 'stopping'),
    }))
    startController()
    await flush()
    await renderPage()

    await click(buttonByText('等待战斗结束')!)

    expect(mocks.notify).not.toHaveBeenCalledWith('未在战斗中，已立即终止', 'warning', { id: 'execution' })
    expect(container.querySelector('[aria-label^="等待战斗结束："]')).toBeNull()
    expect(buttonByText('正在终止')?.disabled).toBe(true)
  })

  it('reports a failed run and returns to the execute action', async () => {
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      lastRun: {
        ...activeRun('run-1', 'failed'),
        error: { code: 'AGENT_RUN_FAILED', message: '设备连接中断' },
      },
    })))
    await refreshController()

    expect(mocks.notify).toHaveBeenCalledWith('执行失败: 设备连接中断', 'error', { id: 'execution' })
    expect(buttonByText('开始')).toBeDefined()
  })

  it('keeps the stop action while observation is disconnected', async () => {
    vi.useFakeTimers()
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    api.fetchSnapshot.mockRejectedValueOnce(new Error('网络中断'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flush()

    expect(buttonByText('终止')).toBeDefined()
    expect(mocks.notify).not.toHaveBeenCalledWith('肉鸽任务已终止', 'warning', { id: 'execution' })
  })

  it('treats a transport failure while submitting as unknown and allows a retry', async () => {
    mocks.executePredefinedTask.mockRejectedValueOnce(new Error('无法连接后端服务'))
    await renderPage()
    await setTheme('Phantom')

    await click(buttonByText('开始')!)

    expect(mocks.notify).toHaveBeenCalledWith(
      '无法确认执行状态: 无法连接后端服务',
      'warning',
      { id: 'execution' },
    )
    expect(buttonByText('开始')?.disabled).toBe(false)
  })

  it('warns without a run identity and leaves the execute action available', async () => {
    mocks.executePredefinedTask.mockResolvedValueOnce(ok({}))
    await renderPage()
    await setTheme('Phantom')

    await click(buttonByText('开始')!)

    expect(mocks.notify).toHaveBeenCalledWith(
      '服务端未返回运行身份，无法确认本次执行状态',
      'warning',
      { id: 'execution' },
    )
    expect(buttonByText('开始')?.disabled).toBe(false)
    expect(buttonByText('终止')).toBeUndefined()
  })

  it('moves focus from the execute action to stop and back at the terminal state', async () => {
    const submission = deferred<ApiResponse>()
    mocks.executePredefinedTask.mockReturnValueOnce(submission.promise)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1', 'accepted')] })))
    startController()
    await flush()
    await renderPage()
    await setTheme('Phantom')

    await click(buttonByText('开始')!)
    await act(async () => submission.resolve(ok({
      runId: 'run-1',
      run: activeRun('run-1', 'accepted'),
    })))
    await flush()

    expect(document.activeElement).toBe(buttonByText('终止'))

    await click(buttonByText('终止')!)
    expect(api.stopRun).toHaveBeenCalledWith('run-1', { mode: 'now' })

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: activeRun('run-1', 'stopped') })))
    await refreshController()

    expect(document.activeElement).toBe(buttonByText('开始'))
  })

  it('keeps the mode panel through the submitted run and its terminal state', async () => {
    mocks.executePredefinedTask.mockResolvedValueOnce(ok({
      runId: 'run-1',
      run: activeRun('run-1', 'accepted'),
    }))
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1', 'accepted')] })))
    startController()
    await flush()
    await renderPage()
    await setTheme('Phantom')

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    await click(buttonByText('开始')!)
    expect(progressPanel()?.textContent).toContain('集成战略进度')
    expect(progressPanel()?.textContent).toContain('启动中')
    expect(progressPanel()?.textContent).toContain('任务：集成战略')

    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminalRunWithSummary('run-1') })))
    await refreshController()

    expect(progressPanel()?.textContent).toContain('任务：集成战略')
    expect(progressPanel()?.textContent).toContain('已完成')
    expect(progressPanel()?.textContent).toContain('本次探索已结束 · 共 2 局')
  })

  it('locks every editing entry while a run is active and keeps stop reachable', async () => {
    mocks.loadUserConfig.mockResolvedValue(ok({
      taskInputs: { roguelike: 'Phantom' },
      advancedParams: { roguelike: { coreChar: '阿米娅' } },
    }))
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    expect(buttonByText('终止')?.disabled).toBe(false)
    expect(findModeButton('生息演算')?.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-startCount"]')?.disabled).toBe(true)
    expect((controlForName('maa-roguelike-mode') as HTMLButtonElement).disabled).toBe(true)
    const presetButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
    expect(presetButtons.length).toBeGreaterThan(0)
    expect(presetButtons.every(button => button.disabled)).toBe(true)
    const useSupport = container.querySelector<HTMLButtonElement>('#roguelike-roguelike-useSupport')!
    expect(useSupport.disabled).toBe(true)
    const supportSwitch = container.querySelector<HTMLElement>('[role="switch"][aria-label="使用助战"]')!
    expect(supportSwitch.getAttribute('aria-disabled')).toBe('true')
    const supportInfo = container.querySelector<HTMLElement>('button[aria-label="使用助战说明"]')!
    await focus(supportInfo)
    expect(tooltipText()).toBe('只作用于核心干员；需要好友提供该干员。')
    await act(async () => supportInfo.blur())
    await click(container.querySelector('label[for="roguelike-roguelike-useSupport"]')!)
    expect(supportSwitch.getAttribute('aria-checked')).toBe('false')
    expect(buttonByText('更换')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="清除核心干员"]')?.disabled).toBe(true)
  })

  it('explains the unavailable execute action with a focusable tooltip', async () => {
    mocks.availability.available = false
    mocks.availability.message = '后端服务暂不可用'
    await renderPage()

    const execute = buttonByText('开始')!
    expect(execute.disabled).toBe(true)
    const trigger = container.querySelector<HTMLElement>('[aria-label="开始：后端服务暂不可用"]')
    expect(trigger?.tabIndex).toBe(0)
    expect(tooltipText()).toBeNull()

    await focus(trigger!)
    expect(tooltipText()).toBe('后端服务暂不可用')
  })
})

describe('RoguelikeTasks layout and config recovery', () => {
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
    mocks.availability.available = true
    mocks.availability.message = ''
    mocks.executePredefinedTask.mockReset()
    mocks.loadUserConfig.mockReset().mockResolvedValue({
      success: true,
      data: { taskInputs: {}, advancedParams: {} },
    })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.getRealtimeLogs.mockReset()
    mocks.notify.mockReset()
    mocks.notifyProgress.mockReset()
    mocks.dismissNotice.mockReset()
    resetGameDataMocks()
    resetQueryClient()

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
    queryClient.clear()
    container.remove()
    for (const release of releases) release()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps mode selection keyboard-navigable and toggles labelled', async () => {
    await renderPage()

    const modeTabs = container.querySelector<HTMLElement>('[role="tablist"][aria-label="肉鸽模式"]')
    expect(modeTabs, 'roguelike mode tablist').not.toBeNull()
    const modeButtons = Array.from(modeTabs!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(modeButtons.filter(button => button.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(modeButtons[0]?.getAttribute('aria-controls')).toBe('roguelike-mode-panel')
    expect(container.querySelector('#roguelike-mode-panel')?.getAttribute('aria-labelledby'))
      .toBe(modeButtons[0]?.id)

    const switches = Array.from(container.querySelectorAll('[role="switch"]'))
    expect(switches.length).toBeGreaterThanOrEqual(2)
    const switchNames = switches.map(input => input.nextElementSibling?.getAttribute('name'))
    expect(switchNames).toEqual(
      expect.arrayContaining(['maa-roguelike-useSupport', 'maa-roguelike-disableInvestment']),
    )
    switches.forEach(input => {
      const labelledControl = input.nextElementSibling?.getAttribute('id') ?? input.id
      const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
        .find(candidate => candidate.htmlFor === labelledControl || candidate.contains(input))
      expect(label ?? input.getAttribute('aria-label')).toBeTruthy()
    })

    expect(modeButtons.map(button => button.tabIndex)).toEqual([0, -1])
    await focus(modeButtons[0]!)
    await keyDown(modeButtons[0]!, 'End')
    expect(document.activeElement).toBe(modeButtons[1])
    expect(modeButtons[0]?.getAttribute('aria-selected')).toBe('true')
    expect(modeButtons[1]?.getAttribute('aria-selected')).toBe('false')

    await keyDown(modeButtons[1]!, 'Enter')
    await click(modeButtons[1]!)
    expect(modeButtons[1]?.getAttribute('aria-selected')).toBe('true')
    expect(modeButtons[0]?.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelector('#roguelike-mode-panel')?.getAttribute('aria-labelledby'))
      .toBe(modeButtons[1]?.id)

    const arrowDownEvent = await keyDown(modeButtons[1]!, 'ArrowDown')
    expect(arrowDownEvent.defaultPrevented).toBe(false)
    expect(modeButtons[1]?.getAttribute('aria-selected')).toBe('true')
  })

  it('moves the difficulty and starting roles guidance into label tooltips', async () => {
    await renderPage()
    await setTheme('Mizuki')

    const cases = [
      {
        key: 'difficulty',
        label: '难度',
        hint: '不切换时沿用游戏内当前难度；指定未解锁的难度会被降到已解锁上限。',
      },
      {
        key: 'roles',
        label: '开局职业组',
        hint: '决定开局能招募的职业；核心干员的职业必须在组合内，例如维什戴尔（狙击）需要稳扎稳打。',
      },
    ]

    for (const { key, label, hint } of cases) {
      expect(controlForName(`maa-roguelike-${key}`)).not.toBeNull()
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}说明"]`)!
      const tooltipFor = () => {
        const describedBy = trigger.getAttribute('aria-describedby')
        return describedBy ? document.getElementById(describedBy) : null
      }

      expect(trigger).not.toBeNull()
      expect(trigger.getAttribute('aria-describedby')).toBeNull()
      expect(trigger.getAttribute('aria-label')).toBe(`${label}说明`)

      await act(async () => trigger.focus())
      await flush()
      const focusedTooltip = tooltipFor()
      expect(focusedTooltip?.getAttribute('role')).toBe('tooltip')
      expect(focusedTooltip?.textContent).toBe(hint)
      expect(trigger.getAttribute('aria-describedby')).toBe(focusedTooltip?.id)

      await act(async () => trigger.blur())
      await flush()
      expect(trigger.getAttribute('aria-describedby')).toBeNull()

      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(tooltipFor()?.textContent).toBe(hint)
    }

    const paragraphs = Array.from(container.querySelectorAll('p'))
      .map(paragraph => paragraph.textContent)
    for (const { hint } of cases) expect(paragraphs).not.toContain(hint)
  })

  it('renders theme-specific field guidance as label tooltips', async () => {
    await renderPage()

    const cases = [
      {
        theme: 'Sami',
        label: '第一层期望密文板',
        hint: '填写希望在第一层远见阶段得到的密文板；成功凹到后停止任务。',
      },
      {
        theme: 'BlackFlow',
        label: '黑流策略',
        hint: '刷等级模式的路线与结束目标；留空时按投资开关推导速通策略。',
      },
    ]

    for (const { theme, label, hint } of cases) {
      await setTheme(theme)
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}说明"]`)
      expect(trigger, `${label} hint trigger`).not.toBeNull()
      await focus(trigger!)
      expect(tooltipText()).toBe(hint)
      await act(async () => trigger!.blur())
    }

    const paragraphs = Array.from(container.querySelectorAll('p'))
      .map(paragraph => paragraph.textContent)
    for (const { hint } of cases) expect(paragraphs).not.toContain(hint)
  })

  it('keeps mode selection and its configuration panel in sync', async () => {
    await renderPage()

    expect(container.querySelector('input[name="maa-roguelike-theme"]')).not.toBeNull()

    const reclamationMode = findModeButton('生息演算')
    expect(reclamationMode).toBeDefined()
    await click(reclamationMode!)

    expect(reclamationMode?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1)
    expect(container.querySelector('input[name="maa-roguelike-theme"]')).toBeNull()
    expect(container.querySelector('input[name="maa-reclamation-theme"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('button[aria-pressed]'))
      .some(option => option.textContent?.includes('沙洲遗闻'))).toBe(true)
  })

  it('does not carry a roguelike result into the reclamation panel when switching modes', async () => {
    useIdentity(null)
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ lastRun: terminalRunWithSummary('run-1') })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(progressPanel()?.textContent).toContain('集成战略进度')
    expect(progressPanel()?.textContent).toContain('已完成')

    await click(findModeButton('生息演算')!)

    expect(progressPanel()?.textContent).toContain('生息演算进度')
    expect(progressPanel()?.textContent).toContain('还没有开始演算')
    expect(progressPanel()?.textContent).not.toContain('已完成')
    expect(progressPanel()?.textContent).not.toContain('本次探索已结束')
  })

  it('aligns the visible mode to the running command after a refresh', async () => {
    useIdentity({ runId: 'run-reclamation', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({
      activeRuns: [runWithProgress('run-reclamation', 'reclamation')],
    })))
    startController()
    await flush()
    await renderPage()

    const progressPanel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
    expect(findModeButton('生息演算')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('input[name="maa-reclamation-theme"]')).not.toBeNull()
    expect(progressPanel()?.textContent).toContain('生息演算进度')
    expect(progressPanel()?.textContent).toContain('本次演算进行中')
  })

  it('keeps per-mode drafts while switching modes', async () => {
    vi.useFakeTimers()
    await renderPage()

    await setTheme('Phantom')
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledWith('roguelike-tasks', {
      taskInputs: { roguelike: 'Phantom', reclamation: 'Tales' },
      advancedParams: {
        roguelike: { roles: '稳扎稳打' },
        reclamation: { mode: '1' },
      },
    })

    await chooseSelectOption('maa-reclamation-mode', '刷繁荣度（无存档）')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenLastCalledWith('roguelike-tasks', {
      taskInputs: { roguelike: 'Phantom', reclamation: 'Tales' },
      advancedParams: {
        roguelike: { roles: '稳扎稳打' },
        reclamation: { mode: '0' },
      },
    })

    await click(findModeButton('集成战略')!)
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value)
      .toBe('Phantom')
  })

  it('keeps the selected mode across Activity hide/show and resets it on remount', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <TestApp />
          </Activity>,
        )
      })
      await flush()
    }

    await renderMode('visible')
    await click(findModeButton('生息演算')!)
    expect(findModeButton('生息演算')?.getAttribute('aria-selected')).toBe('true')

    await renderMode('hidden')
    await renderMode('visible')
    expect(findModeButton('生息演算')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('input[name="maa-reclamation-theme"]')).not.toBeNull()

    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<TestApp />))
    await flush()

    expect(findModeButton('集成战略')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('input[name="maa-roguelike-theme"]')).not.toBeNull()
  })

  it('keeps an unsynced local draft across remounts and retries the save', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockRejectedValueOnce(new Error('网络连接中断'))
    await renderPage()

    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Phantom')
      themeInput?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(localStorage.getItem('roguelikeConfigSyncPending')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('roguelikeTaskInputs') || '{}')).toMatchObject({ roguelike: 'Phantom' })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const failedNotice = findConfigSaveErrorNotice()
    expect(failedNotice?.[0]).toContain('网络连接中断')
    expect(failedNotice?.[2]?.action).toMatchObject({ label: '重新同步' })

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.loadUserConfig.mockClear()
    await act(async () => root.render(<TestApp />))
    await flush()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Phantom')
    const restoredNotice = findConfigSaveErrorNotice()
    expect(restoredNotice?.[0]).toContain('尚未同步到服务器')
    expect(restoredNotice?.[2]?.action).toMatchObject({ label: '重新同步' })

    await act(async () => restoredNotice?.[2]?.action?.onClick())
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('roguelikeConfigSyncPending')).toBeNull()
    expect(mocks.dismissNotice).toHaveBeenCalledWith('roguelike-config-save')
    expect(mocks.notify).toHaveBeenCalledWith('肉鸽配置已同步', 'success')
  })

  it('keeps a manual retry single-flight and announces success only after confirmation', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockRejectedValueOnce(new Error('网络连接中断'))
    await renderPage()

    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Phantom')
      themeInput.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.notify).not.toHaveBeenCalledWith('肉鸽配置已同步', 'success')
    const retryAction = findConfigSaveErrorNotice()?.[2]?.action
    expect(retryAction?.label).toBe('重新同步')

    const retrySave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(retrySave.promise)
    await act(async () => retryAction?.onClick())
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)

    await act(async () => retryAction?.onClick())
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.notify).not.toHaveBeenCalledWith('肉鸽配置已同步', 'success')
    expect(buttonByText('同步中')).toBeUndefined()

    await act(async () => retrySave.resolve({ success: true }))
    await flush()

    expect(localStorage.getItem('roguelikeConfigSyncPending')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.dismissNotice).toHaveBeenCalledWith('roguelike-config-save')
    expect(mocks.notify).toHaveBeenCalledWith('肉鸽配置已同步', 'success')
  })

  it('prefers an unsynced local draft from a previous session without reading the server', async () => {
    localStorage.setItem('roguelikeConfigSyncPending', 'previous-session-token')
    localStorage.setItem('roguelikeTaskInputs', JSON.stringify({ roguelike: 'Sarkaz' }))
    localStorage.setItem('roguelikeAdvancedParams', JSON.stringify({ roguelike: { mode: '1' } }))
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskInputs: { roguelike: 'Sami' }, advancedParams: {} },
    })

    await renderPage()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(mocks.saveUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Sarkaz')
    expect(selectValueFor('maa-roguelike-mode')).toBe('1')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(findConfigSaveErrorNotice()?.[0]).toContain('尚未同步到服务器')
  })

  it('drops a pending marker whose local draft is unreadable and falls back to the server', async () => {
    localStorage.setItem('roguelikeTaskInputs', '{not-json')
    localStorage.setItem('roguelikeConfigSyncPending', 'stale-token')
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskInputs: { roguelike: 'Sami' }, advancedParams: {} },
    })

    await renderPage()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(localStorage.getItem('roguelikeConfigSyncPending')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Sami')
  })

  it('keeps the hydrated draft and skips config reload after Activity restore', async () => {
    vi.useFakeTimers()
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: { taskInputs: { roguelike: 'Phantom' }, advancedParams: {} },
    })
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <TestApp />
          </Activity>,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Sami')
      themeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await renderMode('hidden')
    await renderMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Sami')
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
  })

  it('keeps the shell and stops editing while the roguelike config is loading', async () => {
    const pendingLoad = deferred<ApiResponse>()
    mocks.loadUserConfig.mockReturnValueOnce(pendingLoad.promise)

    await renderPage()

    const configStatus = () => Array.from(container.querySelectorAll<HTMLElement>('[role="status"]'))
      .find(status => status.textContent?.includes('正在读取肉鸽配置…'))
    expect(configStatus()).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(true)
    expect(container.querySelector('input[name="maa-roguelike-mode"]')).toBeNull()
    const presetButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
    expect(presetButtons.length).toBeGreaterThan(0)
    expect(presetButtons.every(button => button.disabled)).toBe(true)
    const modeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(modeButtons.length).toBeGreaterThan(0)
    expect(modeButtons.every(button => button.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(buttonByText('开始')?.disabled).toBe(true)

    await act(async () => pendingLoad.resolve(ok({ taskInputs: {}, advancedParams: {} })))
    await flush()

    expect(configStatus()).toBeUndefined()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(false)
    expect(container.querySelector('input[name="maa-roguelike-mode"]')).not.toBeNull()
    expect(modeButtons.every(button => button.getAttribute('aria-disabled') !== 'true')).toBe(true)
    expect(buttonByText('开始')?.disabled).toBe(false)
  })

  it('reloads a failed roguelike config before re-enabling editing', async () => {
    mocks.loadUserConfig
      .mockReset()
      .mockResolvedValueOnce(failed('ROGUELIKE_CONFIG_LOAD_FAILED', '读取肉鸽配置失败'))
      .mockResolvedValueOnce(ok({ taskInputs: {}, advancedParams: {} }))

    await renderPage()

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain('肉鸽配置暂时不可用')
    expect(alert?.textContent).toContain('读取肉鸽配置失败')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(true)
    expect(container.querySelector('input[name="maa-roguelike-mode"]')).toBeNull()
    expect(buttonByText('开始')?.disabled).toBe(true)
    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()

    await click(buttonByText('重新加载')!)
    await flush()

    expect(mocks.loadUserConfig).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(false)
    expect(container.querySelector('input[name="maa-roguelike-mode"]')).not.toBeNull()
    await setTheme('Phantom')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Phantom')
  })

  it('keeps an active run stoppable while the roguelike config is unavailable', async () => {
    mocks.loadUserConfig.mockReset().mockResolvedValueOnce(
      failed('ROGUELIKE_CONFIG_LOAD_FAILED', '读取肉鸽配置失败'),
    )
    useIdentity({ runId: 'run-1', operationId: 'run_task', scope: 'roguelike' })
    api.fetchSnapshot.mockResolvedValue(ok(runSnapshot({ activeRuns: [activeRun('run-1')] })))
    startController()
    await flush()
    await renderPage()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('肉鸽配置暂时不可用')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.disabled).toBe(true)
    expect(container.querySelector('input[name="maa-roguelike-theme"]')).not.toBeNull()
    expect(buttonByText('终止')).toBeDefined()

    await click(buttonByText('终止')!)

    expect(api.stopRun).toHaveBeenCalledOnce()
    expect(api.stopRun).toHaveBeenCalledWith('run-1', { mode: 'now' })
  })

  it('keeps an unknown intermediate theme mode and normalizes it before submission', async () => {
    await renderPage()
    await setTheme('Sami')
    await chooseSelectOption('maa-roguelike-mode', '刷坍缩范式')
    expect(selectValueFor('maa-roguelike-mode')).toBe('5')

    for (const prefix of ['S', 'Sa', 'Sar', 'Sark', 'Sarka']) {
      await setTheme(prefix)
      expect(selectValueFor('maa-roguelike-mode'), prefix).toBe('5')
    }
    await setTheme('Sarkaz')
    expect(selectValueFor('maa-roguelike-mode')).toBe('0')

    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Sarkaz --mode 0 --roles 稳扎稳打',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
    expect(mocks.notify).not.toHaveBeenCalledWith('刷坍缩范式模式需要填写期望坍缩范式')
  })

  it('persists and submits the normalized mode for a known theme before validation', async () => {
    mocks.loadUserConfig.mockResolvedValue(ok({
      taskInputs: { roguelike: 'Sarkaz' },
      advancedParams: { roguelike: { mode: '5' } },
    }))

    await renderPage()
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Sarkaz --mode 0 --roles 稳扎稳打',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
    expect(mocks.notify).not.toHaveBeenCalledWith('刷坍缩范式模式需要填写期望坍缩范式')
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('不在当前主题的可选范围内'))

    await waitForConfigCommit()

    expect(mocks.saveUserConfig).toHaveBeenLastCalledWith('roguelike-tasks', {
      taskInputs: { roguelike: 'Sarkaz' },
      advancedParams: expect.objectContaining({
        roguelike: { mode: '0', roles: '稳扎稳打' },
      }),
    })
  })

  it('surfaces config save failures as one fixed-id toast with a retry action', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockRejectedValueOnce(new Error('网络连接中断'))
    await renderPage()

    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Phantom')
      themeInput.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    const errorNotice = findConfigSaveErrorNotice()
    expect(errorNotice?.[0]).toContain('网络连接中断')
    expect(errorNotice?.[1]).toBe('error')
    expect(errorNotice?.[2]?.id).toBe('roguelike-config-save')
    expect(errorNotice?.[2]?.action).toMatchObject({ label: '重新同步' })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(buttonByText('重新同步')).toBeUndefined()
    expect(buttonByText('同步中')).toBeUndefined()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    const retrySave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(retrySave.promise)
    await act(async () => errorNotice?.[2]?.action?.onClick())
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(buttonByText('同步中')).toBeUndefined()

    const dismissalsBeforeSuccess = mocks.dismissNotice.mock.calls
      .filter(([id]) => id === 'roguelike-config-save').length
    await act(async () => retrySave.resolve({ success: true }))
    await flush()

    expect(mocks.dismissNotice.mock.calls
      .filter(([id]) => id === 'roguelike-config-save').length).toBeGreaterThan(dismissalsBeforeSuccess)
    expect(mocks.notify).toHaveBeenCalledWith('肉鸽配置已同步', 'success')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('adds the reclamation increment mode and clear-store controls', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'Tales')

    expect(container.querySelector('input[name="maa-reclamation-incrementMode"]')).not.toBeNull()
    expect(selectValueFor('maa-reclamation-incrementMode')).toBe('0')

    await chooseSelectOption('maa-reclamation-mode', '刷繁荣度（无存档）')
    expect(container.querySelector('input[name="maa-reclamation-incrementMode"]')).toBeNull()
    await toggleSwitchByName('maa-reclamation-clearStore')
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenLastCalledWith(
      'run',
      'reclamation',
      expect.objectContaining({
        params: expect.objectContaining({ clear_store: true }),
      }),
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('switches the reclamation modes with the relaunch anchor theme', async () => {
    await renderPage()
    await click(findModeButton('生息演算')!)
    await setControlValue('input[name="maa-reclamation-theme"]', 'RelaunchAnchor')

    expect(selectValueFor('maa-reclamation-mode')).toBe('16')
    expect(await selectOptionLabels('maa-reclamation-mode')).toEqual(['RA-1（精耕细作循环）', 'RA-15（60 杀任务）', 'RA-4（解锁区域并击杀 Boss）'])

    await chooseSelectOption('maa-reclamation-mode', 'RA-15（60 杀任务）')
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenLastCalledWith(
      'run',
      'reclamation',
      expect.objectContaining({
        params: expect.objectContaining({ mode: 32 }),
      }),
      null,
      '生息演算',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('submits core-only roguelike selections as a dynamic task', async () => {
    await renderPage()
    await setTheme('BlackFlow')
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).toHaveBeenLastCalledWith(
      'run',
      'roguelike',
      {
        name: '集成战略',
        type: 'Roguelike',
        params: {
          theme: 'BlackFlow',
          roles: '稳扎稳打',
          stop_when_investment_full: true,
        },
      },
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('rejects an unknown theme with an inline field error before creating a run', async () => {
    await renderPage()
    await setTheme('UnknownTheme')
    await click(buttonByText('开始')!)

    expect(mocks.executePredefinedTask).not.toHaveBeenCalled()
    const themeInput = () => container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    expect(themeInput().getAttribute('aria-invalid')).toBe('true')
    expect(fieldError('roguelike-roguelike-theme')?.textContent).toContain('未知主题「UnknownTheme」')
    expect(document.activeElement).toBe(themeInput())
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('selects a core operator from the shared picker, saves its name and clears back to automatic', async () => {
    mocks.getOperBoxData.mockResolvedValue(ok({
      data: [
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', level: 70, elite: 1, potential: 6 },
      ],
    }))
    mocks.getAllOperators.mockResolvedValue(ok([
      { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', level: 70, elite: 1, potential: 6 },
    ]))

    await renderPage()
    await setTheme('Phantom')
    await waitForConfigCommit()

    expect(container.textContent).toContain('未选择')
    expect(container.textContent).not.toContain('填写单个干员中文名')
    expect(container.textContent).not.toContain('留空由 MAA')
    expect(container.querySelector('input[name="maa-roguelike-coreChar"]')).toBeNull()

    await click(buttonByText('选择干员')!)
    await flushAsync()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog, 'operator picker dialog').not.toBeNull()
    expect(dialog?.textContent).toContain('阿米娅')

    const choose = dialog?.querySelector<HTMLButtonElement>('button[aria-label="选择阿米娅"]')
    expect(choose).not.toBeNull()
    await click(choose!)
    await click(Array.from(dialog!.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '确认选择')!)
    await flushAsync()

    expect(container.textContent).toContain('阿米娅')
    expect(container.querySelector('img[src="/avatars/char_002_amiya.png"]')).not.toBeNull()

    await waitForConfigCommit()

    expect(mocks.saveUserConfig).toHaveBeenLastCalledWith('roguelike-tasks', {
      taskInputs: { roguelike: 'Phantom' },
      advancedParams: expect.objectContaining({
        roguelike: { roles: '稳扎稳打', coreChar: '阿米娅' },
      }),
    })

    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Phantom --roles 稳扎稳打 --core-char 阿米娅',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )

    await click(container.querySelector<HTMLElement>('button[aria-label="清除核心干员"]')!)

    expect(container.textContent).toContain('未选择')
    expect(container.querySelector('img[src="/avatars/char_002_amiya.png"]')).toBeNull()

    await waitForConfigCommit()

    expect(mocks.saveUserConfig).toHaveBeenLastCalledWith('roguelike-tasks', {
      taskInputs: { roguelike: 'Phantom' },
      advancedParams: expect.objectContaining({
        roguelike: { roles: '稳扎稳打', coreChar: '' },
      }),
    })
  })

  it('restores a saved core operator name with its avatar and keeps it in the command', async () => {
    mocks.loadUserConfig.mockResolvedValue(ok({
      taskInputs: { roguelike: 'Phantom' },
      advancedParams: { roguelike: { coreChar: '维什戴尔' } },
    }))
    mocks.getAllOperators.mockResolvedValue(ok([
      { id: 'char_4135_wisdel', name: '维什戴尔', rarity: 6, profession: 'SNIPER', level: 90, elite: 2, potential: 1 },
    ]))

    await renderPage()
    await flushAsync()

    expect(container.textContent).toContain('维什戴尔')
    expect(container.querySelector('img[src="/avatars/char_4135_wisdel.png"]')).not.toBeNull()
    expect(container.textContent).not.toContain('填写单个干员中文名')

    await click(buttonByText('开始')!)
    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      'Phantom --roles 稳扎稳打 --core-char 维什戴尔',
      null,
      null,
      '集成战略',
      'roguelike',
      false,
      { idempotencyKey: expect.stringMatching(/^run_task-/) },
    )
  })

  it('keeps panel headings free of the removed mode, task and count descriptions', async () => {
    await renderPage()

    expect(container.textContent).not.toContain('自动刷集成战略（肉鸽），支持多个主题')
    expect(container.textContent).not.toContain('自动生息演算模式')
    expect(container.textContent).not.toContain('选择本次运行内容')
    expect(container.textContent).not.toMatch(/\d+ 项/)
    expect(container.textContent).toMatch(/\d+ 个可用/)

    const heading = (text: string) => Array.from(container.querySelectorAll<HTMLElement>('h2'))
      .find(candidate => candidate.textContent === text)!
    expect(heading('策略设置')).toBeDefined()
    expect(heading('主题')).toBeDefined()
    expect(heading('集成战略进度')).toBeDefined()
    expect(container.querySelectorAll('h3')).toHaveLength(0)

    const themeHeadingRow = heading('主题').parentElement
    expect(themeHeadingRow?.textContent).toMatch(/\d+ 个可用/)
    expect(themeHeadingRow?.querySelector('button')).toBeNull()
    expect(themeHeadingRow?.querySelector('p')).toBeNull()
    expect(heading('策略设置').parentElement?.querySelector('p')).toBeNull()

    const modeTabs = container.querySelector('[role="tablist"][aria-label="肉鸽模式"]')!
    expect(modeTabs.querySelectorAll('small')).toHaveLength(0)
  })

  it('describes each toggle through a persistent accessible description', async () => {
    await renderPage()

    const hint = '只作用于核心干员；需要好友提供该干员。'
    expect(tooltipText()).toBeNull()
    expect(Array.from(container.querySelectorAll('p')).map(paragraph => paragraph.textContent))
      .not.toContain(hint)

    const toggle = container.querySelector<HTMLElement>('[role="switch"][aria-label="使用助战"]')!
    const describedBy = toggle.getAttribute('aria-describedby')
    expect(describedBy).toBe('roguelike-roguelike-useSupport-description')
    const description = describedBy ? document.getElementById(describedBy) : null
    expect(description?.textContent).toBe(hint)
    expect(description?.closest('[role="tooltip"]')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    const info = container.querySelector<HTMLButtonElement>('button[aria-label="使用助战说明"]')!
    expect(info).not.toBeNull()
    await focus(info)
    expect(tooltipText()).toBe(hint)
    expect(document.getElementById('roguelike-roguelike-useSupport-hint')?.getAttribute('role'))
      .toBe('tooltip')
    await act(async () => info.blur())

    const label = container.querySelector<HTMLLabelElement>(
      'label[for="roguelike-roguelike-useSupport"]',
    )!
    await click(label)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('associates every form control with a label', async () => {
    await renderPage()

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
        .find(candidate => candidate.htmlFor === control.id || candidate.contains(control))
      expect(label ?? control.getAttribute('aria-label')).toBeTruthy()
    })
  })
})
