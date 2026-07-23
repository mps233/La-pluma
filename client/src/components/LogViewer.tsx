import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  List,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { maaApi } from '../services/api'
import {
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Button,
  IconButton,
  Select,
  Input,
  Loading,
  ConfirmDialog,
  SmoothPanel,
  Switch,
} from './common'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import type { LogEntry, LogFile } from '@/types/components'

type LogFilter = 'all' | LogEntry['level']
type LogContentMode = 'summary' | 'raw'
type ConfirmAction = 'clear' | 'cleanup'
type Notice = { type: 'success' | 'error'; text: string }
type VisibleLog = LogEntry & { count: number }

const LOG_LEVELS: LogEntry['level'][] = ['ERROR', 'WARN', 'INFO', 'DEBUG']
const CONTENT_MODE_OPTIONS: ReadonlyArray<{ id: LogContentMode; label: string; description: string }> = [
  { id: 'summary', label: '摘要', description: '关键事件' },
  { id: 'raw', label: '原始', description: '完整内容' },
]
const LOG_LEVEL_ALIASES: Record<string, LogEntry['level']> = {
  ERR: 'ERROR',
  ERROR: 'ERROR',
  WRN: 'WARN',
  WARN: 'WARN',
  WARNING: 'WARN',
  INF: 'INFO',
  INFO: 'INFO',
  DBG: 'DEBUG',
  DEBUG: 'DEBUG',
  TRC: 'DEBUG',
  TRACE: 'DEBUG',
}

function normalizeLevel(value: unknown): LogEntry['level'] {
  const rawLevel = String(value || '').toUpperCase()
  const level = LOG_LEVEL_ALIASES[rawLevel] || rawLevel as LogEntry['level']
  return LOG_LEVELS.includes(level) ? level : 'INFO'
}

function formatLogTime(value: unknown): string {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''

  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => part.toString().padStart(2, '0'))
    .join(':')
}

function parseRealtimeLog(value: unknown): LogEntry {
  const log = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const message = String(log.message ?? '')
  const parsedOutput = parseHistoryLine(message)
  if (parsedOutput.time) return parsedOutput

  return {
    time: formatLogTime(log.time),
    level: normalizeLevel(log.level),
    message,
  }
}

