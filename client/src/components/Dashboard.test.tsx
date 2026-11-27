// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardStore } from '@/state'
import { useStatusStore } from '@/state'
import Dashboard, { DASHBOARD_REFRESH_INTERVAL_MS } from './Dashboard'

const apiMocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  getDeviceStats: vi.fn(),
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  executeScheduleNow: vi.fn(),
  getActivityCopilotCandidates: vi.fn(),
  getTrainingQueue: vi.fn(),
  getTodayDrops: vi.fn(),
  getOpenTodayStages: vi.fn(),
}))
const uiMocks = vi.hoisted(() => ({
  setActiveTab: vi.fn(),
  setStatisticsTab: vi.fn(),
  setCombatCopilotPrefill: vi.fn(),
}))
const renderSpies = vi.hoisted(() => ({
  dashboardSkeleton: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: apiMocks.getTaskStatus,
    getDeviceStats: apiMocks.getDeviceStats,
    getActivity: apiMocks.getActivity,
    getScheduleExecutionStatus: apiMocks.getScheduleExecutionStatus,
    loadUserConfig: apiMocks.loadUserConfig,
    executeScheduleNow: apiMocks.executeScheduleNow,
    getActivityCopilotCandidates: apiMocks.getActivityCopilotCandidates,
    getErrorMessage: (result?: { message?: string; error?: string }) => result?.message || result?.error || '未知错误',
  },
  getTrainingQueue: apiMocks.getTrainingQueue,
  getTodayDrops: apiMocks.getTodayDrops,
  getOpenTodayStages: apiMocks.getOpenTodayStages,
}))

vi.mock('@/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/state')>()),
  useUIStore: (selector: (state: {
    setActiveTab: () => void
    setStatisticsTab: () => void
    setCombatCopilotPrefill: () => void
  }) => unknown) => selector({
    setActiveTab: uiMocks.setActiveTab,
    setStatisticsTab: uiMocks.setStatisticsTab,
    setCombatCopilotPrefill: uiMocks.setCombatCopilotPrefill,
  }),
}))

vi.mock('../hooks/useDashboardFlowLayout', () => ({
  useDashboardFlowLayout: () => ({
    flowGridRef: { current: null },
    flowCardRef: { current: null },
    flowPreviewRef: { current: null },
    flowGridStyle: undefined,
  }),
}))

vi.mock('./DashboardPreviewEntry', () => ({ default: () => <div>preview</div> }))
vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./Icons', () => {
  const Icon = () => null
  return { default: new Proxy({}, { get: () => Icon }) }
})
vi.mock('./common/Loading', () => ({
  DashboardSkeleton: () => {
    renderSpies.dashboardSkeleton()
    return <div>loading</div>
  },
}))
vi.mock('./common', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  ActivityIndicator: () => null,
  GlassLiveCardButton: ({ children, icon: _icon, ...props }: { children?: React.ReactNode; icon?: React.ReactNode } & React.ComponentProps<'button'>) => <button type="button" {...props}>{children}</button>,
  CjkText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TruncatedText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Modal: ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title?: string; children: React.ReactNode }) => (
    isOpen
      ? (
        <div role="dialog" aria-label={title}>
          <button type="button" aria-label="关闭对话框" onClick={onClose}>关闭</button>
          {children}
        </div>
      )
      : null
  ),
  SmoothPanel: ({
    children,
    className = '',
    cornerSize: _cornerSize,
    surfaceClassName = '',
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { cornerSize?: string; surfaceClassName?: string }) => (
    <div className={`smooth-panel-shell ${className}`} {...props}>
      <div className={`smooth-panel-surface ${surfaceClassName}`}>{children}</div>
    </div>
  ),
  Button: ({ children, icon: _icon, loading, loadingText, statusKey: _statusKey, variant: _variant, size: _size, className: _className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; loadingText?: React.ReactNode; statusKey?: string; variant?: string; size?: string; icon?: React.ReactNode }) => (
    <button {...props}>{loading ? loadingText : children}</button>
  ),
  IconButton: ({ icon: _icon, variant: _variant, size: _size, tooltip: _tooltip, tooltipSide: _tooltipSide, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; variant?: string; size?: string; tooltip?: string; tooltipSide?: string }) => <button {...props} />,
}))

