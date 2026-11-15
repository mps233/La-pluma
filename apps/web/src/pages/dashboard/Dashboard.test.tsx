// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as taskExecutionModule from '@/features/task-execution'
import type { AgentRun, ExecutionController, RunSnapshot } from '@/features/task-execution'
import { createQueryClient } from '@/shared/query'
import { useDashboardStore } from '@/features/dashboard/store/dashboardStore'
import { useStatusStore } from '@/features/runtime-status'
import { publishResourceInvalidation } from '@/features/resource-invalidation'
import Dashboard from './Dashboard'
import { PreviewSessionProvider } from '@/features/device-mirror'
import { DASHBOARD_REFRESH_INTERVAL_MS } from '@/features/dashboard/constants'
import type { AutomationActivityPayload } from '@/features/automation'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiMocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  getDeviceStats: vi.fn(),
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  executeScheduleNow: vi.fn(),
  getTrainingQueue: vi.fn(),
  getTodayDrops: vi.fn(),
  getOpenTodayStages: vi.fn(),
  executionApi: {
    fetchSnapshot: vi.fn(),
    fetchRun: vi.fn(),
    stopRun: vi.fn(),
  },
  controllerRef: { current: null as ExecutionController | null },
}))

vi.mock('@/features/automation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/automation/api')>()
  return {
    ...actual,
    getActivity: apiMocks.getActivity,
    getScheduleExecutionStatus: apiMocks.getScheduleExecutionStatus,
    executeScheduleNow: apiMocks.executeScheduleNow,
  }
})

vi.mock('@/features/device-mirror/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/device-mirror/api')>()
  return { ...actual, getDeviceStats: apiMocks.getDeviceStats }
})

vi.mock('@/features/task-execution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/task-execution')>()
  const createController = () => {
    const controller = new actual.ExecutionController({
      api: apiMocks.executionApi,
      storage: null,
      intervals: { active: 60_000, idle: 60_000, disconnected: 60_000 },
    })
    apiMocks.controllerRef.current = controller
    return controller
  }
  const facade = {
    getState: () => apiMocks.controllerRef.current!.getState(),
    subscribe: (listener: () => void) => apiMocks.controllerRef.current!.subscribe(listener),
    start: () => apiMocks.controllerRef.current!.start(),
    submitExecution: (...args: Parameters<ExecutionController['submitExecution']>) =>
      apiMocks.controllerRef.current!.submitExecution(...args),
    stopTrackedRun: () => apiMocks.controllerRef.current!.stopTrackedRun(),
    refresh: () => apiMocks.controllerRef.current!.refresh('manual'),
    observeRun: (...args: Parameters<ExecutionController['observeRun']>) =>
      apiMocks.controllerRef.current!.observeRun(...args),
  }

  return {
    ...actual,
    getTaskStatus: apiMocks.getTaskStatus,
    executionController: facade,
    useExecutionSnapshot: (target: ExecutionController = facade as unknown as ExecutionController) =>
      actual.useExecutionSnapshot(target),
    __createExecutionController: createController,
  }
})

vi.mock('@/features/user-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/user-config')>()
  return { ...actual, loadUserConfig: apiMocks.loadUserConfig }
})

vi.mock('@/features/statistics/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/statistics/api')>()
  return {
    ...actual,
    getTodayDrops: apiMocks.getTodayDrops,
    getOpenTodayStages: apiMocks.getOpenTodayStages,
  }
})

vi.mock('@/features/training/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/training/api')>()
  return { ...actual, getTrainingQueue: apiMocks.getTrainingQueue }
})

vi.mock('@/features/dashboard/hooks/useDashboardFlowLayout', () => ({
  useDashboardFlowLayout: () => ({
    flowGridRef: { current: null },
    flowCardRef: { current: null },
    flowPreviewRef: { current: null },
    flowGridStyle: undefined,
  }),
}))

vi.mock('@/features/dashboard/components/DashboardPreviewEntry', () => ({
  default: () => <div data-dashboard-preview-card />,
}))
vi.mock('@/features/runtime-status', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/runtime-status')>()
  return { ...actual, FloatingStatusIndicator: () => null }
})
vi.mock('@/shared/components/Icons', () => {
  const Icon = () => null
  return { default: new Proxy({}, { get: () => Icon }) }
})

