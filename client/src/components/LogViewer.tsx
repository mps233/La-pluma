import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Search,
  Trash2,
} from 'lucide-react'
import Icons from './Icons'
import { maaApi } from '../services/api'
import {
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Button,
  Select,
  Checkbox,
  Input,
  Loading,
  ConfirmDialog,
} from './common'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type { LogViewerProps, LogEntry, LogFile } from '@/types/components'

type LogFilter = 'all' | LogEntry['level']
type ConfirmAction = 'clear' | 'cleanup'
type Notice = { type: 'success' | 'error'; text: string }
type VisibleLog = LogEntry & { count: number }

const LOG_LEVELS: LogEntry['level'][] = ['ERROR', 'WARN', 'INFO', 'DEBUG']
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
  return {
    time: formatLogTime(log.time),
    level: normalizeLevel(log.level),
    message: String(log.message ?? ''),
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

export default function LogViewer({}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
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

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    return logs.filter(log => {
      const matchesLevel = filter === 'all' || log.level === filter
      const matchesSearch = !query || `${log.time} ${log.level} ${log.message}`.toLocaleLowerCase('zh-CN').includes(query)
      return matchesLevel && matchesSearch
    })
  }, [filter, logs, search])

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
    if (viewingHistoryRef.current) return
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
      setNotice({ type: 'error', text: getErrorMessage(error, '清空实时日志失败') })
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
      setNotice({ type: 'error', text: getErrorMessage(error, '清理历史日志失败') })
    } finally {
      setActionBusy(false)
    }
  }

  const handleConfirm = () => {
    if (confirmAction === 'clear') void clearLogs()
    if (confirmAction === 'cleanup') void cleanupHistoryLogs()
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
  const isFilteredEmpty = logs.length > 0 && visibleLogs.length === 0

  return (
    <div className="app-page app-stack-section log-viewer">
      <div className="log-page-header">
        <PageHeader
          icon={<Icons.DocumentTextIcon />}
          title="日志查看器"
          subtitle="实时查看和管理 MAA 运行日志"
          actions={<FloatingStatusIndicator />}
        />
      </div>

      {notice && (
        <div className={`log-notice ${notice.type === 'error' ? 'is-error' : 'is-success'}`} role="status">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">关闭</button>
        </div>
      )}

      <Card className="log-card log-toolbar-card" animated delay={0.1} theme="cyan">
        <CardContent className="log-toolbar">
          <div className="log-toolbar-controls">
            <Checkbox
              checked={autoScroll}
              onChange={setAutoScroll}
              label="自动滚动"
              disabled={viewingHistory}
              color="cyan"
            />
            <Checkbox
              checked={collapseRepeats}
              onChange={setCollapseRepeats}
              label="折叠重复"
              color="cyan"
            />
            <Select
              value={filter}
              onChange={value => setFilter(value as LogFilter)}
              aria-label="日志级别"
              className="log-filter"
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
              className="log-search"
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

      <Card className="log-card" animated delay={0.16} theme="cyan">
        <CardHeader
          title={viewingHistory ? selectedFile?.name || '历史日志' : '实时日志'}
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
          {loading ? (
            <Loading text="正在读取日志..." />
          ) : (
            <div ref={logContainerRef} className="log-console" role="log" aria-label="日志内容">
              {activeError && (
                <div className="log-console-state is-error" role="alert">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  <span>{activeError}</span>
                </div>
              )}
              {!activeError && logs.length === 0 && (
                <div className="log-console-state">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                  <span>{viewingHistory ? '这个日志文件没有内容' : '暂无实时日志，等待任务执行'}</span>
                </div>
              )}
              {!activeError && isFilteredEmpty && (
                <div className="log-console-state">
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <span>没有符合当前筛选条件的日志</span>
                </div>
              )}
              {!activeError && visibleLogs.map((log, index) => (
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

      <Card className="log-card" animated delay={0.22} theme="cyan">
        <CardHeader
          title="历史日志文件"
          actions={
            <Button
              onClick={() => setConfirmAction('cleanup')}
              variant="outline"
              size="sm"
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              disabled={actionBusy || historyFiles.length === 0 || viewingHistory}
            >
              清理旧日志
            </Button>
          }
        />
        <CardContent className="log-history-content">
          {historyError && !viewingHistory && (
            <div className="log-history-state is-error" role="alert">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              <span>{historyError}</span>
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
                >
                  <span className="log-history-icon"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="log-history-copy">
                    <strong>{file.name}</strong>
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
  )
}
