import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Bot, CalendarDays, CheckCircle2, ChevronRight, Cpu, HardDrive, Database, PackageOpen, Play, ServerOff, Target, Thermometer, WifiOff } from 'lucide-react'
import { getOpenTodayStages, getSklandPlayerData, getSklandStatus, getTodayDrops, getTrainingQueue, maaApi } from '../services/api'
import Icons from './Icons'
import { PageHeader, Card, Button, IconButton } from './common'
import { DashboardSkeleton } from './common/Loading'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useUIStore } from '@/stores'
import { useDashboardFlowLayout } from '../hooks/useDashboardFlowLayout'
import DashboardPreviewEntry from './DashboardPreviewEntry'
import { formatExecutionSummary, getExecutionLastTask } from '../utils/executionSummary'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useStatusStore } from '../store/statusStore'
import { probeBackendAvailability } from '../hooks/useBackendStatusMonitor'

interface SklandData {
  uid: string
  nickname: string
  level: number
  registerTs: number
  mainStageProgress: string
  secretary: string
  secretaryName: string
  avatarId: string
  avatarUrl: string
  stageInfo: {
    id: string
    code: string
    name: string
    difficulty: string
    dangerLevel: string
    apCost: number
    thumbnail: string
    stageType: string
    isMainStage: boolean
    isActivityStage: boolean
  } | null
  ap: {
    current: number
    max: number
    completeRecoveryTime: number
  }
  chars: {
    total: number
    elite2: number
    maxLevel: number
    skill7Plus: number
  }
  building: {
    furniture: number
    labor: {
      value: number
      maxValue: number
    }
    manufactures?: any[]
    tradings?: any[]
    dormitories?: any[]
    meeting?: any
    hire?: any
    training?: any
  }
  routine: {
    daily: { current: number; total: number }
    weekly: { current: number; total: number }
  } | null
  campaign: {
    reward: { current: number; total: number }
  } | null
  recruit: Array<{
    state: number
    finishTs?: number
    tags?: Array<{ tagId: number; tagName: string }>
  }>
  assistChars?: Array<{
    charId: string
    skinId?: string
    name: string
    level: number
    evolvePhase: number
    mainSkillLvl: number
    skills: any[]
  }>
  social?: any
  training?: any
  clue?: any
}

interface ActivitySummary {
  available: boolean
  code?: string
  name?: string
  tip?: string
  completion?: {
    known?: boolean
    complete?: boolean
    completedStages?: string[]
    totalStages?: number
  }
}

interface ScheduleSummary {
  isRunning: boolean
  currentTask?: string
  message?: string
  lastTask?: string
  lastResult?: string
}

interface TrainingSummary {
  count: number
  topNames: string[]
}

interface DropSummary {
  count: number
  recent: Array<{
    stage: string
    items: string
  }>
}

interface OpenStageSummary {
  open: Array<{ stage: string; name: string }>
  closed: Array<{ stage: string; name: string }>
}

const dashboardTileClass = 'rounded-xl border border-[var(--app-border)] surface-soft'
const compactTileClass = `${dashboardTileClass} p-2.5`
const sectionTitleClass = 'text-base font-bold text-primary'
const labelClass = 'text-secondary'
const progressTrackClass = 'h-1.5 rounded-full bg-[var(--app-surface-muted)] overflow-hidden'
const progressFillClass = 'h-full rounded-full bg-[var(--app-accent)] transition-all duration-700'
const dashboardChipClass = 'brand-chip rounded-lg px-2.5 py-1 text-xs font-medium'
const mutedChipClass = 'rounded-lg px-2.5 py-1 surface-soft text-secondary text-xs'
const recruitSlotClass = (displayState: number) =>
  `relative rounded-lg p-2 ${
    displayState === 2
      ? 'status-success'
      : displayState === 1
      ? 'status-info'
      : 'surface-soft border border-[var(--app-border)]'
  }`
const recruitBadgeClass = (displayState: number) =>
  `text-xs px-1 py-0.5 rounded-full ${
    displayState === 2
      ? 'status-success font-medium'
      : displayState === 1
      ? 'status-info font-medium'
      : 'surface-soft text-secondary'
  }`

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