function parseHistoryLine(line: string): LogEntry {
  const bracketedMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})(?:\.\d+)?)\]\[([A-Za-z]+)\](?:\[[^\]]*\])*\s*(.*)$/)
  if (bracketedMatch) {
    return {
      time: bracketedMatch[2] || '',
      level: normalizeLevel(bracketedMatch[3]),
      message: bracketedMatch[4] || line,
    }
  }

  const match = line.match(/\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})) (\w+)\] (.+)/)
  if (!match) return { time: '', level: 'INFO', message: line }

  return {
    time: match[2] || '',
    level: normalizeLevel(match[3]),
    message: match[4] || line,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const TASK_NAMES: Record<string, string> = {
  StartUp: '启动游戏',
  CloseDown: '关闭游戏',
  Fight: '作战',
  Award: '领取奖励',
  Mall: '信用商店',
  Recruit: '自动公招',
  Infrast: '基建换班',
  Depot: '仓库识别',
  Roguelike: '集成战略',
  ReclamationAlgorithm: '生息演算',
  Copilot: '作业执行',
  SSSCopilot: '保全作业',
}

function getTaskName(value: unknown): string {
  const name = String(value || '').trim()
  return TASK_NAMES[name] || name.replace(/Task(?:Plugin)?$/, '') || '未知任务'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function summarizeCallback(log: LogEntry): LogEntry | null {
  const match = log.message.match(/^Assistant::append_callback \| (\w+)\s+(\{.*\})$/)
  if (!match) return null

  let payload: Record<string, unknown>
  try {
    payload = asRecord(JSON.parse(match[2] || '{}'))
  } catch {
    return log
  }

  const event = match[1]
  const details = asRecord(payload.details)
  const taskName = getTaskName(payload.taskchain || payload.subtask || payload.class)

  switch (event) {
    case 'TaskChainStart':
      return { ...log, message: `任务开始：${taskName}` }
    case 'TaskChainCompleted':
      return { ...log, message: `任务完成：${taskName}` }
    case 'TaskChainError':
      return { ...log, level: 'ERROR', message: `任务失败：${taskName}` }
    case 'SubTaskError':
      return { ...log, level: 'ERROR', message: `执行步骤失败：${taskName}` }
    case 'AllTasksCompleted':
    case 'SubTaskStart':
    case 'SubTaskCompleted':
      return null
    case 'SubTaskExtraInfo':
      return payload.what === 'DepotInfo'
        ? { ...log, message: '仓库识别数据已生成' }
        : null
    case 'AsyncCallInfo':
      if (payload.what !== 'Connect') return null
      return {
        ...log,
        message: details.ret === true
          ? `设备连接完成${details.cost ? `，耗时 ${details.cost} ms` : ''}`
          : '设备连接失败',
        level: details.ret === true ? log.level : 'ERROR',
      }
    case 'ConnectionInfo':
      switch (payload.what) {
        case 'Connected':
          return { ...log, message: `设备连接成功${details.address ? `：${details.address}` : ''}` }
        case 'ResolutionGot':
        case 'ResolutionInfo':
          return details.width && details.height
            ? { ...log, message: `设备分辨率：${details.width} x ${details.height}` }
            : null
        case 'FastestWayToScreencap':
          return details.method
            ? { ...log, message: `已选择截图方式：${details.method}${details.cost ? `（${details.cost} ms）` : ''}` }
            : null
        default:
          return null
      }
    default:
      return null
  }
}

function summarizeLog(log: LogEntry): LogEntry | null {
  if (log.level === 'DEBUG' || !log.time) return null

  const callback = summarizeCallback(log)
  if (log.message.startsWith('Assistant::append_callback |')) return callback

  const message = log.message.trim()
  if (!message || /^[{}"]/.test(message) || message.startsWith('{')) return null

  if (/^执行命令:\s+maa\s+(?:dir log|activity\b)/.test(message)) return null

  const stateUpdate = message.match(/^任务状态更新:\s+(\{.*\})$/)
  if (stateUpdate) {
    try {
      const state = asRecord(JSON.parse(stateUpdate[1] || '{}'))
      return state.isRunning === true
        ? { ...log, message: `任务开始：${getTaskName(state.taskName || state.taskType)}` }
        : { ...log, message: '任务执行结束' }
    } catch {
      return null
    }
  }

  const commandStart = message.match(/^执行命令:\s+maa\s+(\w+)(?:\s+.*?)?,\s*等待完成:\s*(?:true|false)$/)
  if (commandStart) {
    const commandNames: Record<string, string> = {
      run: '自动化任务',
      startup: '启动游戏',
      fight: '理智作战',
      roguelike: '集成战略',
      copilot: '作业执行',
    }
    return { ...log, message: `开始执行：${commandNames[commandStart[1] || ''] || commandStart[1]}` }
  }

  const commandEnd = message.match(/^命令执行完成:\s+maa\s+(.+?),\s*退出码:\s*(-?\d+)$/)
  if (commandEnd) {
    const exitCode = Number(commandEnd[2])
    return {
      ...log,
      level: exitCode === 0 ? log.level : 'ERROR',
      message: exitCode === 0 ? 'MAA 命令执行完成' : `MAA 命令执行失败，退出码 ${exitCode}`,
    }
  }

  if (message.startsWith('临时任务文件已创建:')) return null
  if (message.startsWith('stdout:')) return { ...log, message: `MAA 输出：${message.slice(7).trim()}` }
  if (message.startsWith('stderr:')) return { ...log, level: 'WARN', message: `MAA 提示：${message.slice(7).trim()}` }

  const queuedTask = message.match(/^append_task\s+(\w+)\s*\{?$/)
  if (queuedTask) return { ...log, message: `任务已加入队列：${getTaskName(queuedTask[1])}` }

  if (message === 'Start | block') return { ...log, message: '任务执行开始' }
  if (message === 'Stop | block') return { ...log, message: '任务执行结束' }
  if (message.startsWith('timeout when waiting socket connection')) {
    return { ...log, level: 'WARN', message: '截图通道连接超时，正在切换备用方案' }
  }
  if (message.startsWith('Killing child `')) {
    return { ...log, level: 'ERROR', message: '已终止超时的截图进程' }
  }
  if (message.startsWith('Call `') && message.endsWith('failed')) {
    return { ...log, level: 'WARN', message: 'ADB 调用失败，正在尝试备用方案' }
  }
  if (message === 'data is empty!') {
    return { ...log, level: 'WARN', message: '截图数据为空，正在切换备用方案' }
  }

  const noisyInfo = /^(Call `|record path |load |already loaded |load ret |set_instance_option |append_task \| task_id|Candidate templates count:|Item id:|command server start |touch_program |pipe str|minitouch key props|adb -s |Try to find |Raw\w+ is not supported|screencap_end_of_line|Encode cost |The fastest way is )/
  if (log.level === 'INFO' && noisyInfo.test(message)) return null

  return { ...log, message }
}

export default function LogViewer() {
  const shouldReduceMotion = useReducedMotion()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [contentMode, setContentMode] = useState<LogContentMode>('summary')
  const [filter, setFilter] = useState<LogFilter>('all')
  const [search, setSearch] = useState('')
  const [collapseRepeats, setCollapseRepeats] = useState(true)
  const [historyFiles, setHistoryFiles] = useState<LogFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null)
  const [viewingHistory, setViewingHistory] = useState(false)
  const [realtimeError, setRealtimeError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const {
    containerRef: contentModeTabsRef,
    activeRect: activeContentModeRect,
    setTabRef: setContentModeTabRef,
    handleTabKeyDown: handleContentModeKeyDown,
  } = useFluidTabIndicator(contentMode)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const viewingHistoryRef = useRef(false)
  const mountedRef = useRef(true)
  const realtimeAbortRef = useRef<AbortController | null>(null)
  const realtimeRequestIdRef = useRef(0)
  const realtimePausedRef = useRef(false)
  const historyRequestIdRef = useRef(0)

  const loadRealtimeLogs = useCallback(async () => {
    if (viewingHistoryRef.current || realtimePausedRef.current || document.hidden || realtimeAbortRef.current) return

    const controller = new AbortController()
    const requestId = ++realtimeRequestIdRef.current
    realtimeAbortRef.current = controller

    try {
      const result = await maaApi.getRealtimeLogs(200, controller.signal)
      if (!result.success) throw new Error(result.message || '实时日志请求失败')

      if (
        mountedRef.current
        && requestId === realtimeRequestIdRef.current
        && !viewingHistoryRef.current
        && !document.hidden
      ) {
        const values = Array.isArray(result.data) ? result.data : []
        setLogs(values.map(parseRealtimeLog))
        setRealtimeError(null)
      }
    } catch (error) {
      if (
        mountedRef.current
        && !controller.signal.aborted
        && requestId === realtimeRequestIdRef.current
        && !viewingHistoryRef.current
      ) {
        setRealtimeError(getErrorMessage(error, '暂时无法获取实时日志'))
      }
    } finally {
      if (realtimeAbortRef.current === controller) realtimeAbortRef.current = null
    }
  }, [])

  const loadHistoryFiles = useCallback(async () => {
    try {
      const result = await maaApi.getLogFiles()
      if (!result.success) throw new Error(result.message || '历史日志请求失败')
      if (!mountedRef.current) return

      setHistoryFiles(Array.isArray(result.data) ? result.data : [])
      setHistoryError(null)
    } catch (error) {
      if (mountedRef.current) {
        setHistoryError(getErrorMessage(error, '暂时无法获取历史日志'))
      }
    }
  }, [])

  const stopRealtimeRequest = useCallback(() => {
    realtimeRequestIdRef.current += 1
    realtimeAbortRef.current?.abort()
    realtimeAbortRef.current = null
  }, [])

  const viewHistoryFile = async (file: LogFile) => {
    const requestId = ++historyRequestIdRef.current
    viewingHistoryRef.current = true
    stopRealtimeRequest()
    setViewingHistory(true)
    setSelectedFile(file)
    setAutoScroll(false)
    setLoading(true)
    setRealtimeError(null)
    setHistoryError(null)

    try {
      const result = await maaApi.readLogFile(file.path, 1000)
      if (!result.success) throw new Error(result.message || '读取日志文件失败')
      if (!mountedRef.current || !viewingHistoryRef.current || requestId !== historyRequestIdRef.current) return

      const content = typeof result.data?.content === 'string' ? result.data.content : ''
      setLogs(content.split('\n').filter((line: string) => line.trim()).map(parseHistoryLine))
    } catch (error) {
      if (!mountedRef.current || !viewingHistoryRef.current || requestId !== historyRequestIdRef.current) return
      setLogs([])
      setHistoryError(getErrorMessage(error, '读取日志文件失败'))
    } finally {
      if (mountedRef.current && requestId === historyRequestIdRef.current) setLoading(false)
    }
  }

  const backToRealtime = () => {
    historyRequestIdRef.current += 1
    viewingHistoryRef.current = false
    setViewingHistory(false)
    setSelectedFile(null)
    setAutoScroll(true)
    setHistoryError(null)
    setLoading(false)
    setLogs([])
    void loadRealtimeLogs()
  }

  useEffect(() => {
    mountedRef.current = true
    void loadHistoryFiles()
    void loadRealtimeLogs()

    const intervalId = window.setInterval(() => void loadRealtimeLogs(), 1250)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopRealtimeRequest()
      } else if (!viewingHistoryRef.current) {
        void loadRealtimeLogs()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      mountedRef.current = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopRealtimeRequest()
    }
  }, [loadHistoryFiles, loadRealtimeLogs, stopRealtimeRequest])

  useEffect(() => {
    if (autoScroll && !viewingHistory && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll, viewingHistory])

  const readableLogs = useMemo(() => {
    if (contentMode === 'raw') return logs
    return logs.map(summarizeLog).filter((log): log is LogEntry => log !== null)
  }, [contentMode, logs])

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    return readableLogs.filter(log => {
      const matchesLevel = filter === 'all' || log.level === filter
      const matchesSearch = !query || `${log.time} ${log.level} ${log.message}`.toLocaleLowerCase('zh-CN').includes(query)
      return matchesLevel && matchesSearch
    })
  }, [filter, readableLogs, search])

  const visibleLogs = useMemo<VisibleLog[]>(() => {
    if (!collapseRepeats) return filteredLogs.map(log => ({ ...log, count: 1 }))

    return filteredLogs.reduce<VisibleLog[]>((entries, log) => {
      const previous = entries[entries.length - 1]
      if (previous && previous.level === log.level && previous.message === log.message) {
        previous.count += 1
        previous.time = log.time || previous.time
      } else {
        entries.push({ ...log, count: 1 })
      }
      return entries
    }, [])
  }, [collapseRepeats, filteredLogs])

  const clearLogs = async () => {
    if (viewingHistoryRef.current) return false
    realtimePausedRef.current = true
    stopRealtimeRequest()
    setActionBusy(true)
    setNotice(null)
    try {
      const result = await maaApi.clearRealtimeLogs()
      if (!result.success) throw new Error(result.message || '清空实时日志失败')
      setLogs([])
      setRealtimeError(null)
      setNotice({ type: 'success', text: result.message || '实时日志已清空' })
    } catch (error) {
      const message = getErrorMessage(error, '清空实时日志失败')
      setNotice({ type: 'error', text: message })
      throw new Error(message)
    } finally {
      realtimePausedRef.current = false
      setActionBusy(false)
    }
  }

  const cleanupHistoryLogs = async () => {
    setActionBusy(true)
    setNotice(null)
    try {
      const result = await maaApi.cleanupLogs(10)
      if (!result.success) throw new Error(result.message || '清理历史日志失败')
      setNotice({ type: 'success', text: result.message || '历史日志清理完成' })
      await loadHistoryFiles()
    } catch (error) {
      const message = getErrorMessage(error, '清理历史日志失败')
      setNotice({ type: 'error', text: message })
      throw new Error(message)
    } finally {
      setActionBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (confirmAction === 'clear') return clearLogs()
    if (confirmAction === 'cleanup') return cleanupHistoryLogs()
    return false
  }

  const exportLogs = () => {
    const logText = filteredLogs.map(log => `[${log.time}] [${log.level}] ${log.message}`).join('\n')
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `maa-log-${new Date().toISOString().split('T')[0]}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const activeError = viewingHistory ? historyError : realtimeError
  const isSummaryEmpty = logs.length > 0 && readableLogs.length === 0
  const isFilteredEmpty = readableLogs.length > 0 && visibleLogs.length === 0
  const retryActiveLogs = () => {
    if (viewingHistory && selectedFile) void viewHistoryFile(selectedFile)
    else void loadRealtimeLogs()
  }

  return (
    <div className="app-page log-viewer ios-workspace-page">
      <div className="app-stack-section">
        <PageHeader
          title="日志"
          subtitle="实时查看任务执行与历史记录"
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        {notice && (
          <SmoothPanel
            cornerSize="compact"
            surfaceClassName={`log-notice ${notice.type === 'error' ? 'is-error' : 'is-success'}`}
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live={notice.type === 'error' ? 'assertive' : 'polite'}
          >
            {notice.type === 'error'
              ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{notice.text}</span>
            <IconButton
              icon={<X className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setNotice(null)}
              variant="ghost"
              size="sm"
              title="关闭提示"
              aria-label="关闭提示"
            />
          </SmoothPanel>
        )}

        <div className="app-workspace-segments app-liquid-tab-pill log-mode-shell">
          <div
            ref={contentModeTabsRef}
            className="app-workspace-segment-list log-mode-tabs"
            role="tablist"
            aria-label="日志内容模式"
          >
            {activeContentModeRect.width > 0 && (
              <motion.div
                data-testid="log-mode-highlight"
                aria-hidden="true"
                className="app-workspace-segment-indicator log-mode-highlight"
                initial={false}
                animate={{
                  x: activeContentModeRect.x,
                  y: activeContentModeRect.y,
                  width: activeContentModeRect.width,
                  height: activeContentModeRect.height,
                }}
                transition={shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
              />
            )}
            {CONTENT_MODE_OPTIONS.map(option => {
              const selected = contentMode === option.id
              const ModeIcon = option.id === 'summary' ? List : FileText
              return (
                <button
                  key={option.id}
                  ref={setContentModeTabRef(option.id)}
                  type="button"
                  role="tab"
                  onClick={() => setContentMode(option.id)}
                  onKeyDown={event => handleContentModeKeyDown(
                    event,
                    CONTENT_MODE_OPTIONS.map(({ id }) => id),
                    setContentMode,
                  )}
                  aria-selected={selected}
                  aria-controls="log-console-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`app-workspace-segment log-mode-button min-h-11 ${selected ? 'is-selected' : ''}`}
                >
                  <span className="app-workspace-segment-icon log-mode-icon" aria-hidden="true">
                    <ModeIcon />
                  </span>
                  <span className="app-workspace-segment-copy">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <Card className="log-card log-toolbar-card !p-0" animated delay={0.1} smoothCorners>
          <CardContent className="log-toolbar">
            <div className="log-toolbar-controls">
              <div className={`surface-soft flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl px-3 ${viewingHistory ? 'opacity-50' : ''}`}>
                <span className="truncate text-xs font-medium text-secondary">自动滚动</span>
                <Switch
                  compact
                  checked={autoScroll}
                  onChange={setAutoScroll}
                  label="自动滚动"
                  disabled={viewingHistory}
                />
              </div>
              <div className="surface-soft flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl px-3">
                <span className="truncate text-xs font-medium text-secondary">折叠重复</span>
                <Switch
                  compact
                  checked={collapseRepeats}
                  onChange={setCollapseRepeats}
                  label="折叠重复日志"
                />
              </div>
              <Select
                value={filter}
                onChange={value => setFilter(value as LogFilter)}
                aria-label="日志级别"
                className="col-span-2 w-full sm:col-auto sm:w-36"
                options={[
                  { value: 'all', label: '全部级别' },
                  { value: 'ERROR', label: '错误' },
                  { value: 'WARN', label: '警告' },
                  { value: 'INFO', label: '信息' },
                  { value: 'DEBUG', label: '调试' },
                ]}
              />
              <Input
                value={search}
                onChange={setSearch}
                placeholder="搜索日志内容"
                aria-label="搜索日志内容"
                icon={<Search className="h-4 w-4" aria-hidden="true" />}
                className="col-span-2 w-full sm:col-auto sm:min-w-56 sm:flex-1"
              />
            </div>
            <div className="log-toolbar-actions">
              {!viewingHistory && (
                <Button
                  onClick={() => setConfirmAction('clear')}
                  variant="outline"
                  size="sm"
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={actionBusy}
                >
                  清空
                </Button>
              )}
              <Button
                onClick={exportLogs}
                variant="primary"
                size="sm"
                icon={<Download className="h-4 w-4" aria-hidden="true" />}
                disabled={filteredLogs.length === 0}
              >
                导出
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="log-card min-w-0 !p-0" animated delay={0.16} smoothCorners>
          <CardHeader
            title={viewingHistory ? '历史日志' : '实时日志'}
            actions={
              <div className="log-console-heading-actions">
                <span className="log-count">{visibleLogs.length} 条</span>
                {viewingHistory && (
                  <Button
                    onClick={backToRealtime}
                    variant="outline"
                    size="sm"
                    icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                  >
                    返回实时
                  </Button>
                )}
              </div>
            }
          />
          <CardContent className="log-console-content">
            {viewingHistory && selectedFile && (
              <div className="surface-soft mb-3 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs text-secondary">
                <FileText className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-primary" title={selectedFile.name}>
                  {selectedFile.name}
                </span>
                <span className="hidden shrink-0 text-tertiary sm:inline">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </span>
              </div>
            )}
            {loading ? (
              <div id="log-console-panel" className="log-console" aria-busy="true">
                <div className="flex min-h-full items-center justify-center font-sans">
                  <Loading text="正在读取日志..." />
                </div>
              </div>
            ) : (
              <div
                id="log-console-panel"
                ref={logContainerRef}
                className="log-console"
                role="log"
                aria-label="日志内容"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {activeError && (
                  <div
                    className={`log-console-state is-error flex-wrap ${logs.length > 0 ? 'status-danger m-3 !min-h-0 !justify-start !p-3 text-left font-sans text-sm' : ''}`}
                    role="alert"
                  >
                    <AlertCircle className="h-5 w-5" aria-hidden="true" />
                    <span>{activeError}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={retryActiveLogs}
                    >
                      重新加载
                    </Button>
                  </div>
                )}
                {!activeError && logs.length === 0 && (
                  <div className="log-console-state">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                    <span>{viewingHistory ? '这个日志文件没有内容' : '暂无实时日志，等待任务执行'}</span>
                  </div>
                )}
                {!activeError && isSummaryEmpty && (
                  <div className="log-console-state">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                    <span>当前日志没有需要关注的事件</span>
                  </div>
                )}
                {!activeError && isFilteredEmpty && (
                  <div className="log-console-state">
                    <Search className="h-5 w-5" aria-hidden="true" />
                    <span>没有符合当前筛选条件的日志</span>
                  </div>
                )}
                {visibleLogs.map((log, index) => (
                  <div className="log-row" key={`${log.time}-${log.level}-${log.message}-${index}`}>
                    <div className="log-row-meta">
                      {log.time && <time>{log.time}</time>}
                      <span className={`log-level is-${log.level.toLowerCase()}`}>{log.level}</span>
                    </div>
                    <div className="log-message">
                      <span>{log.message}</span>
                      {collapseRepeats && log.count > 1 && <span className="log-repeat">x{log.count}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="log-card log-history-card min-w-0 !p-0" animated delay={0.22} smoothCorners>
          <CardHeader
            title="历史日志文件"
            actions={
              <div className="log-console-heading-actions">
                <span className="log-count hidden sm:inline-flex">{historyFiles.length} 个</span>
                <Button
                  onClick={() => setConfirmAction('cleanup')}
                  variant="outline"
                  size="sm"
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={actionBusy || historyFiles.length === 0 || viewingHistory}
                >
                  清理旧日志
                </Button>
              </div>
            }
          />
          <CardContent className="log-history-content">
            {historyError && !viewingHistory && (
              <div className="log-history-state is-error flex-wrap px-4 py-6" role="alert">
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
                <span>{historyError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadHistoryFiles()}>
                  重新加载
                </Button>
              </div>
            )}
            {!historyError && historyFiles.length === 0 && (
              <div className="log-history-state">
                <FileText className="h-5 w-5" aria-hidden="true" />
                <div>
                  <p>暂无历史日志文件</p>
                  <span>执行任务后会自动生成</span>
                </div>
              </div>
            )}
            {!historyError && historyFiles.length > 0 && (
              <div className="log-history-list">
                {historyFiles.map(file => (
                  <button
                    type="button"
                    key={file.path}
                    onClick={() => void viewHistoryFile(file)}
                    className={`log-history-row ${selectedFile?.path === file.path ? 'is-active' : ''}`}
                    aria-current={selectedFile?.path === file.path ? 'true' : undefined}
                  >
                    <span className="log-history-icon"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                    <span className="log-history-copy">
                      <strong title={file.name}>{file.name}</strong>
                      <small>{new Date(file.modified).toLocaleString('zh-CN')} · {(file.size / 1024).toFixed(2)} KB</small>
                    </span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ConfirmDialog
          isOpen={confirmAction !== null}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
          title={confirmAction === 'clear' ? '清空实时日志？' : '清理旧日志文件？'}
          message={confirmAction === 'clear'
            ? '这会清空当前会话中的实时日志缓存，历史日志文件不会受到影响。'
            : '系统会删除较旧的日志文件，只保留最新的 10 MB。此操作无法撤销。'}
          confirmText={confirmAction === 'clear' ? '确认清空' : '确认清理'}
          variant="danger"
        />
      </div>
    </div>
  )
}