const createExecutionController = (taskExecutionModule as unknown as {
  __createExecutionController: () => ExecutionController
}).__createExecutionController

let online = true
let container: HTMLDivElement
let root: Root
let client: ReturnType<typeof createQueryClient>
let releaseExecution: (() => void) | null = null
let trackedRunState: AgentRun

const findButton = (text: string) => Array.from(container.querySelectorAll('button'))
  .find(button => button.textContent?.includes(text))

const skeleton = () => container.querySelector('[aria-label="概览加载中"]')

const flowCard = () => container.querySelector('[data-dashboard-flow-card]')

const ok = (data: unknown) => ({ success: true, data })

const activityDto = (overrides: Partial<AutomationActivityPayload> = {}): AutomationActivityPayload => ({
  status: 'active',
  clientType: 'Official',
  available: true,
  message: '当前活动: 测试活动',
  code: 'TEST',
  name: '测试活动',
  source: 'maa',
  startTime: null,
  endTime: null,
  stages: [],
  lastSuccessAt: 1_760_000_000_000,
  dataUpdatedAt: 1_760_000_000_000,
  failure: null,
  completion: {
    known: false,
    complete: false,
    completedStages: [],
    totalStages: 0,
    source: 'local-activity-progress',
  },
  ...overrides,
})

function buildRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: 'run-daily',
    operationId: 'run_daily_flow',
    state: 'running',
    links: {
      self: '/api/agent/runs/run-daily',
      stop: '/api/agent/actions/stop?runId=run-daily',
    },
    ...overrides,
  }
}

function buildSnapshot({
  run = null,
  activeRuns = [],
  lastRun = null,
  occupancy = 'idle',
}: {
  run?: AgentRun | null
  activeRuns?: AgentRun[]
  lastRun?: AgentRun | null
  occupancy?: 'idle' | 'run' | 'external' | 'pending' | 'unknown'
} = {}): RunSnapshot {
  return {
    isRunning: Boolean(run),
    run,
    activeRuns,
    lastRun,
    occupancy: {
      state: occupancy,
      runId: run?.runId ?? null,
      runState: run?.state ?? null,
      sources: occupancy === 'idle' ? [] : ['lease'],
      lease: { state: occupancy === 'idle' ? 'free' : 'held', owner: null },
      task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
      schedule: {
        isRunning: false,
        runId: null,
        currentStep: null,
        totalSteps: 0,
        currentTask: null,
        shouldStop: false,
      },
    },
  }
}