export default function Dashboard() {
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const { backendStatus, backendMessage } = useStatusStore()
  const isOnline = useOnlineStatus()
  const openAutomation = useCallback(() => setActiveTab('automation'), [setActiveTab])
  const [loading, setLoading] = useState(true)
  const initialLoadCompleteRef = useRef(false)
  const wasOnlineRef = useRef(isOnline)
  const { flowGridRef, flowCardRef, flowPreviewRef, flowGridStyle } = useDashboardFlowLayout(!loading)
  const [sklandData, setSklandData] = useState<SklandData | null>(null)
  const [sklandStatus, setSklandStatus] = useState<{ isLoggedIn: boolean; phone: string | null }>({ 
    isLoggedIn: false, 
    phone: null 
  })
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [activitySummary, setActivitySummary] = useState<ActivitySummary>({ available: false })
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary>({ isRunning: false })
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummary>({ count: 0, topNames: [] })
  const [dropSummary, setDropSummary] = useState<DropSummary>({ count: 0, recent: [] })
  const [openStageSummary, setOpenStageSummary] = useState<OpenStageSummary>({ open: [], closed: [] })
  const [quickStartLoading, setQuickStartLoading] = useState(false)
  const [activityPreflightLoading, setActivityPreflightLoading] = useState(false)
  const [quickStartMessage, setQuickStartMessage] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [deviceStats, setDeviceStats] = useState<{
    cpuPct?: number; load1m?: number;
    memPct?: number; memUsed?: string; memTotal?: string;
    diskPct?: number; diskUsed?: string; diskTotal?: string;
    temp?: number;
  } | null>(null)
  const [temperatureHistory, setTemperatureHistory] = useState<number[]>([])

  const serviceStatus = isOnline ? backendStatus : 'offline'
  const automationAvailable = serviceStatus === 'available'
  // 设备状态轮询（CPU/内存）
  useEffect(() => {
    const fetch = () => {
      maaApi.getDeviceStats().then(r => {
        if (!r.success) return
        setDeviceStats(r.data)
        if (Number.isFinite(r.data?.temp)) {
          setTemperatureHistory(history => [...history, Number(r.data.temp)].slice(-36))
        }
      }).catch(() => {})
    }
    fetch()
    const timer = setInterval(fetch, 5000)
    return () => clearInterval(timer)
  }, [])

  // 每秒更新当前时间，用于倒计时
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const loadDashboardData = useCallback(async (forceRefresh: boolean = false) => {
    // 后续刷新保留现有内容，只在首次进入时显示整页骨架屏。
    if (!initialLoadCompleteRef.current) {
      setLoading(true)
    }

    if (!navigator.onLine) {
      initialLoadCompleteRef.current = true
      setLoading(false)
      return
    }

    try {
      const [backendResult, statusResult, activityResult, scheduleResult, trainingResult, dropResult, openTodayResult, sklandResult] = await Promise.allSettled([
        probeBackendAvailability({ showChecking: useStatusStore.getState().backendStatus !== 'available' }),
        getSklandStatus(),
        maaApi.getActivity('Official'),
        maaApi.getScheduleExecutionStatus(),
        getTrainingQueue(),
        getTodayDrops(),
        getOpenTodayStages(),
        getSklandPlayerData(!forceRefresh),
      ])

      const backendAvailable = backendResult.status === 'fulfilled' && backendResult.value

      if (statusResult.status === 'fulfilled' && statusResult.value.success && statusResult.value.data) {
        setSklandStatus(statusResult.value.data)

        if (statusResult.value.data.isLoggedIn && sklandResult.status === 'fulfilled' && sklandResult.value.success && sklandResult.value.data) {
          setSklandData(sklandResult.value.data)
        } else if (
          sklandResult.status === 'fulfilled' &&
          typeof sklandResult.value.error === 'string' &&
          sklandResult.value.error.includes('登录已过期')
        ) {
          console.warn('森空岛登录已过期')
          setSklandStatus({ isLoggedIn: false, phone: null })
          setSklandData(null)
        } else if (!statusResult.value.data.isLoggedIn) {
          setSklandData(null)
        }
      }

      if (activityResult.status === 'fulfilled' && activityResult.value.success) {
        const activity = activityResult.value.data
        setActivitySummary({
          available: Boolean(activity?.isActive || activity?.available || activity?.code || activity?.name),
          code: activity?.code || activity?.id || undefined,
          name: activity?.name || activity?.displayName || activity?.stageName || undefined,
          tip: activity?.tip || activity?.description || undefined,
          completion: activity?.completion,
        })
      }

      if (scheduleResult.status === 'fulfilled' && scheduleResult.value.success) {
        const execution = scheduleResult.value.data || {}
        const rawLastResult = execution?.lastResult || execution?.result || execution?.lastMessage
        setScheduleSummary({
          isRunning: Boolean(execution?.isRunning || execution?.running || execution?.executing),
          currentTask: execution?.taskName || execution?.currentTask || execution?.task?.name || undefined,
          message: execution?.message || execution?.status || undefined,
          lastTask: execution?.lastTaskName || execution?.lastTask || execution?.completedTask || getExecutionLastTask(rawLastResult),
          lastResult: formatExecutionSummary(rawLastResult),
        })
      }

      if (trainingResult.status === 'fulfilled' && trainingResult.value.success) {
        const queue = Array.isArray(trainingResult.value.data) ? trainingResult.value.data : []
        setTrainingSummary({
          count: queue.length,
          topNames: queue
            .map((item: any) => item?.operatorName || item?.name || item?.nickname)
            .filter(Boolean)
            .slice(0, 3),
        })
      }

      if (dropResult.status === 'fulfilled' && dropResult.value.success) {
        const payload = dropResult.value.data
        const drops = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.records)
            ? payload.records
            : []
        setDropSummary({
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
        })
      }

      if (openTodayResult.status === 'fulfilled' && openTodayResult.value.success && openTodayResult.value.data) {
        setOpenStageSummary({
          open: Array.isArray(openTodayResult.value.data.open) ? openTodayResult.value.data.open : [],
          closed: Array.isArray(openTodayResult.value.data.closed) ? openTodayResult.value.data.closed : [],
        })
      }

      if (backendAvailable) {
        setLastUpdate(new Date())
      }
    } catch (error) {
      console.error('加载 Dashboard 数据失败:', error)
    } finally {
      initialLoadCompleteRef.current = true
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboardData()
    const interval = setInterval(loadDashboardData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadDashboardData])

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      void loadDashboardData(true)
    }
    wasOnlineRef.current = isOnline
  }, [isOnline, loadDashboardData])



  const formatFullRecoveryTime = (completeRecoveryTime: number) => {
    const remainingSeconds = completeRecoveryTime - currentTime / 1000
    if (remainingSeconds <= 0) return '已满'

    const hours = Math.floor(remainingSeconds / 3600)
    const minutes = Math.floor((remainingSeconds % 3600) / 60)

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`
    }
    return `${minutes}分钟`
  }
  const formatRecruitTime = (finishTs: number) => {
    const diff = finishTs * 1000 - currentTime
    if (diff <= 0) return '已完成'
    
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatRegisterDate = (registerTs: number) => {
    const date = new Date(registerTs * 1000)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  const openSklandConfig = () => {
    localStorage.setItem('laPlumaConfigSection', 'skland')
    window.dispatchEvent(new CustomEvent('la-pluma-config-section', { detail: 'skland' }))
    setActiveTab('config')
  }

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
        await loadDashboardData(true)
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
        await loadDashboardData(true)
      } else {
        setQuickStartMessage(runData?.plan?.reason || maaApi.getErrorMessage(runResult) || '当前活动暂未准备就绪。')
      }
    } catch (error: any) {
      setQuickStartMessage(error?.message || '当前活动预检失败')
    } finally {
      setActivityPreflightLoading(false)
    }
  }

  if (loading) {
    return <DashboardSkeleton />
  }

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
    <div className="app-page">
      <div className="app-stack-section">
        <PageHeader
          icon={<Icons.Dashboard />}
          title="控制台"
          subtitle="当前活动、自动化进度、养成与掉落总览"
          actions={
            <div className="flex items-center gap-2 sm:gap-3">
              <FloatingStatusIndicator className="max-w-[8rem] sm:max-w-none" />
              <IconButton
                onClick={() => loadDashboardData(true)}
                variant="secondary"
                size="lg"
                title="刷新数据"
                aria-label="刷新数据"
                className="sm:hidden text-[var(--app-accent-strong)]"
                icon={<Icons.RefreshCw className="h-4 w-4" />}
              />
              <Button
                onClick={() => loadDashboardData(true)}
                variant="gradient"
                size="md"
                className="hidden shrink-0 sm:inline-flex"
                icon={<Icons.RefreshCw />}
              >
                刷新数据
              </Button>
            </div>
          }
        />

        {(serviceStatus === 'offline' || serviceStatus === 'unavailable') && (
          <div
            className={`app-info-card flex min-w-0 flex-wrap items-center gap-3 ${serviceStatus === 'offline' ? 'status-warning' : 'status-danger'}`}
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
                onClick={() => loadDashboardData(true)}
                variant="secondary"
                size="sm"
                icon={<Icons.RefreshCw />}
              >
                重试连接
              </Button>
            )}
          </div>
        )}

        <div
          ref={flowGridRef}
          className="dashboard-flow-layout"
          style={flowGridStyle}
        >
          <div ref={flowCardRef} className="min-w-0">
            <div className="dashboard-flow-glow-shell">
              <Card theme="cyan" animated delay={0.18} className="dashboard-flow-card !p-0">
              <div className="dashboard-flow-header">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="dashboard-flow-mark" aria-hidden="true">
                    <Activity className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase text-[var(--app-accent-strong)]">Daily operations</div>
                    <div className="mt-0.5 text-base font-bold text-primary">今日流程</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className={`dashboard-flow-status ${automationAvailable && flowIsRunning ? 'is-running' : ''} ${serviceStatus === 'offline' ? 'status-warning' : serviceStatus === 'unavailable' ? 'status-danger' : ''}`}>
                    <span className="dashboard-flow-status-dot" />
                    {flowStatusLabel}
                  </div>
                  <span className={`text-[11px] ${labelClass}`}>
                    {lastUpdate ? lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--:--'} 更新
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
                    variant="gradient"
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
              <span className={`text-xs font-medium ${labelClass} uppercase tracking-wider shrink-0`}>设备状态</span>
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
                  <div key={label} className="dashboard-device-card group surface-panel surface-panel-hover transition-colors">
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
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="dashboard-summary-grid">
          <Card theme="violet" animated delay={0.23} className="dashboard-summary-card is-status !p-0">
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
              <IconButton
                onClick={() => loadDashboardData(true)}
                icon={<Icons.RefreshCw />}
                variant="ghost"
                size="sm"
                title="刷新执行状态"
                aria-label="刷新执行状态"
                className="dashboard-summary-action"
              />
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

          <Card theme="amber" animated delay={0.24} className="dashboard-summary-card is-stages !p-0">
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

          <Card theme="amber" animated delay={0.24} className="dashboard-summary-card is-training !p-0">
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
              <div className="dashboard-summary-footer">
                {trainingSummary.topNames.length > 0 ? (
                  <div className="dashboard-stage-list">
                    {trainingSummary.topNames.map(name => (
                      <span key={name} className="dashboard-stage-chip is-accent">{name}</span>
                    ))}
                  </div>
                ) : (
                  <button type="button" onClick={() => setActiveTab('training')} className="dashboard-summary-link">
                    添加首个培养目标
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card theme="emerald" animated delay={0.26} className="dashboard-summary-card is-drops !p-0">
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
              <div className="dashboard-summary-footer">
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
                  <button type="button" onClick={() => setActiveTab('statistics')} className="dashboard-summary-link">
                    查看掉落数据
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>

        <Card theme="purple" animated delay={0.22}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className={sectionTitleClass}>森空岛摘要</div>
              <div className={`text-xs ${labelClass} mt-0.5`}>不登录也不阻塞核心功能</div>
            </div>
          </div>

          {sklandStatus.isLoggedIn && sklandData ? (
            <div className="space-y-3">
              <div>
                <div className={`text-xs ${labelClass}`}>当前理智</div>
                <div className="mt-1 text-3xl font-bold text-primary tracking-tight">{sklandData.ap.current}<span className={`text-lg font-normal ${labelClass}`}>/{sklandData.ap.max}</span></div>
                <div className={`mt-1 text-xs ${labelClass}`}>{sklandData.ap.current >= sklandData.ap.max ? '已满' : `预计 ${formatFullRecoveryTime(sklandData.ap.completeRecoveryTime)} 回满`}</div>
              </div>
              <div className="flex gap-6 pt-3 border-t border-[var(--app-border)]">
                <div>
                  <div className={`text-xs ${labelClass}`}>日常</div>
                  <div className="mt-0.5 text-sm font-semibold text-primary">{sklandData.routine ? `${sklandData.routine.daily.current}/${sklandData.routine.daily.total}` : '--'}</div>
                </div>
                <div>
                  <div className={`text-xs ${labelClass}`}>公招</div>
                  <div className="mt-0.5 text-sm font-semibold text-primary">{sklandData.recruit?.length || 0} 个</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="text-sm font-semibold text-primary">森空岛暂未登录</div>
              <div className={`mt-1 text-xs ${labelClass}`}>森空岛登录只影响看板数据，不影响作业。</div>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={openSklandConfig} variant="ghost" size="sm">登录森空岛</Button>
                <Button onClick={() => setActiveTab('combat')} variant="secondary" size="sm">去作业</Button>
              </div>
            </div>
          )}
        </Card>

        {sklandData && (
          <div className="flex gap-5">
            {/* 左列：博士信息 + 剿灭作战 + 2x2网格 (flex-[2]) */}
            <div className="flex-[2] flex flex-col gap-5">
              {/* 博士信息卡片 */}
              <Card theme="cyan" animated delay={0.1} className="overflow-hidden">
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-[var(--app-border)]">
                  <div className="w-1 h-6 bg-[var(--app-accent)] rounded-full"></div>
                  <h3 className="text-lg font-bold text-primary">博士信息</h3>
                </div>

                <div className="flex items-start gap-6">
                  <div className="relative flex-shrink-0">
                    {sklandData.avatarUrl ? (
                      <div className="relative w-24 h-24">
                        <img 
                          src={sklandData.avatarUrl}
                          alt={sklandData.nickname}
                          className="w-full h-full object-cover shadow-lg"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                            const fallback = e.currentTarget.parentElement?.nextElementSibling as HTMLElement
                            if (fallback) fallback.style.display = 'flex'
                          }}
                        />
                        <div className="absolute inset-0 pointer-events-none" style={{
                          background: `
                            linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                            linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                            linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                            linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                          `
                        }}></div>
                      </div>
                    ) : null}
                    <div 
                      className="relative w-24 h-24 bg-transparent flex items-center justify-center shadow-lg"
                      style={{ display: sklandData.avatarUrl ? 'none' : 'flex' }}
                    >
                      <span className="text-4xl font-bold text-white">{sklandData.nickname.charAt(0)}</span>
                      <div className="absolute inset-0 pointer-events-none" style={{
                        background: `
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                          linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                          linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                        `
                      }}></div>
                    </div>
                    {/* PC端：等级徽章在头像左上角 */}
                    <div className="hidden sm:flex absolute top-0 left-0 -translate-x-1/2 -translate-y-1/3 w-11 h-11 rounded-full brand-action items-center justify-center shadow-lg">
                      <div className="text-center">
                        <div className="text-base font-medium text-white leading-none tracking-wider">{sklandData.level}</div>
                        <div className="text-[11px] text-white font-medium leading-none mt-0.5">Lv</div>
                      </div>
                    </div>
                    <div className="mt-3 w-24 text-center">
                      <div className="text-xs font-medium px-2 py-1 brand-action">雇佣干员进度</div>
                      <div className={`text-[8px] ${labelClass} uppercase tracking-wider font-bold -mt-0.5`}>Human Resource</div>
                      <div className="text-3xl font-bold text-primary mt-0.5">{sklandData.chars.total}</div>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold text-primary truncate">{sklandData.nickname}</h2>
                      {/* 手机端：等级徽章在用户名右边 */}
                      <div className="sm:hidden flex-shrink-0 w-11 h-11 rounded-full brand-action flex items-center justify-center shadow-lg">
                        <div className="text-center">
                          <div className="text-base font-medium text-white leading-none tracking-wider">{sklandData.level}</div>
                          <div className="text-[11px] text-white font-medium leading-none mt-0.5">Lv</div>
                        </div>
                      </div>
                    </div>
                    <div className={`flex items-center gap-3 text-sm ${labelClass} mb-4 flex-wrap`}>
                      <span className="px-2 py-1 brand-chip rounded-lg font-mono text-xs">ID: {sklandData.uid}</span>
                      <span>·</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-sm overflow-hidden">
                          <span className="px-1 py-0.5 text-sm brand-action">入职日</span>
                          <span className="px-1 py-0.5 text-primary text-sm surface-soft">
                            {formatRegisterDate(sklandData.registerTs)}
                          </span>
                        </div>
                        <div className="w-4 h-4 rounded-full bg-[var(--app-accent)]"></div>
                        <div className="w-4 h-4 rounded-full border-[3px] border-[var(--app-accent)]"></div>
                        <svg className="text-secondary" style={{ width: '18px', height: '18px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-4 flex-wrap">
                      {/* 助战干员 */}
                      <div className={`${dashboardTileClass} p-3 inline-block`}>
                        <div className="flex flex-col gap-3">
                          {/* 标题区域 */}
                          <div className="flex items-center gap-2">
                            <svg className={`w-5 h-5 ${labelClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 515.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            <div>
                              <div className="text-sm font-bold text-primary">助战干员</div>
                              <div className={`text-[10px] ${labelClass} uppercase tracking-wider leading-none`}>Support</div>
                            </div>
                          </div>
                          {/* 干员头像区域 */}
                          <div className="flex gap-2 overflow-x-auto">
                            {sklandData.assistChars && sklandData.assistChars.length > 0 ? (
                              sklandData.assistChars.map((char, index) => (
                                <div key={index} className="flex-shrink-0">
                                  <div className="relative">
                                    <div className="w-20 h-20 overflow-hidden bg-transparent flex items-center justify-center relative">
                                      <img 
                                        src={`https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.skinId || char.charId}.png`}
                                        alt={char.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement
                                          const currentSrc = target.src
                                          const skinId = char.skinId || char.charId
                                          if (currentSrc.includes(skinId) && char.skinId && char.skinId !== char.charId) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}.png`
                                          } else if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}_2.png`
                                          } else if (currentSrc.includes('_2.png')) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}_1.png`
                                          } else {
                                            target.style.display = 'none'
                                            const fallback = target.nextElementSibling as HTMLElement
                                            if (fallback) fallback.style.display = 'flex'
                                          }
                                        }}
                                      />
                                      <div 
                                        className="w-full h-full absolute inset-0 flex items-center justify-center text-white text-xl font-bold"
                                        style={{ display: 'none' }}
                                      >
                                        {char.name.charAt(0)}
                                      </div>
                                      <div className="absolute inset-0 pointer-events-none" style={{
                                        background: `
                                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                                          linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                                          linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                                        `
                                      }}></div>
                                    </div>
                                    <div className="absolute top-1 left-1 flex flex-col items-center">
                                      <span className="text-[8px] font-medium text-white leading-none">Lv</span>
                                      <span className="text-xs font-medium text-white leading-none">{char.level}</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-center text-primary font-medium mt-1 truncate max-w-[80px]">
                                    {char.name}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className={`text-xs ${labelClass}`}>暂无助战干员</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 剿灭作战卡片 */}
                      {sklandData.campaign && (
                        <div className={`${dashboardTileClass} p-3 inline-block`}>
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-5 bg-[var(--app-accent)] rounded-full"></div>
                              <h3 className="text-sm font-bold text-primary">剿灭作战</h3>
                            </div>

                            <div className="space-y-3">
                              {/* 奖励进度 */}
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1">
                                  <div className={`text-xs ${labelClass} mb-1`}>合成玉奖励</div>
                                  <div className="text-xl font-bold text-primary">
                                    {sklandData.campaign.reward.current}
                                    <span className={`text-sm ${labelClass} font-normal`}>
                                      /{sklandData.campaign.reward.total}
                                    </span>
                                  </div>
                                </div>
                                <div className="w-12 h-12 relative flex-shrink-0">
                                  <svg className="w-12 h-12 transform -rotate-90">
                                    <circle
                                      cx="24"
                                      cy="24"
                                      r="20"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      fill="none"
                                      className="text-[var(--app-surface-muted)]"
                                    />
                                    <circle
                                      cx="24"
                                      cy="24"
                                      r="20"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      fill="none"
                                      className={sklandData.campaign.reward.current >= sklandData.campaign.reward.total ? "text-[var(--app-success)]" : "text-[var(--app-warning)]"}
                                      strokeDasharray={`${(sklandData.campaign.reward.current / sklandData.campaign.reward.total) * 125.6} 125.6`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold text-primary">
                                      {Math.round((sklandData.campaign.reward.current / sklandData.campaign.reward.total) * 100)}%
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* 状态提示 */}
                              <div className="text-center">
                                {sklandData.campaign.reward.current >= sklandData.campaign.reward.total ? (
                                  <div className="text-xs status-success rounded-full px-2 py-0.5 font-medium">
                                    ✓ 本周奖励已满
                                  </div>
                                ) : (
                                  <div className="text-xs status-warning rounded-full px-2 py-0.5 font-medium">
                                    周一 04:00 重置
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>



              {/* 2x2 网格布局：实时数据、干员统计、公开招募 */}
              <div className="grid grid-cols-2 gap-5">
                {/* 实时数据卡片 */}
                <Card theme="purple" animated delay={0.2}>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--app-border)]">
                    <div className="w-1 h-5 bg-[var(--app-accent)] rounded-full"></div>
                    <h3 className={sectionTitleClass}>实时数据</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`${dashboardTileClass} p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="text-xs font-bold text-primary">理智</span>
                        </div>
                        <span className="text-xs brand-text font-medium">
                          {sklandData.ap.current >= sklandData.ap.max ? '已满' : formatFullRecoveryTime(sklandData.ap.completeRecoveryTime)}
                        </span>
                      </div>
                      <div className="text-xl font-bold text-primary mb-1">
                        {sklandData.ap.current}
                        <span className={`text-sm ${labelClass} font-normal`}>/{sklandData.ap.max}</span>
                      </div>
                      <div className={progressTrackClass}>
                        <div
                          className={progressFillClass}
                          style={{ width: `${(sklandData.ap.current / sklandData.ap.max) * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className={`${dashboardTileClass} p-3`}>
                      <div className="text-xs font-bold text-primary mb-1">无人机</div>
                      <div className="text-xl font-bold text-primary mb-1">
                        {sklandData.building.labor.value}
                        <span className={`text-sm ${labelClass} font-normal`}>/{sklandData.building.labor.maxValue}</span>
                      </div>
                      <div className={progressTrackClass}>
                        <div 
                          className={progressFillClass}
                          style={{ width: `${(sklandData.building.labor.value / sklandData.building.labor.maxValue) * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    {sklandData.routine && (
                      <>
                        <div className={`${dashboardTileClass} p-3`}>
                          <div className="text-xs font-bold text-primary mb-1">每日任务</div>
                          <div className="text-xl font-bold text-primary mb-1">
                            {sklandData.routine.daily.current}
                            <span className={`text-sm ${labelClass} font-normal`}>/{sklandData.routine.daily.total}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: sklandData.routine?.daily.total || 0 }).map((_, i) => (
                              <div 
                                key={i} 
                                className={`h-1 flex-1 rounded-full ${i < (sklandData.routine?.daily.current || 0) ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-surface-muted)]'} transition-all`}
                              ></div>
                            ))}
                          </div>
                        </div>
                        <div className={`${dashboardTileClass} p-3`}>
                          <div className="text-xs font-bold text-primary mb-1">每周任务</div>
                          <div className="text-xl font-bold text-primary mb-1">
                            {sklandData.routine.weekly.current}
                            <span className={`text-sm ${labelClass} font-normal`}>/{sklandData.routine.weekly.total}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: sklandData.routine?.weekly.total || 0 }).map((_, i) => (
                              <div 
                                key={i} 
                                className={`h-1 flex-1 rounded-full ${i < (sklandData.routine?.weekly.current || 0) ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-surface-muted)]'} transition-all`}
                              ></div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {/* 干员统计卡片 */}
                <Card theme="violet" animated delay={0.25}>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--app-border)]">
                    <div className="w-1 h-5 bg-[var(--app-accent)] rounded-full"></div>
                    <h3 className={sectionTitleClass}>干员统计</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className={`${compactTileClass} text-center`}>
                      <div className={`text-xs font-bold ${labelClass} mb-1`}>精二干员</div>
                      <div className="text-xl font-bold text-primary">
                        {sklandData.chars.elite2}
                      </div>
                    </div>

                    <div className={`${compactTileClass} text-center`}>
                      <div className={`text-xs font-bold ${labelClass} mb-1`}>满级干员</div>
                      <div className="text-xl font-bold text-primary">
                        {sklandData.chars.maxLevel}
                      </div>
                    </div>

                    <div className={`${compactTileClass} text-center`}>
                      <div className={`text-xs font-bold ${labelClass} mb-1`}>技能7+</div>
                      <div className="text-xl font-bold text-primary">
                        {sklandData.chars.skill7Plus}
                      </div>
                    </div>

                    <div className={`${compactTileClass} text-center`}>
                      <div className={`text-xs font-bold ${labelClass} mb-1`}>干员总数</div>
                      <div className="text-xl font-bold text-primary">
                        {sklandData.chars.total}
                      </div>
                    </div>
                  </div>
                  {/* 干员培养进度条 */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={labelClass}>精二进度</span>
                      <span className="font-medium text-primary">
                        {Math.round((sklandData.chars.elite2 / sklandData.chars.total) * 100)}%
                      </span>
                    </div>
                    <div className={progressTrackClass}>
                      <div 
                        className={progressFillClass}
                        style={{ width: `${(sklandData.chars.elite2 / sklandData.chars.total) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </Card>

                {/* 公开招募卡片 */}
                {sklandData.recruit && sklandData.recruit.length > 0 && (
                  <Card theme="amber" animated delay={0.3}>
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--app-border)]">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-5 bg-[var(--app-accent)] rounded-full"></div>
                        <h3 className={sectionTitleClass}>公开招募</h3>
                      </div>
                      {sklandData.building.hire?.refreshCount !== undefined && (
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span className="text-xs font-medium brand-text">
                            {sklandData.building.hire.refreshCount}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {sklandData.recruit.slice(0, 4).map((slot, index) => {
                        // 森空岛 API 状态说明：
                        // state = -1 或 0: 空闲
                        // state = 1 或 2: 招募中（需要检查 finishTs）
                        // 如果 finishTs 已过期，则视为已完成
                        
                        let displayState: number; // 0=空闲, 1=招募中, 2=已完成
                        
                        if (slot.state === -1 || slot.state === 0) {
                          displayState = 0; // 空闲
                        } else if (!slot.finishTs || slot.finishTs <= 0) {
                          displayState = 0; // 没有有效结束时间，视为空闲
                        } else {
                          const diff = slot.finishTs * 1000 - currentTime;
                          if (diff <= 0) {
                            displayState = 2; // 时间已到，已完成
                          } else {
                            displayState = 1; // 招募中
                          }
                        }
                        return (
                          <div 
                            key={index}
                            className={recruitSlotClass(displayState)}
                          >
                          {/* 位置编号 - 左上角 */}
                          <div className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center brand-action rounded text-xs font-bold">
                            {index + 1}
                          </div>

                          {/* 状态标签 - 右上角 */}
                          <div className="flex justify-end mb-1">
                            {displayState === 0 && (
                              <span className={recruitBadgeClass(displayState)}>
                                空闲
                              </span>
                            )}
                            {displayState === 1 && (
                              <span className={recruitBadgeClass(displayState)}>
                                招募中
                              </span>
                            )}
                            {displayState === 2 && (
                              <span className={recruitBadgeClass(displayState)}>
                                已完成
                              </span>
                            )}
                          </div>

                          {displayState === 0 && (
                            <div className="text-center py-2">
                              <div className={`text-xs font-medium ${labelClass}`}>
                                未开始招募
                              </div>
                            </div>
                          )}

                          {displayState === 1 && (
                            <div className="text-center py-1">
                              <div className="text-xs font-medium brand-text">
                                {formatRecruitTime(slot.finishTs!)}
                              </div>
                              {slot.tags && slot.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 justify-center mt-1">
                                  {slot.tags.slice(0, 2).map((tag, tagIndex) => (
                                    <span 
                                      key={tagIndex}
                                      className="text-xs px-1 py-0.5 brand-chip rounded"
                                    >
                                      {tag.tagName}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {displayState === 2 && (
                            <div className="text-center py-1">
                              <div className="text-xs font-bold mb-1">
                                招募完成
                              </div>
                              {slot.tags && slot.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 justify-center">
                                  {slot.tags.slice(0, 2).map((tag, tagIndex) => (
                                    <span 
                                      key={tagIndex}
                                      className="text-xs px-1 py-0.5 brand-chip rounded"
                                    >
                                      {tag.tagName}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  </Card>
                )}

                {/* 空的第四个卡片位置 */}
                <div className={`${dashboardTileClass} p-4 flex items-center justify-center`}>
                  <div className="text-center">
                    <div className={`text-sm ${labelClass} mb-2`}>更多功能</div>
                    <div className={`text-xs ${labelClass}`}>敬请期待</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 右列：主线进度 + 基建详情 (flex-1) */}
            <div className="flex-1 flex flex-col gap-5">
              {/* 主线进度卡片 */}
              <Card theme="violet" animated delay={0.35}>
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-[var(--app-border)]">
                  <div className="w-1 h-6 bg-[var(--app-accent)] rounded-full"></div>
                  <h3 className="text-lg font-bold text-primary">主线进度</h3>
                </div>

                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-primary mb-2">
                      {sklandData.mainStageProgress.replace(/^main_/, '')}
                    </div>
                    <div className={`text-sm ${labelClass}`}>
                      当前主线进度
                    </div>
                  </div>

                  {/* 主线进度条 */}
                  {(() => {
                    // 解析主线进度，支持 "14-21" 或 "main_14-21" 格式
                    const match = sklandData.mainStageProgress?.match(/^(?:main_)?(\d+)-(\d+)$/);
                    if (match && match[1] && match[2]) {
                      const chapter = parseInt(match[1]);
                      const stage = parseInt(match[2]);
                      // 假设每章最多30关，总共16章（可根据实际情况调整）
                      const totalChapters = 16;
                      const maxStagesPerChapter = 30;
                      const totalStages = totalChapters * maxStagesPerChapter;
                      const currentStages = (chapter - 1) * maxStagesPerChapter + stage;
                      const progress = Math.min((currentStages / totalStages) * 100, 100);
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className={labelClass}>第 {chapter} 章</span>
                            <span className="font-medium brand-text">
                              {progress.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2 bg-[var(--app-surface-muted)] rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-[var(--app-accent)] transition-all duration-500 rounded-full"
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                          <div className={`text-xs text-center ${labelClass}`}>
                            已完成 {currentStages} / {totalStages} 关
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {sklandData.stageInfo && (
                    <div className={`${dashboardTileClass} p-4`}>
                      <div className="text-sm font-bold brand-text mb-2">
                        最近关卡
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-primary font-medium">
                            {sklandData.stageInfo.code}
                          </span>
                          <span className="text-xs brand-text">
                            {sklandData.stageInfo.apCost} 理智
                          </span>
                        </div>
                        <div className={`text-xs ${labelClass}`}>
                          {sklandData.stageInfo.name}
                        </div>
                        {sklandData.stageInfo.difficulty && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 brand-chip rounded">
                              {sklandData.stageInfo.difficulty}
                            </span>
                            {sklandData.stageInfo.dangerLevel && (
                              <span className="text-xs px-2 py-0.5 status-danger rounded">
                                危险等级 {sklandData.stageInfo.dangerLevel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* 基建详情卡片 */}
              <Card theme="emerald" animated delay={0.4}>
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-[var(--app-border)]">
                  <div className="w-1 h-6 bg-[var(--app-accent)] rounded-full"></div>
                  <h3 className="text-lg font-bold text-primary">基建详情</h3>
                </div>

                <div className="space-y-4">
                  {/* 制造站 */}
                  {sklandData.building.manufactures && sklandData.building.manufactures.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-primary mb-2">制造站</div>
                      <div className="grid grid-cols-1 gap-2">
                        {sklandData.building.manufactures.map((mfg: any, index: number) => {
                          // 计算产出完成时间
                          const remainSecs = mfg.remain || mfg.outputProgress?.remain || 0
                          const isComplete = remainSecs <= 0 && mfg.complete >= mfg.capacity
                          const isProducing = remainSecs > 0
                          const completeTime = remainSecs > 0 ? new Date(Date.now() + remainSecs * 1000) : null

                          return (
                          <div key={index} className={`p-3 rounded-lg border ${
                            isComplete
                              ? 'status-success border-transparent'
                              : isProducing
                              ? 'status-info border-transparent'
                              : 'surface-soft border-[var(--app-border)]'
                          }`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-primary">
                                  {mfg.formulaName || mfg.itemName || mfg.name || '制造中'}
                                </span>
                                <span className={`text-xs ${labelClass}`}>
                                  Lv.{mfg.level || 1}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {mfg.speed && (
                                  <span className="text-xs px-1.5 py-0.5 brand-chip rounded font-medium">
                                    {mfg.speed}x
                                  </span>
                                )}
                                <span className="text-xs brand-text">
                                  {mfg.workers?.length || 0}人
                                </span>
                              </div>
                            </div>
                            {mfg.capacity !== undefined && mfg.complete !== undefined && (
                              <div className="mt-2">
                                <div className={`flex justify-between text-xs ${labelClass} mb-1`}>
                                  <span>库存</span>
                                  <div className="flex items-center gap-2">
                                    <span>{mfg.complete}/{mfg.capacity}</span>
                                    {isComplete && (
                                      <span className="text-[var(--app-success)] font-medium">✓ 已满</span>
                                    )}
                                    {isProducing && (
                                      <span className="brand-text">
                                        {Math.floor(remainSecs / 3600)}:{String(Math.floor((remainSecs % 3600) / 60)).padStart(2, '0')}:{String(Math.floor(remainSecs % 60)).padStart(2, '0')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className={progressTrackClass}>
                                  <div
                                    className={`h-full transition-all duration-500 ${isComplete ? 'bg-[var(--app-success)]' : 'bg-[var(--app-accent)]'}`}
                                    style={{ width: `${Math.min((mfg.complete / mfg.capacity) * 100, 100)}%` }}
                                  ></div>
                                </div>
                                {completeTime && (
                                  <div className={`text-xs ${labelClass} mt-1 text-right`}>
                                    预计 {completeTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 贸易站 */}
                  {sklandData.building.tradings && sklandData.building.tradings.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-primary mb-2">贸易站</div>
                      <div className="grid grid-cols-1 gap-2">
                        {sklandData.building.tradings.map((trade: any, index: number) => {
                          // 计算订单完成时间
                          const orderCount = trade.stock?.length || 0
                          const isFull = orderCount >= (trade.stockLimit || 4)
                          let remainSecs = 0
                          let completeTime: Date | null = null
                          if (trade.completeWorkTime && trade.completeWorkTime > Date.now() / 1000) {
                            remainSecs = trade.completeWorkTime - Date.now() / 1000
                            completeTime = new Date(trade.completeWorkTime * 1000)
                          }

                          return (
                          <div key={index} className={`p-3 rounded-lg border ${
                            isFull
                              ? 'status-success border-transparent'
                              : remainSecs > 0
                              ? 'status-info border-transparent'
                              : 'surface-soft border-[var(--app-border)]'
                          }`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-primary">
                                  {trade.orderProgress?.strategy || trade.strategy || '贸易策略'}
                                </span>
                                <span className={`text-xs ${labelClass}`}>
                                  Lv.{trade.level || 1}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs brand-text">
                                  {trade.workers?.length || 0}人
                                </span>
                              </div>
                            </div>
                            {/* 订单进度 */}
                            <div className="mt-2">
                              <div className={`flex justify-between text-xs ${labelClass} mb-1`}>
                                <span>订单</span>
                                <div className="flex items-center gap-2">
                                  <span>{orderCount}/{trade.stockLimit || 4}</span>
                                  {isFull && (
                                    <span className="text-[var(--app-success)] font-medium">✓ 已满</span>
                                  )}
                                  {remainSecs > 0 && !isFull && (
                                    <span className="brand-text">
                                      {Math.floor(remainSecs / 3600)}:{String(Math.floor((remainSecs % 3600) / 60)).padStart(2, '0')}:{String(Math.floor(remainSecs % 60)).padStart(2, '0')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className={progressTrackClass}>
                                <div
                                  className={`h-full transition-all duration-500 ${isFull ? 'bg-[var(--app-success)]' : 'bg-[var(--app-accent)]'}`}
                                  style={{ width: `${Math.min((orderCount / (trade.stockLimit || 4)) * 100, 100)}%` }}
                                ></div>
                              </div>
                              {completeTime && !isFull && (
                                <div className={`text-xs ${labelClass} mt-1 text-right`}>
                                  预计 {completeTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                </div>
                              )}
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 会客室 */}
                  {sklandData.building.meeting && (
                    <div>
                      <div className="text-sm font-bold text-primary mb-2">会客室</div>
                      <div className={`${dashboardTileClass} p-3`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-primary">
                              线索 {sklandData.building.meeting.clue?.own || 0}/9
                            </span>
                            <span className={`text-xs ${labelClass}`}>
                              Lv.{sklandData.building.meeting.level || 1}
                            </span>
                          </div>
                          <div className="text-xs brand-text">
                            {sklandData.building.meeting.workers?.length || 0}人
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 宿舍 */}
                  {sklandData.building.dormitories && sklandData.building.dormitories.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-primary mb-2">宿舍</div>
                      <div className="grid grid-cols-2 gap-2">
                        {sklandData.building.dormitories.map((dorm: any, index: number) => {
                          // 计算宿舍心情状态
                          const workers = dorm.workers || dorm.chars || []
                          const avgMood = workers.length > 0
                            ? workers.reduce((sum: number, w: any) => sum + Math.floor((w.ap || 0) / 86400), 0) / workers.length
                            : 0
                          const moodPercent = Math.min((avgMood / 24) * 100, 100)

                          let moodText = '精力充沛'
                          if (moodPercent < 30) {
                            moodText = '疲惫'
                          } else if (moodPercent < 50) {
                            moodText = '休息中'
                          } else if (moodPercent < 80) {
                            moodText = '恢复中'
                          }

                          return (
                          <div key={index} className={`${dashboardTileClass} p-3`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-primary">
                                  宿舍{index + 1}
                                </span>
                                <span className={`text-xs ${labelClass}`}>
                                  Lv.{dorm.level || 1}
                                </span>
                              </div>
                              <span className="text-xs brand-text">
                                {workers.length}/5人
                              </span>
                            </div>
                            {/* 心情进度 */}
                            {workers.length > 0 ? (
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={`text-xs ${labelClass}`}>心情</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium brand-text">
                                      {moodText}
                                    </span>
                                    <span className="text-xs text-primary font-medium">
                                      {Math.round(avgMood)}/24
                                    </span>
                                  </div>
                                </div>
                                <div className="h-2 bg-[var(--app-surface-muted)] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[var(--app-accent)] transition-all duration-500 rounded-full"
                                    style={{ width: `${moodPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            ) : (
                              <div className={`text-xs ${labelClass} text-center py-1`}>空闲</div>
                            )}
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 训练室 */}
                  {sklandData.building.training && (
                    <div>
                      <div className="text-sm font-bold text-primary mb-2">训练室</div>
                      <div className={`p-3 rounded-lg border ${
                        sklandData.building.training.trainee
                          ? (sklandData.building.training.remainSecs || 0) <= 0
                            ? 'status-success border-transparent'
                            : 'status-warning border-transparent'
                          : 'surface-soft border-[var(--app-border)]'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${
                              sklandData.building.training.trainee
                                ? (sklandData.building.training.remainSecs || 0) <= 0
                                  ? 'text-[var(--app-success)]'
                                  : 'text-[var(--app-warning)]'
                                : labelClass
                            }`}>
                              {sklandData.building.training.trainee ? (
                                (sklandData.building.training.remainSecs || 0) <= 0 ? '训练完成' : '训练中'
                              ) : '空闲'}
                            </span>
                            <span className={`text-xs ${labelClass}`}>
                              Lv.{sklandData.building.training.level || 1}
                            </span>
                          </div>
                          {/* 训练进度 */}
                          {sklandData.building.training.trainee && (sklandData.building.training.remainSecs || 0) > 0 && (
                            <div className="text-right">
                              <div className="text-xs text-[var(--app-warning)] font-medium">
                                {Math.floor((sklandData.building.training.remainSecs || 0) / 3600)}:{String(Math.floor(((sklandData.building.training.remainSecs || 0) % 3600) / 60)).padStart(2, '0')}:{String(Math.floor((sklandData.building.training.remainSecs || 0) % 60)).padStart(2, '0')}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* 训练详情 */}
                        {sklandData.building.training.trainee && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className={labelClass}>
                                学员: {sklandData.building.training.trainee.name || sklandData.building.training.trainee.charId}
                              </span>
                              {sklandData.building.training.trainer && (
                                <span className={labelClass}>
                                  教官: {sklandData.building.training.trainer.name || sklandData.building.training.trainer.charId}
                                </span>
                              )}
                            </div>
                            {/* 训练进度条 */}
                            {(sklandData.building.training.remainSecs || 0) > 0 && (
                              <>
                                <div className={progressTrackClass}>
                                  <div
                                    className={progressFillClass}
                                    style={{
                                      width: `${Math.max(0, 100 - ((sklandData.building.training.remainSecs || 0) / (24 * 3600)) * 100)}%`
                                    }}
                                  ></div>
                                </div>
                                <div className={`text-xs ${labelClass} text-right`}>
                                  预计 {new Date(Date.now() + (sklandData.building.training.remainSecs || 0) * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                </div>
                              </>
                            )}
                            {/* 训练完成提示 */}
                            {(sklandData.building.training.remainSecs || 0) <= 0 && sklandData.building.training.trainee && (
                              <div className="text-xs text-[var(--app-success)] font-medium text-center">
                                ✓ 技能专精训练已完成
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* 最后更新时间 */}
        {lastUpdate && (
          <div className={`text-center text-sm ${labelClass}`}>
            最后更新: {lastUpdate.toLocaleString('zh-CN')}
          </div>
        )}
      </div>
    </div>
  )
}
