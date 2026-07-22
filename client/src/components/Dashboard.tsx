import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Bot, CalendarDays, CheckCircle2, ChevronRight, Cpu, HardDrive, Database, PackageOpen, Play, ServerOff, Target, Thermometer, WifiOff } from 'lucide-react'
import { getOpenTodayStages, getTodayDrops, getTrainingQueue, maaApi } from '../services/api'
import Icons from './Icons'
import { PageHeader, Card, Button, IconButton, SmoothPanel } from './common'
import { DashboardSkeleton } from './common/Loading'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useUIStore } from '@/stores'
import { useDashboardFlowLayout } from '../hooks/useDashboardFlowLayout'
import DashboardPreviewEntry from './DashboardPreviewEntry'
import { formatExecutionSummary, getExecutionLastTask } from '../utils/executionSummary'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useStatusStore } from '../store/statusStore'
import { useDashboardStore, type DashboardSnapshot } from '../store/dashboardStore'
import { probeBackendAvailability } from '../hooks/useBackendStatusMonitor'

const sectionTitleClass = 'text-base font-bold text-primary'
const labelClass = 'text-secondary'
const progressTrackClass = 'h-1.5 rounded-full bg-[var(--app-surface-muted)] overflow-hidden'
const dashboardChipClass = 'brand-chip rounded-lg px-2.5 py-1 text-xs font-medium'
const mutedChipClass = 'rounded-lg px-2.5 py-1 surface-soft text-secondary text-xs'
export const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000

const getUsageBarClass = (pct?: number) => {
  if (pct == null) return 'bg-[var(--app-accent)]'
  if (pct >= 90) return 'bg-[var(--app-danger)]'
  if (pct >= 75) return 'bg-[var(--app-warning)]'
  return 'bg-[var(--app-accent)]'
}

const getUsageValueClass = (pct?: number) => {
  if (pct == null) return 'text-primary'
  if (pct >= 90) return 'text-[var(--app-danger)]'
  if (pct >= 75) return 'text-[var(--app-warning)]'
  return 'text-primary'
}