let online = true
let view: RenderResult

const mountDashboard = () => {
  view = render(<Dashboard />)
  return view
}

const findButton = (text: string) => (screen.queryAllByRole('button') as HTMLButtonElement[])
  .find(button => button.textContent?.includes(text))

const findActivityMetric = () => Array.from(view.container.querySelectorAll('.dashboard-flow-metric'))
  .find(metric => metric.textContent?.includes('当前活动'))

async function waitForDashboardReady() {
  await waitFor(() => expect(view.container.textContent).toContain('准备就绪'))
}

afterEach(cleanup)

describe('Dashboard connectivity state', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    apiMocks.getTaskStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getDeviceStats.mockResolvedValue({ success: false })
    apiMocks.getActivity.mockResolvedValue({ success: true, data: { available: true, name: '测试活动' } })
    apiMocks.getScheduleExecutionStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getTrainingQueue.mockResolvedValue({ success: true, data: { queue: [] } })
    apiMocks.getTodayDrops.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOpenTodayStages.mockResolvedValue({ success: true, data: { open: [], closed: [] } })
    apiMocks.getActivityCopilotCandidates.mockResolvedValue({ success: true, data: { matchingSet: null, matchingSets: [], reason: '没有可用作业集' } })
    uiMocks.setActiveTab.mockReset()
    uiMocks.setStatisticsTab.mockReset()
    uiMocks.setCombatCopilotPrefill.mockReset()
    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().setBackendStatus('unknown')
    window.localStorage.setItem('onboarding-seen-at', '1')
  })

  afterEach(() => {
    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().setBackendStatus('unknown')
    window.localStorage.removeItem('onboarding-seen-at')
    vi.clearAllMocks()
  })

  it('uses the full dashboard skeleton only for the first uncached load', async () => {
    let resolveActivity: ((value: { success: boolean; data: { available: boolean; name: string } }) => void) | undefined
    apiMocks.getActivity.mockReturnValueOnce(new Promise(resolve => {
      resolveActivity = resolve
    }))

    mountDashboard()

    expect(view.container.textContent).toContain('loading')
    expect(renderSpies.dashboardSkeleton).toHaveBeenCalled()

    resolveActivity?.({ success: true, data: { available: true, name: '首次活动' } })
    await waitFor(() => expect(view.container.textContent).toContain('首次活动'))

    expect(view.container.textContent).not.toContain('loading')
  })

  it('restores a fresh dashboard cache immediately without returning to the skeleton', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '缓存活动' } })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('缓存活动'))
    const skeletonRenders = renderSpies.dashboardSkeleton.mock.calls.length

    view.rerender(<div>其他页面</div>)
    apiMocks.getActivity.mockClear()
    view.rerender(<Dashboard />)

    expect(view.container.textContent).toContain('缓存活动')
    expect(view.container.textContent).not.toContain('loading')
    expect(renderSpies.dashboardSkeleton).toHaveBeenCalledTimes(skeletonRenders)
    expect(apiMocks.getActivity).not.toHaveBeenCalled()
  })

  it('keeps stale content visible while refreshing it in the background', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '缓存活动' } })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('缓存活动'))
    useDashboardStore.setState({
      lastRefreshAttemptAt: Date.now() - DASHBOARD_REFRESH_INTERVAL_MS,
    })

    let resolveActivity: ((value: { success: boolean; data: { available: boolean; name: string } }) => void) | undefined
    apiMocks.getActivity.mockReturnValueOnce(new Promise(resolve => {
      resolveActivity = resolve
    }))
    const skeletonRenders = renderSpies.dashboardSkeleton.mock.calls.length

    view.rerender(<div>其他页面</div>)
    view.rerender(<Dashboard />)

    expect(view.container.textContent).toContain('缓存活动')
    expect(view.container.textContent).not.toContain('loading')
    expect(renderSpies.dashboardSkeleton).toHaveBeenCalledTimes(skeletonRenders)
    await waitFor(() => expect(apiMocks.getActivity).toHaveBeenCalledTimes(2))

    resolveActivity?.({ success: true, data: { available: true, name: '更新活动' } })
    await waitFor(() => expect(view.container.textContent).toContain('更新活动'))
  })

  it('keeps the last complete snapshot when one background request fails', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '已确认活动' } })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('已确认活动'))
    const lastSuccessfulUpdate = useDashboardStore.getState().lastUpdate
    const persistedSnapshot = window.localStorage.getItem('la-pluma-dashboard-cache')
    const staleRefreshAttempt = Date.now() - DASHBOARD_REFRESH_INTERVAL_MS
    useDashboardStore.setState({
      lastRefreshAttemptAt: staleRefreshAttempt,
    })

    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '未确认活动' } })
    apiMocks.getTodayDrops.mockResolvedValueOnce({ success: false, message: '暂时不可用' })

    view.rerender(<div>其他页面</div>)
    view.rerender(<Dashboard />)
    await waitFor(() => expect(useDashboardStore.getState().lastRefreshAttemptAt).not.toBe(staleRefreshAttempt))

    expect(view.container.textContent).toContain('已确认活动')
    expect(view.container.textContent).not.toContain('未确认活动')
    expect(useDashboardStore.getState().lastUpdate).toBe(lastSuccessfulUpdate)
    expect(window.localStorage.getItem('la-pluma-dashboard-cache')).toBe(persistedSnapshot)
  })

  it('keeps the last complete snapshot when a successful response has malformed data', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '稳定活动' } })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('稳定活动'))
    const lastSuccessfulUpdate = useDashboardStore.getState().lastUpdate
    const persistedSnapshot = window.localStorage.getItem('la-pluma-dashboard-cache')
    const staleRefreshAttempt = Date.now() - DASHBOARD_REFRESH_INTERVAL_MS
    useDashboardStore.setState({
      lastRefreshAttemptAt: staleRefreshAttempt,
    })

    apiMocks.getActivity.mockResolvedValueOnce({ success: true, data: { available: true, name: '异常活动' } })
    apiMocks.getOpenTodayStages.mockResolvedValueOnce({ success: true, data: undefined })

    view.rerender(<div>其他页面</div>)
    view.rerender(<Dashboard />)
    await waitFor(() => expect(useDashboardStore.getState().lastRefreshAttemptAt).not.toBe(staleRefreshAttempt))

    expect(view.container.textContent).toContain('稳定活动')
    expect(view.container.textContent).not.toContain('异常活动')
    expect(useDashboardStore.getState().lastUpdate).toBe(lastSuccessfulUpdate)
    expect(window.localStorage.getItem('la-pluma-dashboard-cache')).toBe(persistedSnapshot)
  })

  it('shows the remaining activity time instead of waiting', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({
      success: true,
      data: {
        available: true,
        code: 'TL',
        name: '时间啊，向前！',
        endTime: Date.now() + 3 * 24 * 60 * 60 * 1000,
      },
    })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('时间啊，向前！'))

    const activityMetric = findActivityMetric()
    expect(activityMetric?.textContent).toContain('时间啊，向前！')
    expect(activityMetric?.textContent).toContain('剩余 3 天')
    expect(activityMetric?.textContent).not.toContain('等待活动数据')
  })

  it('shows activity time progress when the activity window is known', async () => {
    const now = Date.now()
    apiMocks.getActivity.mockResolvedValueOnce({
      success: true,
      data: {
        available: true,
        code: 'TL',
        name: '时间啊，向前！',
        startTime: now - 2 * 24 * 60 * 60 * 1000,
        endTime: now + 3 * 24 * 60 * 60 * 1000,
        completion: {
          known: true,
          complete: false,
          completedStages: ['TL-1', 'TL-2'],
          totalStages: 8,
        },
      },
    })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('时间啊，向前！'))

    const activityMetric = findActivityMetric()
    expect(activityMetric?.textContent).toContain('剩余 3 天')
    expect(activityMetric?.textContent).not.toContain('2/8')
    const progressbar = activityMetric?.querySelector('[role="progressbar"]')
    expect(progressbar?.getAttribute('aria-label')).toBe('当前活动剩余时间')
    const remainingPercent = Number(progressbar?.getAttribute('aria-valuenow'))
    expect(remainingPercent).toBeGreaterThan(55)
    expect(remainingPercent).toBeLessThan(65)
    expect(progressbar?.getAttribute('aria-valuetext')).toContain('剩余 3 天')
  })

  it('does not show waiting when an activity is available without a known window', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({
      success: true,
      data: { available: true, code: 'TL', name: '时间啊，向前！' },
    })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('时间啊，向前！'))

    const activityMetric = findActivityMetric()
    expect(activityMetric?.textContent).toContain('时间啊，向前！')
    expect(activityMetric?.textContent).toContain('活动进行中')
    expect(activityMetric?.textContent).not.toContain('等待活动数据')
  })

  it('shows completion progress when the activity window is unknown', async () => {
    apiMocks.getActivity.mockResolvedValueOnce({
      success: true,
      data: {
        available: true,
        code: 'TL',
        name: '时间啊，向前！',
        completion: {
          known: true,
          complete: false,
          completedStages: ['TL-9'],
          totalStages: 3,
        },
      },
    })

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('时间啊，向前！'))

    const activityMetric = findActivityMetric()
    expect(activityMetric?.textContent).toContain('已通关 1/3 关')
    expect(activityMetric?.textContent).not.toContain('等待活动数据')
    const progressbar = activityMetric?.querySelector('[role="progressbar"]')
    expect(progressbar?.getAttribute('aria-label')).toBe('当前活动通关进度')
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('33')
  })

  it('disables execution actions as soon as the browser goes offline', async () => {
    mountDashboard()
    await waitForDashboardReady()

    expect(view.container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
    expect(findButton('打当前活动')?.disabled).toBe(false)

    online = false
    fireEvent(window, new Event('offline'))

    expect(view.container.textContent).toContain('当前网络离线')
    expect(findButton('开始今日流程')?.disabled).toBe(true)
    expect(findButton('打当前活动')?.disabled).toBe(true)
  })

  it('shows a retry action and recovers after the backend becomes available', async () => {
    apiMocks.getTaskStatus.mockRejectedValueOnce(new Error('无法连接后端服务，请确认服务已启动'))

    mountDashboard()
    await waitFor(() => expect(view.container.textContent).toContain('后端服务不可用'))

    expect(view.container.textContent).toContain('测试活动')
    expect(useDashboardStore.getState().lastUpdate).not.toBeNull()
    const retryButton = findButton('重试连接')
    expect(retryButton).toBeDefined()
    expect(findButton('开始今日流程')?.disabled).toBe(true)
    expect(findButton('打当前活动')?.disabled).toBe(true)

    await userEvent.setup().click(retryButton!)
    await waitForDashboardReady()

    expect(view.container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
    expect(findButton('打当前活动')?.disabled).toBe(false)
  })

  it('omits redundant manual refresh controls', async () => {
    mountDashboard()
    await waitForDashboardReady()

    expect(findButton('刷新数据')).toBeUndefined()
    expect(view.container.querySelector('.dashboard-mobile-refresh')).toBeNull()
    expect(view.container.querySelector('button[aria-label="刷新执行状态"]')).toBeNull()
  })

  it('keeps empty summary actions at the iOS touch target size', async () => {
    mountDashboard()
    await waitForDashboardReady()

    const emptyActions = [findButton('添加首个培养目标'), findButton('查看掉落数据')]
    emptyActions.forEach(action => {
      expect(action?.classList.contains('dashboard-summary-link')).toBe(true)
      expect(action?.classList.contains('min-h-11')).toBe(true)
      expect(action?.closest('.dashboard-summary-footer')?.classList.contains('is-action')).toBe(true)
    })
  })

  it('activates the status beam while the daily flow is running', async () => {
    apiMocks.getScheduleExecutionStatus.mockResolvedValueOnce({
      success: true,
      data: { isRunning: true, currentTask: '收取信用' },
    })

    mountDashboard()
    await waitFor(() => expect(
      view.container.querySelector('.dashboard-flow-glow-shell')?.classList.contains('is-active'),
    ).toBe(true))

    const flow = view.container.querySelector('.dashboard-flow-glow-shell')
    expect(flow?.classList.contains('status-border-beam')).toBe(true)
    expect(flow?.classList.contains('is-active')).toBe(true)
    expect(flow?.getAttribute('aria-busy')).toBe('true')
  })

  it('hands the current activity set to the combat workspace without executing it', async () => {
    let resolveCandidates: ((value: {
      success: boolean
      data: { matchingSet: { id: string; name: string }; matchingSets: unknown[] }
    }) => void) | undefined
    apiMocks.getActivityCopilotCandidates.mockReturnValueOnce(new Promise(resolve => {
      resolveCandidates = resolve
    }))

    mountDashboard()
    await waitForDashboardReady()

    const activityButton = view.container.querySelector<HTMLButtonElement>('button[aria-label="打当前活动"]')
    expect(activityButton).not.toBeNull()
    await userEvent.setup().click(activityButton!)

    const flow = view.container.querySelector('.dashboard-flow-glow-shell')
    const status = useStatusStore.getState()
    expect(apiMocks.getActivityCopilotCandidates).toHaveBeenCalledTimes(1)
    expect(activityButton?.disabled).toBe(true)
    expect(activityButton?.textContent).toContain('准备中')
    expect(flow?.classList.contains('is-active')).toBe(true)
    expect(flow?.getAttribute('aria-busy')).toBe('true')
    expect(status.isActive).toBe(true)
    expect(status.message).toContain('当前活动')
    expect(status.messageType).toBe('info')

    resolveCandidates?.({
      success: true,
      data: {
        matchingSet: { id: '56877', name: '时间啊，向前！全关卡作业' },
        matchingSets: [],
      },
    })
    await waitFor(() => expect(useStatusStore.getState().message).toContain('立即执行'))

    expect(uiMocks.setCombatCopilotPrefill).toHaveBeenCalledWith(expect.objectContaining({
      setId: '56877',
      name: '时间啊，向前！全关卡作业',
    }))
    expect(uiMocks.setActiveTab).toHaveBeenCalledWith('combat')
  })

  it('hands off per-stage activity candidates when no set is available', async () => {
    apiMocks.getActivityCopilotCandidates.mockResolvedValueOnce({
      success: true,
      data: {
        state: 'candidates-ready',
        matchingSet: null,
        matchingSets: [],
        stages: [{ stage: 'TL-1', candidates: [{ id: 101 }] }],
        reason: '已按当前活动的明确关卡代号找到候选作业',
      },
    })

    mountDashboard()
    await waitForDashboardReady()
    await userEvent.setup().click(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="打当前活动"]')!,
    )
    await waitFor(() => expect(useStatusStore.getState().message).toContain('逐关'))

    expect(uiMocks.setCombatCopilotPrefill).toHaveBeenCalledWith(expect.objectContaining({
      fallback: true,
      activityName: expect.any(String),
    }))
    expect(uiMocks.setActiveTab).toHaveBeenCalledWith('combat')
  })

  it('surfaces the exact activity preflight blocker as a warning and leaves the active state', async () => {
    const blocker = 'AD「红丝绒」的资源未包含从主页进入活动关卡的完整导航链。'
    apiMocks.getActivityCopilotCandidates.mockResolvedValueOnce({
      success: true,
      data: {
        matchingSet: null,
        matchingSets: [],
        reason: blocker,
      },
    })

    mountDashboard()
    await waitForDashboardReady()
    await userEvent.setup().click(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="打当前活动"]')!,
    )
    await waitFor(() => expect(
      view.container.querySelector('[data-dashboard-flow-feedback]')?.textContent,
    ).toBe(blocker))

    const flow = view.container.querySelector('.dashboard-flow-glow-shell')
    const feedback = view.container.querySelector('[data-dashboard-flow-feedback]')
    const status = useStatusStore.getState()
    expect(feedback?.textContent).toBe(blocker)
    expect(status.message).toBe(blocker)
    expect(status.messageType).toBe('warning')
    expect(status.isActive).toBe(false)
    expect(flow?.classList.contains('is-active')).toBe(false)
    expect(flow?.getAttribute('aria-busy')).toBe('false')
  })
})


