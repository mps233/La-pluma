import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CheckCircle2, Circle, Image as ImageIcon, Loader2, TerminalSquare, XCircle } from 'lucide-react'
import { maaApi } from '../services/api'
import type { TaskFlowItem, LogEntry, ScheduleExecutionStatus } from '@/types/components'

interface TaskStatusPayload {
  isRunning?: boolean
  taskName?: string | null
  taskType?: string | null
  startTime?: number | null
}

interface ScheduleStatusPayload extends ScheduleExecutionStatus {
  startTime?: number | null
}

interface AutomationTimelineProps {
  taskFlow: TaskFlowItem[]
  currentStep: number
  isRunning: boolean
}

const formatElapsed = (startTime?: number | null) => {
  if (!startTime) return '—'
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

const getLogTone = (level: LogEntry['level']) => {
  switch (level) {
    case 'ERROR':
      return 'text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20'
    case 'WARN':
      return 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20'
    case 'DEBUG':
      return 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.03] border-gray-100 dark:border-white/5'
    default:
      return 'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/[0.03] border-gray-100 dark:border-white/5'
  }
}

export default function AutomationTimeline({ taskFlow, currentStep, isRunning }: AutomationTimelineProps) {
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatusPayload | null>(null)
  const [taskStatus, setTaskStatus] = useState<TaskStatusPayload | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [now, setNow] = useState(Date.now())
  const lastSnapshotAtRef = useRef(0)

  const startupTask = useMemo(() => taskFlow.find(task => task.commandId === 'startup'), [taskFlow])
  const adbAddress = startupTask?.params?.address || '127.0.0.1:16384'

  const enabledTasks = useMemo(() => taskFlow.filter(task => task.enabled), [taskFlow])
  const activeIndex = scheduleStatus?.isRunning ? scheduleStatus.currentStep : currentStep
  const activeTaskName = scheduleStatus?.currentTask || taskStatus?.taskName || (activeIndex >= 0 ? enabledTasks[activeIndex]?.name : null)
  const startTime = scheduleStatus?.startTime || taskStatus?.startTime || null
  const running = Boolean(isRunning || scheduleStatus?.isRunning || taskStatus?.isRunning)
  const latestLogs = logs.slice(-5).reverse()
  const errorLogs = logs.filter(log => log.level === 'ERROR').slice(-2)

  const refreshSnapshot = async () => {
    setSnapshotLoading(true)
    try {
      const result = await maaApi.captureScreen(adbAddress)
      const image = result?.data?.image
      if (result.success && image) {
        setSnapshot(image)
        lastSnapshotAtRef.current = Date.now()
      }
    } catch {
      // 截图失败不影响任务时间线展示
    } finally {
      setSnapshotLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const [scheduleResult, taskResult, logsResult] = await Promise.all([
          maaApi.getScheduleExecutionStatus(),
          maaApi.getTaskStatus(),
          maaApi.getRealtimeLogs(120)
        ])

        if (cancelled) return

        if (scheduleResult.success) setScheduleStatus(scheduleResult.data)
        if (taskResult.success) setTaskStatus(taskResult.data)
        if (logsResult.success && Array.isArray(logsResult.data)) setLogs(logsResult.data)
      } catch {
        // 保持旧数据，避免状态卡片闪烁
      } finally {
        if (!cancelled) setNow(Date.now())
      }
    }

    refresh()
    const interval = window.setInterval(refresh, running ? 2000 : 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [running])

  useEffect(() => {
    if (!running || snapshotLoading) return
    if (Date.now() - lastSnapshotAtRef.current < 30000) return
    void refreshSnapshot()
  }, [running, activeTaskName, snapshotLoading])

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 transition-colors dark:border-white/10 dark:bg-[rgba(15,15,15,0.6)]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-500" strokeWidth={1.8} />
            <h3 className="text-base font-bold text-gray-900 dark:text-white">运行时间线</h3>
            <span className={`rounded-lg px-2 py-1 text-xs font-medium ${running ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'}`}>
              {running ? '执行中' : '空闲'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">任务阶段、最近日志、当前快照和耗时</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[220px]">
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
            <div className="text-[10px] uppercase tracking-wider text-gray-400">当前任务</div>
            <div className="mt-1 truncate font-semibold text-gray-900 dark:text-white">{activeTaskName || '—'}</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
            <div className="text-[10px] uppercase tracking-wider text-gray-400">已运行</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-white">{formatElapsed(startTime || (running ? now : null))}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {enabledTasks.length > 0 ? enabledTasks.map((task, index) => {
            const isCurrent = running && index === activeIndex
            const isDone = running ? index < activeIndex : false
            return (
              <div key={task.id} className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors ${isCurrent ? 'border-violet-200 bg-violet-50/70 dark:border-violet-500/25 dark:bg-violet-500/10' : 'border-gray-100 bg-gray-50/50 dark:border-white/5 dark:bg-white/[0.025]'}`}>
                <div className="mt-0.5">
                  {isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin text-violet-500" strokeWidth={1.8} />
                  ) : isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.8} />
                  ) : (
                    <Circle className="h-4 w-4 text-gray-300 dark:text-gray-600" strokeWidth={1.8} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">#{index + 1}</span>
                    <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{task.name}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-gray-400">{isCurrent ? (scheduleStatus?.message || '正在执行') : isDone ? '已完成当前阶段' : task.description}</p>
                </div>
              </div>
            )
          }) : (
            <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400 dark:border-white/10">
              暂无任务流程，添加任务后会在这里显示执行阶段
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-950 dark:border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-medium text-white/80">
                <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                当前快照
              </div>
              <button
                type="button"
                onClick={() => void refreshSnapshot()}
                disabled={snapshotLoading}
                className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                {snapshotLoading ? '截图中' : '刷新'}
              </button>
            </div>
            <div className="aspect-video bg-black">
              {snapshot ? (
                <img src={snapshot} alt="当前任务快照" draggable={false} className="h-full w-full select-none object-contain pointer-events-none" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),transparent_45%)] text-white/45">
                  <ImageIcon className="h-6 w-6" strokeWidth={1.5} />
                  <span className="text-xs">运行中会自动保留快照</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/[0.025]">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
              <TerminalSquare className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.8} />
              最近日志
            </div>
            <div className="space-y-1.5">
              {latestLogs.length > 0 ? latestLogs.map((log, index) => (
                <div key={`${log.time}-${index}`} className={`rounded-lg border px-2.5 py-1.5 text-xs ${getLogTone(log.level)}`}>
                  <span className="mr-2 font-mono text-[10px] opacity-60">{new Date(log.time).toLocaleTimeString()}</span>
                  <span className="font-medium">{log.level}</span>
                  <span className="ml-2 break-words">{log.message}</span>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400 dark:border-white/10">暂无实时日志</div>
              )}
            </div>
          </div>

          {errorLogs.length > 0 && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <XCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                最近错误
              </div>
              {errorLogs.map((log, index) => (
                <div key={`${log.time}-error-${index}`} className="mt-1 break-words opacity-90">{log.message}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