const TemperatureSparkline = ({ values }: { values: number[] }) => {
  const chartValues = values.length > 1 ? values : values.length === 1 ? [values[0]!, values[0]!] : []
  if (chartValues.length === 0) {
    return <div className="dashboard-temperature-empty">等待温度采样</div>
  }

  const min = Math.min(...chartValues)
  const max = Math.max(...chartValues)
  const isStable = max - min < 0.1
  const chartMin = isStable ? min - 1 : min
  const chartMax = isStable ? max + 1 : max
  const spread = chartMax - chartMin
  const points = chartValues.map((value, index) => {
    const x = chartValues.length === 1 ? 0 : (index / (chartValues.length - 1)) * 100
    const y = 25 - ((value - chartMin) / spread) * 18
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const areaPoints = `0,28 ${points} 100,28`
  const lastPoint = points.split(' ').slice(-1)[0]?.split(',')

  return (
    <div className="dashboard-temperature-chart" aria-label={`最近温度 ${min.toFixed(1)} 到 ${max.toFixed(1)} 摄氏度`}>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="dashboard-temperature-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--app-accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--app-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="14" x2="100" y2="14" className="dashboard-temperature-gridline" />
        <polygon points={areaPoints} fill="url(#dashboard-temperature-fill)" />
        <polyline points={points} className="dashboard-temperature-line" />
        <circle cx={lastPoint?.[0]} cy={lastPoint?.[1]} r="1.6" className="dashboard-temperature-dot" />
      </svg>
      <div className="dashboard-temperature-range">
        <span>{min.toFixed(0)}°</span>
        <span>近 {Math.max(5, (values.length - 1) * 5)} 秒</span>
        <span>{max.toFixed(0)}°</span>
      </div>
    </div>
  )
}

let dashboardRefreshPromise: Promise<void> | null = null

function refreshDashboardData(force = false): Promise<void> {
  if (dashboardRefreshPromise) {
    return force
      ? dashboardRefreshPromise.then(() => refreshDashboardData())
      : dashboardRefreshPromise
  }

  const attemptedAt = Date.now()
  const dashboardStore = useDashboardStore.getState()
  dashboardStore.startRefresh()

  const request = (async () => {
    let backendAvailable = false

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return

      const [backendResult, activityResult, scheduleResult, trainingResult, dropResult, openTodayResult] = await Promise.allSettled([
        probeBackendAvailability({ showChecking: useStatusStore.getState().backendStatus !== 'available' }),
        maaApi.getActivity('Official'),
        maaApi.getScheduleExecutionStatus(),
        getTrainingQueue(),
        getTodayDrops(),
        getOpenTodayStages(),
      ])
      const snapshot: Partial<DashboardSnapshot> = {}

      backendAvailable = backendResult.status === 'fulfilled' && backendResult.value

      if (activityResult.status === 'fulfilled' && activityResult.value.success) {
        const activity = activityResult.value.data
        snapshot.activitySummary = {
          available: Boolean(activity?.isActive || activity?.available || activity?.code || activity?.name),
          code: activity?.code || activity?.id || undefined,
          name: activity?.name || activity?.displayName || activity?.stageName || undefined,
          tip: activity?.tip || activity?.description || undefined,
          completion: activity?.completion,
        }
      }

      if (scheduleResult.status === 'fulfilled' && scheduleResult.value.success) {
        const execution = scheduleResult.value.data || {}
        const rawLastResult = execution?.lastResult || execution?.result || execution?.lastMessage
        snapshot.scheduleSummary = {
          isRunning: Boolean(execution?.isRunning || execution?.running || execution?.executing),
          currentTask: execution?.taskName || execution?.currentTask || execution?.task?.name || undefined,
          message: execution?.message || execution?.status || undefined,
          lastTask: execution?.lastTaskName || execution?.lastTask || execution?.completedTask || getExecutionLastTask(rawLastResult),
          lastResult: formatExecutionSummary(rawLastResult),
        }
      }

      if (trainingResult.status === 'fulfilled' && trainingResult.value.success) {
        const payload = trainingResult.value.data
        const queue = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.queue)
            ? payload.queue
            : []
        snapshot.trainingSummary = {
          count: queue.length,
          topNames: queue
            .map((item: any) => item?.operatorName || item?.operator?.name || item?.name || item?.nickname)
            .filter(Boolean)
            .slice(0, 3),
        }
      }

      if (dropResult.status === 'fulfilled' && dropResult.value.success) {
        const payload = dropResult.value.data
        const drops = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.records)
            ? payload.records
            : []
        snapshot.dropSummary = {
          count: drops.length,
          recent: [...drops].reverse().slice(0, 3).map((record: any) => ({
            stage: record?.stageName || record?.stageCode || record?.stage || '未知关卡',
            items: Array.isArray(record?.drops) && record.drops.length > 0
              ? record.drops
                  .slice(0, 3)
                  .map((drop: any) => `${drop?.name || drop?.itemName || '材料'}×${drop?.count || 1}`)
                  .join('、')
              : Array.isArray(record?.items) && record.items.length > 0
                ? record.items
                    .slice(0, 3)
                    .map((item: any) => `${item?.name || item?.itemName || '材料'}×${item?.count || 1}`)
                    .join('、')
                : record?.itemName || '已记录作战，暂无材料明细',
          })),
        }
      }

      if (openTodayResult.status === 'fulfilled' && openTodayResult.value.success && openTodayResult.value.data) {
        snapshot.openStageSummary = {
          open: Array.isArray(openTodayResult.value.data.open) ? openTodayResult.value.data.open : [],
          closed: Array.isArray(openTodayResult.value.data.closed) ? openTodayResult.value.data.closed : [],
        }
      }

      dashboardStore.updateSnapshot(snapshot)
    } catch (error) {
      console.error('加载 Dashboard 数据失败:', error)
    } finally {
      dashboardStore.finishRefresh(attemptedAt, backendAvailable)
    }
  })()
  const refreshPromise = request.finally(() => {
    dashboardRefreshPromise = null
  })

  dashboardRefreshPromise = refreshPromise
  return refreshPromise
}