describe('Dashboard drop summary navigation', () => {
  beforeEach(async () => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
    apiMocks.getTaskStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getDeviceStats.mockResolvedValue({ success: false })
    apiMocks.getActivity.mockResolvedValue({ success: true, data: { available: false } })
    apiMocks.getScheduleExecutionStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getTrainingQueue.mockResolvedValue({ success: true, data: { queue: [] } })
    apiMocks.getTodayDrops.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOpenTodayStages.mockResolvedValue({ success: true, data: { open: [], closed: [] } })
    apiMocks.getActivityCopilotCandidates.mockResolvedValue({ success: true, data: { matchingSets: [] } })
    uiMocks.setActiveTab.mockReset()
    uiMocks.setStatisticsTab.mockReset()
    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().setBackendStatus('unknown')
    window.localStorage.setItem('onboarding-seen-at', '1')
    mountDashboard()
    await waitForDashboardReady()
  })

  afterEach(() => {
    window.localStorage.removeItem('onboarding-seen-at')
  })

  it('opens the drops tab instead of the default statistics tab', async () => {
    const open = view.container.querySelector<HTMLButtonElement>('button[aria-label="打开掉落记录"]')
    expect(open).not.toBeNull()
    await userEvent.setup().click(open!)
    expect(uiMocks.setStatisticsTab).toHaveBeenCalledWith('drops')
    expect(uiMocks.setActiveTab).toHaveBeenCalledWith('statistics')
  })
})

