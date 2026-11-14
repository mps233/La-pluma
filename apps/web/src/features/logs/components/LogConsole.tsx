import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { AlertCircle, ArrowDown, ArrowLeft, FileText, Search } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Loading } from '@/shared/components'
import { countAppendedRows, initialLogFollowState, reduceLogFollow } from '../model/logFollow'
import { getLogIdentity, getLogSourceText, type LogView } from '../model/logModel'
import type { LogEntry, LogFile } from '../types'

/** 距底部小于该值视为仍在底部，吸收取整与吸附误差。 */
const FOLLOW_BOTTOM_GAP_PX = 4

interface LogConsoleProps {
  readonly viewingHistory: boolean
  readonly selectedFile: LogFile | null
  readonly loading: boolean
  readonly error: string | null
  readonly logs: readonly LogEntry[]
  readonly view: LogView
  readonly autoScroll: boolean
  readonly paused: boolean
  readonly onRetry: () => void
  readonly onBackToRealtime: () => void
  readonly scopeKey?: string
}

export default function LogConsole({
  viewingHistory,
  selectedFile,
  loading,
  error,
  logs,
  view,
  autoScroll,
  paused,
  onRetry,
  onBackToRealtime,
  scopeKey = '',
}: LogConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [follow, dispatchFollow] = useReducer(reduceLogFollow, initialLogFollowState)
  const followEligible = autoScroll && !viewingHistory
  const headingTitle = viewingHistory ? '历史日志' : '实时日志'
  // 读取暂停、查看历史或上滑回顾旧行时都不应继续播报新增行，
  // 否则屏幕阅读器会在用户主动停留的位置持续打断。
  const liveRegionMuted = paused || viewingHistory || (followEligible && follow.paused)

  const layoutFingerprint = useMemo(() => JSON.stringify(view.visible.map(group => [
    group.time, group.level, group.message, group.count,
    ...group.members.map(member => getLogIdentity(member.record)),
  ])), [view.visible])

  // 智能跟随的开关边界：开关翻转或进出历史时无条件回到跟随状态，不让暂停
  // 计数跨场景残留。
  useEffect(() => {
    dispatchFollow({ type: 'reset' })
  }, [followEligible])

  const handleContainerScroll = useCallback(() => {
    const node = containerRef.current
    if (!node) return
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    dispatchFollow({
      type: distanceToBottom <= FOLLOW_BOTTOM_GAP_PX ? 'reach-bottom' : 'leave-bottom',
    })
  }, [])

  // 只在开关打开的实时模式监听用户滚动；暂停期间保持监听以检测回到底部。
  useEffect(() => {
    if (!followEligible) return
    const node = containerRef.current
    if (!node) return
    node.addEventListener('scroll', handleContainerScroll)
    return () => node.removeEventListener('scroll', handleContainerScroll)
  }, [followEligible, handleContainerScroll])

  // 只比较当前选定事实的身份；相同快照、无关事件与折叠切换不产生未读。
  // 观察范围变化时清除上一个范围的跟随状态。
  const previousLogsRef = useRef(view.selected)
  const previousScopeRef = useRef(scopeKey)
  useEffect(() => {
    const previous = previousLogsRef.current
    previousLogsRef.current = view.selected
    if (previousScopeRef.current !== scopeKey) {
      previousScopeRef.current = scopeKey
      dispatchFollow({ type: 'reset' })
      return
    }
    dispatchFollow({ type: 'append', count: countAppendedRows(previous, view.selected) })
  }, [scopeKey, view.selected])

  // 重复折叠与展开也会改变高度；跟随依赖布局内容，未读仍只比较事实。
  // 智能暂停时保留用户位置。
  useEffect(() => {
    if (!followEligible || follow.paused) return
    const node = containerRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [followEligible, follow.paused, layoutFingerprint])

  const resumeFollow = useCallback(() => {
    const node = containerRef.current
    if (node) node.scrollTop = node.scrollHeight
    dispatchFollow({ type: 'reach-bottom' })
  }, [])

  const visibleLogs = view.visible
  const isFilteredEmpty = logs.length > 0 && visibleLogs.length === 0

  return (
    <Card className="log-card min-w-0 p-0!" smoothCorners>
      <CardHeader
        title={headingTitle}
        actions={
          <div className="log-console-heading-actions">
            <span className="log-count">{visibleLogs.length} 条</span>
            {viewingHistory && (
              <Button
                onClick={onBackToRealtime}
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
          <div className="surface-soft mb-3 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground">
            <FileText className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={selectedFile.name}>
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
          <div className="relative">
            <div
              id="log-console-panel"
              ref={containerRef}
              className="log-console"
              role="log"
              aria-label="日志内容"
              aria-live={liveRegionMuted ? 'off' : 'polite'}
              aria-relevant="additions text"
            >
              {error && (
                <div
                  className={`log-console-state is-error flex-wrap ${logs.length > 0 ? 'status-danger m-3 min-h-0! justify-start! p-3! text-left font-sans text-sm' : ''}`}
                  role="alert"
                >
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  <span>{error}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                  >
                    重新加载
                  </Button>
                </div>
              )}
              {!error && logs.length === 0 && (
                <div className="log-console-state">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                  <span>
                    {viewingHistory
                      ? '这个日志文件没有内容'
                      : paused
                        ? '日志读取已暂停，继续后重新读取'
                        : '暂无实时日志，等待任务执行'}
                  </span>
                </div>
              )}
              {!error && isFilteredEmpty && (
                <div className="log-console-state">
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <span>没有符合当前筛选条件的日志</span>
                </div>
              )}
              {visibleLogs.map((log, index) => (
                <div className="log-row" data-log-row key={log.members[0]!.record.id || `${getLogIdentity(log.members[0]!.record)}-${index}`}>
                  <div className="log-row-meta">
                    {log.time && <time>{log.time}</time>}
                    <span className={`log-level is-${log.level.toLowerCase()}`}>{log.level}</span>
                  </div>
                  <div className="log-message">
                    <span data-log-message>{log.message}</span>
                    {log.count > 1 && <span className="log-repeat">x{log.count}</span>}
                    <details className="log-raw">
                      <summary>{log.count > 1 ? `查看 ${log.count} 条原文与详情` : '原文与详情'}</summary>
                      {log.members.map((annotation, index) => {
                        const record = annotation.record
                        return (
                          <div key={record.id || `${getLogIdentity(record)}-${index}`} className="log-record-detail">
                            <p>
                              {log.count > 1 ? `第 ${index + 1} 条 · ` : ''}
                              {record.timestamp || record.time || '时间未知'} · 源级别 {record.level}
                              {record.source === 'history' ? ' · 历史文件' : ' · 实时采集'}
                            </p>
                            <p>Run：{record.runId || '未关联'}{record.operationId ? ` · Operation：${record.operationId}` : ''}</p>
                            {annotation.parseStatus === 'malformed' && <p>无法完整解析，已保留原文</p>}
                            <pre>{getLogSourceText(record)}</pre>
                            {record.envelope && <pre>{JSON.stringify(record.envelope, null, 2)}</pre>}
                          </div>
                        )
                      })}
                    </details>
                  </div>
                </div>
              ))}
            </div>
            {followEligible && follow.paused && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-lg"
                icon={<ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={resumeFollow}
              >
                {follow.pendingCount > 0 ? '有新日志' : '回到底部'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