function controller() {
  const current = apiMocks.controllerRef.current
  if (!current) throw new Error('执行控制器尚未创建')
  return current
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function renderDashboard(mode: 'visible' | 'hidden' = 'visible') {
  root.render(
    <QueryClientProvider client={client}><PreviewSessionProvider>
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Activity mode={mode}>
          <Dashboard />
          <LocationProbe />
        </Activity>
      </MemoryRouter>
    </PreviewSessionProvider></QueryClientProvider>,
  )
}

async function flushDashboard() {
  await act(async () => {
    // Query 的观察者通知与协调器收尾都经宏任务批次，等两轮再断言。
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Dashboard connectivity state', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    // Query 的 onlineManager 也监听浏览器在线事件；上一个用例断开网络后
    // 必须恢复在线状态，否则新查询会一直处于暂停。
    window.dispatchEvent(new Event('online'))
    onlineManager.setOnline(true)
    trackedRunState = buildRun({ progress: { currentTask: '收取信用' } })
    apiMocks.getTaskStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getDeviceStats.mockResolvedValue({ success: false })
    apiMocks.getActivity.mockResolvedValue(ok(activityDto()))
    apiMocks.getScheduleExecutionStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getTrainingQueue.mockResolvedValue({ success: true, data: { queue: [] } })
    apiMocks.getTodayDrops.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOpenTodayStages.mockResolvedValue({ success: true, data: { open: [], closed: [] } })
    apiMocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: [{ id: 'startup-1', commandId: 'startup', name: '启动游戏', params: {}, enabled: true }] },
    })
    apiMocks.executeScheduleNow.mockResolvedValue(ok({
      runId: 'run-daily',
      state: 'running',
      accepted: true,
      run: trackedRunState,
    }))
    apiMocks.executionApi.fetchSnapshot.mockImplementation(async () => ok(buildSnapshot()))
    apiMocks.executionApi.fetchRun.mockImplementation(async (runId: string) => ok({ ...trackedRunState, runId }))
    apiMocks.executionApi.stopRun.mockImplementation(async () => ok({
      stopRequested: true,
      deviceStopRequested: true,
      run: { ...trackedRunState, state: 'stopping' },
    }))

    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().applyRunStatus({ phase: 'idle', isRunning: false, runId: null, label: null, detail: null })
    useStatusStore.getState().setBackendStatus('unknown')
    client = createQueryClient()
    releaseExecution = createExecutionController().start()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    releaseExecution?.()
    releaseExecution = null
    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().applyRunStatus({ phase: 'idle', isRunning: false, runId: null, label: null, detail: null })
    useStatusStore.getState().setBackendStatus('unknown')
    vi.clearAllMocks()
  })

  it('uses the full dashboard skeleton only for the first uncached load', async () => {
    let resolveActivity: ((value: { success: boolean; data: AutomationActivityPayload }) => void) | undefined
    apiMocks.getActivity.mockReturnValueOnce(new Promise(resolve => {
      resolveActivity = resolve
    }))

    await act(async () => renderDashboard())

    expect(skeleton()).not.toBeNull()

    await act(async () => resolveActivity?.({ success: true, data: activityDto({ name: '首次活动' }) }))
    await flushDashboard()

    expect(skeleton()).toBeNull()
    expect(container.textContent).toContain('首次活动')
  })

  it('restores a fresh dashboard cache immediately without returning to the skeleton', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '缓存活动' })))

    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('缓存活动')

    await act(async () => root.render(<div>其他页面</div>))
    apiMocks.getActivity.mockClear()
    await act(async () => renderDashboard())

    expect(container.textContent).toContain('缓存活动')
    expect(skeleton()).toBeNull()
    expect(apiMocks.getActivity).not.toHaveBeenCalled()
  })

  it('keeps stale content visible while refreshing it in the background', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '缓存活动' })))

    await act(async () => renderDashboard())
    await flushDashboard()
    useDashboardStore.setState({
      lastRefreshAttemptAt: Date.now() - DASHBOARD_REFRESH_INTERVAL_MS,
    })

    let resolveActivity: ((value: { success: boolean; data: AutomationActivityPayload }) => void) | undefined
    apiMocks.getActivity.mockReturnValueOnce(new Promise(resolve => {
      resolveActivity = resolve
    }))

    await act(async () => root.render(<div>其他页面</div>))
    await act(async () => renderDashboard())

    expect(container.textContent).toContain('缓存活动')
    expect(skeleton()).toBeNull()
    expect(apiMocks.getActivity).toHaveBeenCalledTimes(2)

    await act(async () => resolveActivity?.({ success: true, data: activityDto({ name: '更新活动' }) }))
    await flushDashboard()

    expect(container.textContent).toContain('更新活动')
  })

  it.each(['plan-applied', 'recognition', 'training-queue', 'resource-update'] as const)(
    'refreshes the complete snapshot on a %s resource invalidation',
    async (cause) => {
      await act(async () => renderDashboard())
      await flushDashboard()

      apiMocks.getActivity.mockClear()
      apiMocks.getScheduleExecutionStatus.mockClear()
      apiMocks.getTrainingQueue.mockClear()
      apiMocks.getTodayDrops.mockClear()
      apiMocks.getOpenTodayStages.mockClear()
      apiMocks.getTodayDrops.mockResolvedValueOnce({ success: false, message: '暂时不可用' })
      const lastSuccessfulUpdate = useDashboardStore.getState().lastUpdate

      await act(async () => {
        publishResourceInvalidation({ resources: ['dashboard-snapshot'], cause })
      })
      await flushDashboard()

      expect(apiMocks.getActivity).toHaveBeenCalledTimes(1)
      expect(apiMocks.getScheduleExecutionStatus).toHaveBeenCalledTimes(1)
      expect(apiMocks.getTrainingQueue).toHaveBeenCalledTimes(1)
      expect(apiMocks.getTodayDrops).toHaveBeenCalledTimes(1)
      expect(apiMocks.getOpenTodayStages).toHaveBeenCalledTimes(1)
      expect(useDashboardStore.getState().lastUpdate).toBe(lastSuccessfulUpdate)
    },
  )

  it('refreshes once when a snapshot invalidation was published while Activity was hidden', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()
    apiMocks.getActivity.mockClear()
    apiMocks.getScheduleExecutionStatus.mockClear()
    apiMocks.getTrainingQueue.mockClear()
    apiMocks.getTodayDrops.mockClear()
    apiMocks.getOpenTodayStages.mockClear()
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '恢复活动' })))

    await act(async () => renderDashboard('hidden'))
    await flushDashboard()
    await act(async () => {
      publishResourceInvalidation({ resources: ['dashboard-snapshot'], cause: 'recognition' })
    })
    await flushDashboard()
    // 隐藏期间订阅已注销：不会在后台立即重读。
    expect(apiMocks.getActivity).not.toHaveBeenCalled()

    await act(async () => renderDashboard('visible'))
    await flushDashboard()

    expect(apiMocks.getActivity).toHaveBeenCalledTimes(1)
    expect(apiMocks.getScheduleExecutionStatus).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTrainingQueue).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTodayDrops).toHaveBeenCalledTimes(1)
    expect(apiMocks.getOpenTodayStages).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('恢复活动')
  })

  it('keeps the last complete snapshot when one background request fails', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '已确认活动' })))

    await act(async () => renderDashboard())
    await flushDashboard()
    const lastSuccessfulUpdate = useDashboardStore.getState().lastUpdate
    const persistedSnapshot = window.localStorage.getItem('la-pluma-dashboard-cache')
    useDashboardStore.setState({
      lastRefreshAttemptAt: Date.now() - DASHBOARD_REFRESH_INTERVAL_MS,
    })

    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '未确认活动' })))
    apiMocks.getTodayDrops.mockResolvedValueOnce({ success: false, message: '暂时不可用' })

    await act(async () => root.render(<div>其他页面</div>))
    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('已确认活动')
    expect(container.textContent).not.toContain('未确认活动')
    expect(useDashboardStore.getState().lastUpdate).toBe(lastSuccessfulUpdate)
    expect(window.localStorage.getItem('la-pluma-dashboard-cache')).toBe(persistedSnapshot)
  })

  it('keeps the last complete snapshot when a successful response has malformed data', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '稳定活动' })))

    await act(async () => renderDashboard())
    await flushDashboard()
    const lastSuccessfulUpdate = useDashboardStore.getState().lastUpdate
    const persistedSnapshot = window.localStorage.getItem('la-pluma-dashboard-cache')
    useDashboardStore.setState({
      lastRefreshAttemptAt: Date.now() - DASHBOARD_REFRESH_INTERVAL_MS,
    })

    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '异常活动' })))
    apiMocks.getOpenTodayStages.mockResolvedValueOnce({
      success: true,
      data: { open: [], closed: [{ stage: 'CE-6' }] },
    })

    await act(async () => root.render(<div>其他页面</div>))
    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('稳定活动')
    expect(container.textContent).not.toContain('异常活动')
    expect(useDashboardStore.getState().lastUpdate).toBe(lastSuccessfulUpdate)
    expect(window.localStorage.getItem('la-pluma-dashboard-cache')).toBe(persistedSnapshot)
  })

  it('projects the initial device sample into the dashboard cache', async () => {
    apiMocks.getDeviceStats.mockResolvedValue({ success: true, data: { cpuPct: 42, temp: 38 } })

    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('38°C')
    expect(useDashboardStore.getState().deviceStats?.temp).toBe(38)
    expect(useDashboardStore.getState().temperatureHistory).toEqual([38])
  })

  it('disables execution actions as soon as the browser goes offline', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)

    online = false
    act(() => window.dispatchEvent(new Event('offline')))

    expect(container.textContent).toContain('当前网络离线')
    expect(findButton('开始今日流程')?.disabled).toBe(true)
  })

  it('shows a retry action and recovers after the backend becomes available', async () => {
    apiMocks.getTaskStatus.mockRejectedValueOnce(new Error('无法连接后端服务，请确认服务已启动'))

    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('后端服务不可用')
    expect(container.textContent).toContain('测试活动')
    expect(useDashboardStore.getState().lastUpdate).not.toBeNull()
    expect(findButton('重试连接')).toBeDefined()
    expect(findButton('开始今日流程')?.disabled).toBe(true)

    await act(async () => findButton('重试连接')?.click())
    await flushDashboard()

    expect(container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
  })

  it('omits redundant manual refresh controls', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()

    expect(findButton('刷新数据')).toBeUndefined()
    expect(container.querySelector('button[aria-label="刷新执行状态"]')).toBeNull()
  })

  it('navigates to the destination tab from dashboard shortcuts', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()

    await act(async () => findButton('添加首个培养目标')?.click())
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/app/training')

    await act(async () => findButton('查看掉落数据')?.click())
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/app/statistics?tab=drops')
  })

  it('keeps the preview entry mounted across Activity hide and show', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()
    const preview = container.querySelector('[data-dashboard-preview-card]')
    expect(preview).not.toBeNull()

    await act(async () => renderDashboard('hidden'))
    await flushDashboard()
    expect(container.querySelector('[data-dashboard-preview-card]')).toBe(preview)

    await act(async () => renderDashboard('visible'))
    await flushDashboard()
    expect(container.querySelector('[data-dashboard-preview-card]')).toBe(preview)
    // 恢复时只重建 Effects，不重新走首屏骨架，也不重建预览卡片。
    expect(skeleton()).toBeNull()
    expect(container.querySelectorAll('[data-dashboard-preview-card]')).toHaveLength(1)
  })

  it('activates the status beam for a run projected from the execution snapshot', async () => {
    const activeRun = buildRun({ runId: 'run-external-domain', operationId: 'run_copilot_set' })
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({
      run: activeRun,
      activeRuns: [activeRun],
      occupancy: 'run',
    })))

    await act(async () => controller().refresh())
    await act(async () => renderDashboard())
    await flushDashboard()

    const flow = flowCard()
    expect(flow?.getAttribute('aria-busy')).toBe('true')
    expect(findButton('正在运行')?.disabled).toBe(true)
    expect(useStatusStore.getState().runStatus.phase).toBe('idle')
  })

  it('submits the daily flow once as an async run with a dashboard scope key', async () => {
    let resolveSubmit: ((value: { success: boolean; data: unknown }) => void) | undefined
    apiMocks.executeScheduleNow.mockReturnValueOnce(new Promise(resolve => {
      resolveSubmit = resolve
    }))

    await act(async () => renderDashboard())
    await flushDashboard()

    apiMocks.getActivity.mockClear()
    apiMocks.getScheduleExecutionStatus.mockClear()
    apiMocks.getTrainingQueue.mockClear()
    apiMocks.getTodayDrops.mockClear()
    apiMocks.getOpenTodayStages.mockClear()

    const action = findButton('开始今日流程')
    await act(async () => {
      action?.click()
      action?.click()
      await Promise.resolve()
    })

    expect(apiMocks.executeScheduleNow).toHaveBeenCalledTimes(1)
    const [scheduleId, flow, options] = apiMocks.executeScheduleNow.mock.calls[0]!
    expect(scheduleId).toBe('dashboard-quick-start')
    expect(flow).toEqual([{ id: 'startup-1', commandId: 'startup', name: '启动游戏', params: {}, enabled: true }])
    expect(options.waitForCompletion).toBe(false)
    expect(options.idempotencyKey).toMatch(/^run_daily_flow-/)
    expect(findButton('启动中')?.disabled).toBe(true)

    await act(async () => resolveSubmit?.(ok({
      runId: 'run-daily',
      state: 'running',
      accepted: true,
      run: trackedRunState,
    })))
    await flushDashboard()

    expect(container.querySelector('[data-dashboard-flow-feedback]')?.textContent).toBe('今日流程已开始执行')
    expect(findButton('正在运行')?.disabled).toBe(true)
    expect(controller().getState().trackedScope).toBe('dashboard')
    expect(apiMocks.getActivity).toHaveBeenCalledTimes(1)
    expect(apiMocks.getScheduleExecutionStatus).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTrainingQueue).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTodayDrops).toHaveBeenCalledTimes(1)
    expect(apiMocks.getOpenTodayStages).toHaveBeenCalledTimes(1)
  })

  it('navigates to automation when the saved daily flow is empty', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()
    apiMocks.loadUserConfig.mockResolvedValueOnce({ success: true, data: { taskFlow: [] } })

    await act(async () => findButton('开始今日流程')?.click())
    await flushDashboard()

    expect(container.querySelector('[data-dashboard-flow-feedback]')?.textContent)
      .toBe('还没有配置今日流程，先去日常页保存任务流。')
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/app/automation')
    expect(apiMocks.executeScheduleNow).not.toHaveBeenCalled()
  })

  it('observes the accepted daily flow until its terminal state', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()

    await act(async () => findButton('开始今日流程')?.click())
    await flushDashboard()
    expect(container.textContent).toContain('正在执行: 收取信用')

    const terminalRun = buildRun({
      state: 'succeeded',
      result: { message: '今日流程执行完成', summary: { successCount: 2, failedCount: 0, skippedCount: 0, durationMs: 1000 } },
    })
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({
      lastRun: terminalRun,
      occupancy: 'idle',
    })))
    await act(async () => controller().refresh())
    await flushDashboard()

    expect(useStatusStore.getState().message).toBe('今日流程执行完成')
    expect(useStatusStore.getState().messageType).toBe('success')
    expect(container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
  })

  it('lets another domain stop the dashboard run while keeping the global state consistent', async () => {
    await act(async () => renderDashboard())
    await flushDashboard()
    await act(async () => findButton('开始今日流程')?.click())
    await flushDashboard()
    expect(findButton('正在运行')?.disabled).toBe(true)

    // 另一个页面通过共享控制器按 runId 停止；Dashboard 只是观察者，不再发送第二次停止。
    trackedRunState = buildRun({ state: 'stopping' })
    await act(async () => {
      await controller().stopTrackedRun()
    })
    await flushDashboard()
    expect(apiMocks.executionApi.stopRun).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('正在停止')

    const stoppedRun = buildRun({ state: 'stopped', result: { message: '今日流程已停止' } })
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({ lastRun: stoppedRun })))
    await act(async () => controller().refresh())
    await flushDashboard()

    expect(useStatusStore.getState().message).toBe('今日流程已停止')
    expect(useStatusStore.getState().messageType).toBe('warning')
    expect(container.textContent).toContain('准备就绪')
  })

  it('does not claim a run started by another domain as the dashboard flow', async () => {
    const foreignRun = buildRun({ runId: 'run-automation', operationId: 'run_daily_flow' })
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({
      run: foreignRun,
      activeRuns: [foreignRun],
      occupancy: 'run',
    })))
    await act(async () => controller().refresh())

    await act(async () => renderDashboard())
    await flushDashboard()
    expect(container.textContent).toContain('任务执行中')
    expect(findButton('正在运行')?.disabled).toBe(true)

    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot()))
    await act(async () => controller().refresh())
    await flushDashboard()

    expect(useStatusStore.getState().message).toBe('')
    expect(container.textContent).toContain('准备就绪')
  })

  it('reports unmanaged device occupancy and keeps the start entries disabled', async () => {
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({ occupancy: 'external' })))
    await act(async () => controller().refresh())

    await act(async () => renderDashboard())
    await flushDashboard()

    expect(container.textContent).toContain('设备被其他任务占用')
    expect(findButton('开始今日流程')?.disabled).toBe(true)
  })

  it('keeps the unknown phase and the last active run when observation disconnects', async () => {
    const activeRun = buildRun()
    apiMocks.executionApi.fetchSnapshot.mockResolvedValue(ok(buildSnapshot({
      run: activeRun,
      activeRuns: [activeRun],
      occupancy: 'run',
    })))
    await act(async () => controller().refresh())

    await act(async () => renderDashboard())
    await flushDashboard()

    apiMocks.executionApi.fetchSnapshot.mockRejectedValue(new Error('网络中断'))
    await act(async () => controller().refresh())
    await flushDashboard()

    expect(container.textContent).toContain('执行状态未知')
    expect(container.textContent).toContain('网络中断')
    expect(findButton('开始今日流程')?.disabled).toBe(true)
    expect(useStatusStore.getState().message).toBe('')
  })

  it('shows a distinct first-load activity failure and recovers through retry', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({ success: false, message: '活动服务不可用' })

    await act(async () => renderDashboard())
    await flushDashboard()

    const failed = container.querySelector('[data-activity-status="unavailable"]')
    expect(failed?.textContent).toContain('活动数据加载失败')
    expect(failed?.textContent).toContain('活动服务不可用')
    expect(failed?.textContent).not.toContain('暂无')
    expect(useDashboardStore.getState().lastRefreshError).toBe('活动服务不可用')

    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '恢复活动' })))
    const retry = Array.from(failed?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('重试'))
    await act(async () => retry?.click())
    await flushDashboard()

    expect(apiMocks.getActivity).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-activity-status="active"]')?.textContent)
      .toContain('恢复活动')
    expect(useDashboardStore.getState().lastRefreshError).toBeNull()
  })

  it('renders a confirmed empty activity without the old fixed loading copy', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({
      status: 'none',
      available: false,
      code: null,
      name: null,
      source: 'maa',
      message: '当前没有刷关活动',
      completion: undefined,
    })))

    await act(async () => renderDashboard())
    await flushDashboard()

    const empty = container.querySelector('[data-activity-status="none"]')
    expect(empty?.textContent).toContain('暂无当前刷关活动')
    expect(empty?.textContent).toContain('官服 · MAA 活动表')
    expect(container.textContent).not.toContain('暂无活动')
    expect(container.textContent).not.toContain('等待活动数据')
  })

  it('renders an active activity name and source without a tip field', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({
      name: '昨日海',
      code: 'YW',
      source: 'penguin',
      dataUpdatedAt: 1_760_000_100_000,
    })))

    await act(async () => renderDashboard())
    await flushDashboard()

    const active = container.querySelector('[data-activity-status="active"]')
    expect(active?.textContent).toContain('昨日海')
    expect(active?.textContent).toContain('官服 · 企鹅物流')
    expect(active?.textContent).toContain('更新于')
    expect(container.textContent).not.toContain('等待活动数据')
  })

  it('keeps the last active activity and marks it stale when a later refresh fails', async () => {
    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '已确认活动' })))

    await act(async () => renderDashboard())
    await flushDashboard()
    useDashboardStore.setState({
      lastRefreshAttemptAt: Date.now() - DASHBOARD_REFRESH_INTERVAL_MS,
    })

    apiMocks.getActivity.mockResolvedValueOnce(ok(activityDto({ name: '未确认活动' })))
    apiMocks.getTodayDrops.mockResolvedValueOnce({ success: false, message: '暂时不可用' })

    await act(async () => root.render(<div>其他页面</div>))
    await act(async () => renderDashboard())
    await flushDashboard()

    const stale = container.querySelector('[data-activity-status="stale"]')
    expect(stale?.textContent).toContain('已确认活动')
    expect(stale?.textContent).toContain('可能已过期')
    expect(stale?.textContent).toContain('上次成功')
    expect(stale?.textContent).toContain('暂时不可用')
    expect(stale?.textContent).not.toContain('未确认活动')
    expect(stale?.querySelector('button')?.textContent).toContain('重试')
  })

  it('refreshes a restored v1 cache immediately when the activity status is missing', async () => {
    const now = Date.now()
    useDashboardStore.setState({
      hasLoaded: true,
      lastUpdate: now,
      lastRefreshAttemptAt: now,
      activitySummary: {
        available: true,
        code: 'OLD',
        name: '旧活动',
        completion: { known: false, complete: false, completedStages: [], totalStages: 0 },
      },
    })

    await act(async () => renderDashboard())
    await flushDashboard()

    expect(skeleton()).toBeNull()
    expect(apiMocks.getActivity).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('测试活动')
  })
})