describe('Dashboard onboarding', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
    apiMocks.getTaskStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getDeviceStats.mockResolvedValue({ success: false })
    apiMocks.getActivity.mockResolvedValue({ success: true, data: { available: false } })
    apiMocks.getScheduleExecutionStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getTrainingQueue.mockResolvedValue({ success: true, data: { queue: [] } })
    apiMocks.getTodayDrops.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOpenTodayStages.mockResolvedValue({ success: true, data: { open: [], closed: [] } })
    apiMocks.getActivityCopilotCandidates.mockResolvedValue({ success: true, data: { matchingSets: [] } })
    uiMocks.setActiveTab.mockReset()
    uiMocks.setStatisticsTab.mockReset()
    useDashboardStore.getState().reset()
    useStatusStore.getState().clearMessage()
    useStatusStore.getState().setActive(false)
    useStatusStore.getState().setBackendStatus('unknown')
    window.localStorage.removeItem('onboarding-seen-at')
  })

  afterEach(() => {
    useDashboardStore.getState().reset()
    window.localStorage.removeItem('onboarding-seen-at')
    vi.clearAllMocks()
  })

  const renderDashboard = async () => {
    mountDashboard()
    await waitForDashboardReady()
  }

  const getOnboardingDialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

  it('shows the onboarding dialog on the first dashboard visit', async () => {
    await renderDashboard()

    expect(getOnboardingDialog()).not.toBeNull()
    expect(getOnboardingDialog()?.getAttribute('aria-label')).toBe('新手引导')
    expect(getOnboardingDialog()?.textContent).toContain('创建第一个自动化任务')
  })

  it('writes onboarding-seen-at when the dialog is closed', async () => {
    await renderDashboard()
    expect(window.localStorage.getItem('onboarding-seen-at')).toBeNull()

    await userEvent.setup().click(within(getOnboardingDialog()!).getByRole('button', { name: '关闭对话框' }))

    expect(getOnboardingDialog()).toBeNull()
    const seenAt = Number(window.localStorage.getItem('onboarding-seen-at'))
    expect(seenAt).toBeGreaterThan(0)
  })

  it('does not auto-show after closing and mounting the dashboard again', async () => {
    await renderDashboard()
    await userEvent.setup().click(within(getOnboardingDialog()!).getByRole('button', { name: '关闭对话框' }))

    view.rerender(<div>其他页面</div>)
    view.rerender(<Dashboard />)
    await waitForDashboardReady()

    expect(getOnboardingDialog()).toBeNull()
  })

  it('reopens from the PageHeader entry regardless of the seen marker', async () => {
    window.localStorage.setItem('onboarding-seen-at', String(Date.now()))
    await renderDashboard()

    expect(getOnboardingDialog()).toBeNull()

    const entry = view.container.querySelector<HTMLButtonElement>('button[aria-label="新手引导"]')
    expect(entry).not.toBeNull()
    await userEvent.setup().click(entry!)

    expect(getOnboardingDialog()).not.toBeNull()
    expect(getOnboardingDialog()?.getAttribute('aria-label')).toBe('新手引导')
  })
})