export default function Dashboard() {
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const { backendStatus, backendMessage } = useStatusStore()
  const isOnline = useOnlineStatus()
  const openAutomation = useCallback(() => setActiveTab('automation'), [setActiveTab])
  const hasLoaded = useDashboardStore(state => state.hasLoaded)
  const lastUpdate = useDashboardStore(state => state.lastUpdate)
  const activitySummary = useDashboardStore(state => state.activitySummary)
  const scheduleSummary = useDashboardStore(state => state.scheduleSummary)
  const trainingSummary = useDashboardStore(state => state.trainingSummary)
  const dropSummary = useDashboardStore(state => state.dropSummary)
  const openStageSummary = useDashboardStore(state => state.openStageSummary)
  const deviceStats = useDashboardStore(state => state.deviceStats)
  const temperatureHistory = useDashboardStore(state => state.temperatureHistory)
  const shouldAnimateCardsRef = useRef(!hasLoaded)
  const wasOnlineRef = useRef(isOnline)
  const { flowGridRef, flowCardRef, flowPreviewRef, flowGridStyle } = useDashboardFlowLayout(hasLoaded)
  const [quickStartLoading, setQuickStartLoading] = useState(false)
  const [activityPreflightLoading, setActivityPreflightLoading] = useState(false)
  const [quickStartMessage, setQuickStartMessage] = useState('')

  const serviceStatus = isOnline ? backendStatus : 'offline'
  const automationAvailable = serviceStatus === 'available'

  useEffect(() => {
    let disposed = false
    let requestInFlight = false
    const fetch = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const result = await maaApi.getDeviceStats()
        if (!disposed && result.success) {
          useDashboardStore.getState().updateDeviceStats(result.data)
        }
      } catch {
        // Keep the most recent sample while the device endpoint is unavailable.
      } finally {
        requestInFlight = false
      }
    }
    void fetch()
    const timer = window.setInterval(() => void fetch(), 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const loadDashboardData = useCallback(() => refreshDashboardData(true), [])

  useEffect(() => {
    let disposed = false
    let timer: number | null = null

    const scheduleNextRefresh = () => {
      if (disposed) return
      const lastAttempt = useDashboardStore.getState().lastRefreshAttemptAt
      const elapsed = lastAttempt === null ? DASHBOARD_REFRESH_INTERVAL_MS : Date.now() - lastAttempt
      const delay = Math.max(1000, DASHBOARD_REFRESH_INTERVAL_MS - elapsed)
      timer = window.setTimeout(() => {
        void refreshDashboardData().finally(scheduleNextRefresh)
      }, delay)
    }
    const refreshThenSchedule = () => {
      void refreshDashboardData().finally(scheduleNextRefresh)
    }
    const cache = useDashboardStore.getState()
    const cacheIsStale = cache.lastRefreshAttemptAt === null
      || Date.now() - cache.lastRefreshAttemptAt >= DASHBOARD_REFRESH_INTERVAL_MS

    if (!cache.hasLoaded || cacheIsStale) refreshThenSchedule()
    else scheduleNextRefresh()

    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      void refreshDashboardData(true)
    }
    wasOnlineRef.current = isOnline
  }, [isOnline])

  const runTodayFlow = async () => {
    if (!automationAvailable) {
      setQuickStartMessage(serviceStatus === 'offline' ? '当前网络已断开，恢复连接后再试。' : '后端服务暂不可用，请重试连接。')
      return
    }
    setQuickStartLoading(true)
    setQuickStartMessage('')
    try {
      const configResult = await maaApi.loadUserConfig('automation-tasks')
      const savedFlow = Array.isArray(configResult?.data?.taskFlow) ? configResult.data.taskFlow : []
      if (!configResult.success || savedFlow.length === 0) {
        setQuickStartMessage('还没有配置今日流程，先去自动化页保存任务流。')
        setActiveTab('automation')
        return
      }

      const result = await maaApi.executeScheduleNow('dashboard-quick-start', savedFlow)
      if (result.success) {
        setQuickStartMessage(result.message || '今日流程已开始执行')
        await loadDashboardData()
      } else {
        setQuickStartMessage(result.message || '今日流程启动失败')
      }
    } catch (error: any) {
      setQuickStartMessage(error?.message || '今日流程启动失败')
    } finally {
      setQuickStartLoading(false)
    }
  }

  const runCurrentActivity = async () => {
    if (!automationAvailable) {
      setQuickStartMessage(serviceStatus === 'offline' ? '当前网络已断开，恢复连接后再试。' : '后端服务暂不可用，请重试连接。')
      return
    }
    setActivityPreflightLoading(true)
    setQuickStartMessage('')
    try {
      const runResult = await maaApi.runCurrentActivity()
      const runData = runResult.data as { executed?: boolean; plan?: { reason?: string }; execution?: { results?: unknown[] } } | undefined
      if (runResult.success && runData?.executed) {
        const completedCount = Array.isArray(runData.execution?.results) ? runData.execution.results.length : 0
        setQuickStartMessage(completedCount > 0 ? `当前活动作业已完成 ${completedCount} 项。` : '当前活动作业已完成。')
        await loadDashboardData()
      } else {
        setQuickStartMessage(runData?.plan?.reason || maaApi.getErrorMessage(runResult) || '当前活动暂未准备就绪。')
      }
    } catch (error: any) {
      setQuickStartMessage(error?.message || '当前活动预检失败')
    } finally {
      setActivityPreflightLoading(false)
    }
  }

  if (!hasLoaded) {
    return <DashboardSkeleton />
  }

  const lastUpdateDate = lastUpdate ? new Date(lastUpdate) : null
  const flowIsRunning = scheduleSummary.isRunning
  const connectionTitle = serviceStatus === 'offline'
    ? '当前网络离线'
    : serviceStatus === 'unavailable'
      ? '后端服务不可用'
      : '正在检查服务'
  const connectionDescription = serviceStatus === 'offline'
    ? '恢复网络连接后会自动重新检查服务'
    : serviceStatus === 'unavailable'
      ? (backendMessage || '确认 La Pluma 服务已启动后重试')
      : '正在确认自动化服务状态'
  const flowCommandTitle = !automationAvailable
    ? connectionTitle
    : flowIsRunning
      ? (scheduleSummary.currentTask || '流程执行中')
      : '准备就绪'
  const flowCommandDescription = !automationAvailable
    ? connectionDescription
    : flowIsRunning
      ? (scheduleSummary.message || '自动化任务正在按计划推进')
      : (scheduleSummary.message || '设备待命，可以开始今天的自动化任务')
  const flowStatusLabel = serviceStatus === 'offline'
    ? '网络离线'
    : serviceStatus === 'unavailable'
      ? '服务不可用'
      : serviceStatus === 'checking' || serviceStatus === 'unknown'
        ? '检查中'
        : flowIsRunning ? '执行中' : '待命'
  const activityCompleted = activitySummary.completion?.complete === true

  return (
    <div className="app-page dashboard-page" data-page="dashboard">
      <div className="app-stack-section">
        <PageHeader
          title="控制台"
          subtitle="当前活动、自动化进度、养成与掉落总览"
          mobileLayout="inline"
          actions={
            <div className="dashboard-page-actions flex w-full items-center sm:w-auto">
              <div className="dashboard-status-slot min-w-0 flex-1 sm:flex-none">
                <FloatingStatusIndicator className="dashboard-status-indicator w-full sm:w-auto sm:max-w-none" textClassName="truncate whitespace-nowrap" />
              </div>
            </div>
          }
        />

        {(serviceStatus === 'offline' || serviceStatus === 'unavailable') && (
          <SmoothPanel
            cornerSize="compact"
            className="dashboard-connection-alert"
            surfaceClassName={`app-info-card flex min-w-0 flex-wrap items-center gap-3 ${serviceStatus === 'offline' ? 'status-warning' : 'status-danger'}`}
            role="alert"
          >
            {serviceStatus === 'offline'
              ? <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
              : <ServerOff className="h-5 w-5 shrink-0" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{connectionTitle}</div>
              <div className="mt-0.5 text-xs opacity-80">{connectionDescription}</div>
            </div>
            {serviceStatus === 'unavailable' && (
              <Button
                onClick={() => loadDashboardData()}
                variant="secondary"
                size="sm"
                icon={<Icons.RefreshCw />}
              >
                重试连接
              </Button>
            )}
          </SmoothPanel>
        )}

        <div
          ref={flowGridRef}
          className="dashboard-flow-layout"
          style={flowGridStyle}
        >
          <div ref={flowCardRef} className="min-w-0">
            <div
              className={`dashboard-flow-glow-shell status-border-beam ${quickStartLoading || flowIsRunning ? 'is-active' : ''}`}
              aria-busy={quickStartLoading || flowIsRunning}
            >
              <Card animated={shouldAnimateCardsRef.current} delay={0.18} smoothCorners className="dashboard-flow-card !p-0">
              <div className="dashboard-flow-header">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="dashboard-flow-mark" aria-hidden="true">
                    <Activity className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="dashboard-flow-eyebrow text-[11px] font-semibold uppercase text-[var(--app-accent-strong)]">Daily operations</div>
                    <div className="dashboard-flow-title mt-0.5 text-base font-bold text-primary">今日流程</div>
                  </div>
                </div>
                <div className="dashboard-flow-meta flex shrink-0 items-center gap-2">
                  <div className={`dashboard-flow-status ${automationAvailable && flowIsRunning ? 'is-running' : ''} ${serviceStatus === 'offline' ? 'status-warning' : serviceStatus === 'unavailable' ? 'status-danger' : ''}`}>
                    <span className="dashboard-flow-status-dot" />
                    {flowStatusLabel}
                  </div>
                  <span className={`whitespace-nowrap text-[11px] ${labelClass}`}>
                    {lastUpdateDate ? lastUpdateDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--:--'} 更新
                  </span>
                </div>
              </div>

              <div className="dashboard-flow-command">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className={`dashboard-flow-command-icon ${automationAvailable && flowIsRunning ? 'is-running' : ''}`}>
                    {serviceStatus === 'offline'
                      ? <WifiOff className="h-5 w-5" strokeWidth={1.8} />
                      : serviceStatus === 'unavailable'
                        ? <ServerOff className="h-5 w-5" strokeWidth={1.8} />
                        : flowIsRunning
                          ? <Activity className="h-5 w-5" strokeWidth={1.8} />
                          : <Play className="ml-0.5 h-5 w-5" strokeWidth={1.9} />}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xs font-medium ${labelClass}`}>{automationAvailable && flowIsRunning ? '当前任务' : '运行状态'}</div>
                    <div className="mt-0.5 truncate text-xl font-bold text-primary">{flowCommandTitle}</div>
                    <div className={`mt-1 truncate text-xs ${labelClass}`}>{flowCommandDescription}</div>
                  </div>
                </div>
                <div className="dashboard-flow-actions">
                  {activitySummary.available && (
                    <Button
                      onClick={runCurrentActivity}
                      variant="secondary"
                      disabled={quickStartLoading || activityPreflightLoading || flowIsRunning || !automationAvailable}
                      loading={activityPreflightLoading}
                      loadingText="执行中"
                      statusKey={activityPreflightLoading ? 'running' : 'ready'}
                      className={`dashboard-flow-activity-action justify-center whitespace-nowrap ${activityCompleted ? 'is-completed' : ''}`}
                      title={activityCompleted ? '重新执行当前活动' : '检查活动导航并执行已保存偏好的活动作业'}
                      aria-label={activityCompleted ? '重新执行当前活动' : '打当前活动'}
                      icon={activityCompleted
                        ? <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                        : <Target className="h-4 w-4" strokeWidth={2} />}
                    >
                      {activityCompleted ? (
                        <>
                          <span className="dashboard-flow-activity-completed-label">活动已通关</span>
                          <span className="dashboard-flow-activity-run-label">打当前活动</span>
                        </>
                      ) : '打当前活动'}
                    </Button>
                  )}
                  <Button
                    onClick={runTodayFlow}
                    variant="primary"
                    disabled={quickStartLoading || activityPreflightLoading || flowIsRunning || !automationAvailable}
                    loading={quickStartLoading}
                    loadingText="启动中"
                    statusKey={quickStartLoading ? 'starting' : flowIsRunning ? 'running' : 'ready'}
                    className="dashboard-flow-primary-action dashboard-flow-shining-action justify-center whitespace-nowrap"
                    icon={<Play className="h-4 w-4" strokeWidth={2} />}
                  >
                    {flowIsRunning ? '正在运行' : '开始今日流程'}
                  </Button>
                </div>
              </div>

              <div className="dashboard-flow-metrics">
                {[
                  {
                    label: '当前活动',
                    value: activitySummary.available ? (activitySummary.name || activitySummary.code || '进行中') : '暂无活动',
                    sub: activitySummary.tip || '等待活动数据',
                    Icon: CalendarDays,
                  },
                  {
                    label: '养成目标',
                    value: `${trainingSummary.count} 项`,
                    sub: trainingSummary.topNames.length > 0 ? trainingSummary.topNames.join('、') : '尚未添加目标',
                    Icon: Target,
                  },
                  {
                    label: '今日掉落',
                    value: `${dropSummary.count} 条`,
                    sub: dropSummary.recent[0]?.items || '作战后自动汇总',
                    Icon: PackageOpen,
                  },
                ].map(({ Icon, ...item }) => (
                  <div key={item.label} className="dashboard-flow-metric">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-[var(--app-accent-strong)]" strokeWidth={1.8} />
                      <span className={`text-xs font-medium ${labelClass}`}>{item.label}</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-bold text-primary">{item.value}</div>
                    <div className={`mt-0.5 truncate text-xs ${labelClass}`}>{item.sub}</div>
                  </div>
                ))}
              </div>

              <div className="dashboard-flow-stages">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="dashboard-flow-rail-dot" />
                    <span className="text-xs font-semibold text-primary">今日开放关卡</span>
                  </div>
                  <span className={`text-[11px] ${labelClass}`}>{openStageSummary.open.length} 个日常本</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {openStageSummary.open.length > 0 ? (
                    openStageSummary.open.map(item => (
                      <span key={item.stage} className={dashboardChipClass}>{item.stage} · {item.name}</span>
                    ))
                  ) : (
                    <span className={mutedChipClass}>等待开放关卡数据</span>
                  )}
                </div>
              </div>

              <div className="dashboard-flow-shortcuts" aria-label="快捷入口">
                {[
                  { label: '自动化', tab: 'automation', Icon: Bot },
                  { label: '作业', tab: 'combat', Icon: Activity },
                  { label: '养成', tab: 'training', Icon: Target },
                ].map(({ label, tab, Icon }) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className="dashboard-flow-shortcut"
                    aria-label={`打开${label}`}
                  >
                    <span className="dashboard-flow-shortcut-icon" aria-hidden="true">
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <span className="truncate">{label}</span>
                    <ChevronRight className="dashboard-flow-shortcut-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {quickStartMessage && (
                <div className={`dashboard-flow-message text-xs ${labelClass}`}>{quickStartMessage}</div>
              )}
              </Card>
            </div>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <DashboardPreviewEntry onOpen={openAutomation} />
          </div>
        </div>

        {deviceStats && (
          <div className="dashboard-device-section">
            <div className="flex items-center gap-2">
              <div className="h-0.5 flex-1 bg-[var(--app-border)] rounded-full" />
              <span className={`text-xs font-medium ${labelClass} uppercase shrink-0`}>设备状态</span>
              <div className="h-0.5 flex-1 bg-[var(--app-border)] rounded-full" />
            </div>
            <div className="dashboard-device-grid">
              {([
                { label: 'CPU', pct: deviceStats.cpuPct, sub: deviceStats.load1m != null ? `负载 ${deviceStats.load1m.toFixed(1)}` : '', Icon: Cpu, value: undefined as string | undefined },
                { label: '内存', pct: deviceStats.memPct, sub: `${deviceStats.memUsed ?? '--'} / ${deviceStats.memTotal ?? '--'}`, Icon: Database, value: undefined as string | undefined },
                { label: '磁盘', pct: deviceStats.diskPct, sub: `${deviceStats.diskUsed ?? '--'} / ${deviceStats.diskTotal ?? '--'}`, Icon: HardDrive, value: undefined as string | undefined },
                { label: '温度', pct: undefined, sub: '', Icon: Thermometer, value: deviceStats.temp != null ? `${deviceStats.temp}°C` : '--' },
              ] as const).map(({ label, pct, sub, Icon, value }) => {
                return (
                  <SmoothPanel
                    key={label}
                    cornerSize="compact"
                    className="dashboard-device-card-shell group surface-panel-hover transition-colors"
                    surfaceClassName="dashboard-device-card"
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="shrink-0 h-8 w-8 rounded-lg surface-soft flex items-center justify-center">
                        <Icon className={`h-4 w-4 ${labelClass}`} strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-primary">{label}</div>
                        <div className={`truncate text-xs ${labelClass}`}>{sub || '实时采样'}</div>
                      </div>
                      {value != null && (
                        <div className="ml-auto text-sm font-semibold text-primary">{value}</div>
                      )}
                    </div>
                    {label === '温度' ? (
                      <TemperatureSparkline values={temperatureHistory} />
                    ) : pct != null && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs ${labelClass}`}>使用率</span>
                          <span className={`text-xs font-medium ${getUsageValueClass(pct)}`}>{pct}%</span>
                        </div>
                        <div className={progressTrackClass}>
                          <div className={`h-full rounded-full transition-all duration-700 ${getUsageBarClass(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </SmoothPanel>
                )
              })}
            </div>
          </div>
        )}

        <div className="dashboard-summary-grid">
          <Card animated={shouldAnimateCardsRef.current} delay={0.23} smoothCorners className="dashboard-summary-card is-status !p-0">
            <div className="dashboard-summary-header">
              <div className="dashboard-summary-heading">
                <span className="dashboard-summary-icon" aria-hidden="true">
                  <Activity className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <div className={sectionTitleClass}>执行状态</div>
                  <div className={`mt-0.5 text-xs ${labelClass}`}>当前进度与最近一次结果</div>
                </div>
              </div>
            </div>
            <div className="dashboard-status-grid">
              <div className="dashboard-status-block">
                <div className="dashboard-summary-label">
                  <span className={`dashboard-summary-dot ${scheduleSummary.isRunning ? 'is-active' : ''}`} />
                  当前执行
                </div>
                <div className="dashboard-summary-value">{automationAvailable ? (scheduleSummary.isRunning ? '执行中' : '空闲中') : '状态不可用'}</div>
                <div className="dashboard-summary-detail">{automationAvailable ? (scheduleSummary.currentTask || scheduleSummary.message || '暂无进行中的流程') : connectionDescription}</div>
              </div>
              <div className="dashboard-status-block">
                <div className="dashboard-summary-label">
                  <span className="dashboard-summary-dot is-muted" />
                  最近结果
                </div>
                <div className="dashboard-summary-value">{scheduleSummary.lastTask || '暂无记录'}</div>
                <div className="dashboard-summary-detail">{scheduleSummary.lastResult || '执行一次自动化流程后显示'}</div>
              </div>
            </div>
          </Card>

          <Card animated={shouldAnimateCardsRef.current} delay={0.24} smoothCorners className="dashboard-summary-card is-stages !p-0">
            <div className="dashboard-summary-header">
              <div className="dashboard-summary-heading">
                <span className="dashboard-summary-icon" aria-hidden="true">
                  <CalendarDays className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <div className={sectionTitleClass}>今日开放关卡</div>
                  <div className={`mt-0.5 text-xs ${labelClass}`}>资源本与芯片本开放情况</div>
                </div>
              </div>
              <span className="dashboard-summary-count">{openStageSummary.open.length} 开放</span>
            </div>
            <div className="dashboard-stage-groups">
              <div className="dashboard-stage-group">
                <div className="dashboard-stage-group-heading">
                  <span className="dashboard-summary-label"><span className="dashboard-summary-dot is-active" />开放</span>
                  <span className="dashboard-stage-count">{openStageSummary.open.length}</span>
                </div>
                <div className="dashboard-stage-list">
                  {openStageSummary.open.length > 0 ? (
                    openStageSummary.open.map(item => (
                      <span key={item.stage} className="dashboard-stage-chip is-open">{item.stage} · {item.name}</span>
                    ))
                  ) : (
                    <span className="dashboard-stage-chip is-empty">暂无开放数据</span>
                  )}
                </div>
              </div>
              <div className="dashboard-stage-group">
                <div className="dashboard-stage-group-heading">
                  <span className="dashboard-summary-label"><span className="dashboard-summary-dot is-muted" />未开放</span>
                  <span className="dashboard-stage-count">{openStageSummary.closed.length}</span>
                </div>
                <div className="dashboard-stage-list">
                  {openStageSummary.closed.length > 0 ? (
                    openStageSummary.closed.map(item => (
                      <span key={item.stage} className="dashboard-stage-chip">{item.stage} · {item.name}</span>
                    ))
                  ) : (
                    <span className="dashboard-stage-chip is-empty">暂无未开放数据</span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card animated={shouldAnimateCardsRef.current} delay={0.24} smoothCorners className="dashboard-summary-card is-training !p-0">
            <div className="dashboard-summary-header">
              <div className="dashboard-summary-heading">
                <span className="dashboard-summary-icon" aria-hidden="true">
                  <Target className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <div className={sectionTitleClass}>养成摘要</div>
                  <div className={`mt-0.5 text-xs ${labelClass}`}>当前优先培养的干员目标</div>
                </div>
              </div>
              <IconButton
                onClick={() => setActiveTab('training')}
                icon={<ChevronRight className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                title="打开养成"
                aria-label="打开养成"
                className="dashboard-summary-action"
              />
            </div>
            <div className="dashboard-summary-body">
              <div className="dashboard-summary-statline">
                <div>
                  <div className="dashboard-summary-number">{trainingSummary.count}</div>
                  <div className="dashboard-summary-number-label">培养目标</div>
                </div>
                <div className="dashboard-summary-copy">
                  <div className="text-sm font-semibold text-primary">{trainingSummary.count > 0 ? '队列已建立' : '等待添加目标'}</div>
                  <div className="dashboard-summary-detail">
                    {trainingSummary.count > 0 ? '按优先级推进当前培养计划' : '添加干员后会在这里汇总优先目标'}
                  </div>
                </div>
              </div>
              <div className={`dashboard-summary-footer${trainingSummary.topNames.length === 0 ? ' is-action' : ''}`}>
                {trainingSummary.topNames.length > 0 ? (
                  <div className="dashboard-stage-list">
                    {trainingSummary.topNames.map(name => (
                      <span key={name} className="dashboard-stage-chip is-accent">{name}</span>
                    ))}
                  </div>
                ) : (
                  <button type="button" onClick={() => setActiveTab('training')} className="dashboard-summary-link min-h-11">
                    添加首个培养目标
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card animated={shouldAnimateCardsRef.current} delay={0.26} smoothCorners className="dashboard-summary-card is-drops !p-0">
            <div className="dashboard-summary-header">
              <div className="dashboard-summary-heading">
                <span className="dashboard-summary-icon" aria-hidden="true">
                  <PackageOpen className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <div className={sectionTitleClass}>今日掉落摘要</div>
                  <div className={`mt-0.5 text-xs ${labelClass}`}>最近作战产出</div>
                </div>
              </div>
              <IconButton
                onClick={() => setActiveTab('statistics')}
                icon={<ChevronRight className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                title="打开数据"
                aria-label="打开数据"
                className="dashboard-summary-action"
              />
            </div>
            <div className="dashboard-summary-body">
              <div className="dashboard-summary-statline">
                <div>
                  <div className="dashboard-summary-number">{dropSummary.count}</div>
                  <div className="dashboard-summary-number-label">掉落记录</div>
                </div>
                <div className="dashboard-summary-copy">
                  <div className="text-sm font-semibold text-primary">{dropSummary.count > 0 ? '今日已记录' : '尚无作战产出'}</div>
                  <div className="dashboard-summary-detail">
                    {dropSummary.count > 0 ? '最近的关卡与材料已完成汇总' : '完成作战后会自动记录关卡与材料'}
                  </div>
                </div>
              </div>
              <div className={`dashboard-summary-footer${dropSummary.count === 0 ? ' is-action' : ''}`}>
                {dropSummary.count > 0 ? (
                  <div className="dashboard-drop-list">
                    {dropSummary.recent.map((record, index) => (
                      <div key={`${record.stage}-${index}`} className="dashboard-drop-row">
                        <span className="dashboard-drop-stage">{record.stage}</span>
                        <span className="dashboard-drop-items">{record.items}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button type="button" onClick={() => setActiveTab('statistics')} className="dashboard-summary-link min-h-11">
                    查看掉落数据
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* 最后更新时间 */}
        {lastUpdateDate && (
          <div className={`text-center text-sm ${labelClass}`}>
            最后更新: {lastUpdateDate.toLocaleString('zh-CN')}
          </div>
        )}
      </div>
    </div>
  )
}
