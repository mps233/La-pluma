import { useCallback, useEffect, useMemo, useReducer, useRef, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ArrowDown, ArrowLeft, FileText, Filter, History, Search } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Disclosure, FieldHint, Loading } from '@/shared/components'
import { HISTORY_LOG_LINES } from '../model/historyLogSession'
import { countAppendedRows, initialLogFollowState, reduceLogFollow } from '../model/logFollow'
import { formatLogFileSize } from '../model/logFileSize'
import { getLogIdentity, getLogSourceText, type LogView, type VisibleLog } from '../model/logModel'
import { REALTIME_LOG_LINES } from '../model/realtimeLogStream'
import type { LogEntry, LogFile } from '../types'

/** 距底部小于该值视为仍在底部，吸收取整与吸附误差。 */
const FOLLOW_BOTTOM_GAP_PX = 4

const LEVEL_BADGE_CLASS: Record<LogEntry['level'], string> = {
  ERROR: 'bg-destructive/10 text-destructive-text',
  WARN: 'bg-warning/10 text-warning-text',
  INFO: 'bg-primary-soft text-primary-strong',
  DEBUG: 'bg-muted text-muted-foreground',
}

const VIRTUAL_ROWS_THRESHOLD = 120

function LogRow({ log }: { log: VisibleLog }) {
  return (
    <div className="log-row" data-log-row>
      <div className="log-row-meta">
        {log.time && <time>{log.time}</time>}
        <Badge variant="secondary" className={LEVEL_BADGE_CLASS[log.level]}>{log.level}</Badge>
      </div>
      <div className="log-message">
        <span data-log-message>{log.message}</span>
        {log.count > 1 && (
          <Badge variant="secondary" className="ml-2 bg-primary-soft px-1.5 text-primary-strong">
            {`x${log.count}`}
          </Badge>
        )}
        <Disclosure
          className="log-raw rounded-none border-0 p-0"
          label={log.count > 1 ? `查看 ${log.count} 条原文` : '原文'}
          summaryClassName="w-fit min-h-6 text-xs font-semibold text-muted-foreground hover:text-primary-strong max-sm:min-h-11"
          contentClassName="mt-0 gap-0 border-t-0 pt-0"
        >
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
        </Disclosure>
      </div>
    </div>
  )
}

function VirtualLogRows({
  logs,
  scrollRef,
}: {
  readonly logs: readonly VisibleLog[]
  readonly scrollRef: RefObject<HTMLDivElement | null>
}) {
  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: index => {
      const record = logs[index]?.members[0]?.record
      return record ? getLogIdentity(record) : index
    },
  })

  return (
    <div
      data-log-virtualized="true"
      style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
    >
      {virtualizer.getVirtualItems().map(item => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start}px)`,
          }}
        >
          <LogRow log={logs[item.index]!} />
        </div>
      ))}
    </div>
  )
}

interface LogConsoleProps {
  readonly viewingHistory: boolean
  readonly selectedFile: LogFile | null
  readonly loading: boolean
  readonly error: string | null
  readonly logs: readonly LogEntry[]
  readonly unfilteredLogCount: number
  readonly view: LogView
  readonly autoScroll: boolean
  readonly paused: boolean
  readonly onRetry: () => void
  readonly onBackToRealtime: () => void
  readonly onClearFilters: () => void
  readonly onShowAllRuns: () => void
  readonly onOpenHistory: () => void
  readonly scopeKey?: string
}

export default function LogConsole({
  viewingHistory,
  selectedFile,
  loading,
  error,
  logs,
  unfilteredLogCount,
  view,
  autoScroll,
  paused,
  onRetry,
  onBackToRealtime,
  onClearFilters,
  onShowAllRuns,
  onOpenHistory,
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
  const totalFacts = view.selected.length
  const countLabel = loading
    ? '读取中'
    : visibleLogs.length === totalFacts
      ? `${totalFacts} 条`
      : `${totalFacts} 条 · ${visibleLogs.length} 行`
  const runFilteredEmpty = !viewingHistory && unfilteredLogCount > 0 && logs.length === 0
  const filteredEmpty = logs.length > 0 && visibleLogs.length === 0
  const coverageHint = viewingHistory
    ? `历史文件只读取尾部 ${HISTORY_LOG_LINES} 行；导出仅包含当前筛选结果。`
    : `实时日志只显示最近 ${REALTIME_LOG_LINES} 条窗口，不代表完整执行日志；Run 筛选仅作用于当前窗口。`

  return (
    <Card className="log-card min-w-0 gap-0 p-0!">
      <CardHeader className="border-b py-3.5">
        <CardTitle role="heading" aria-level={2}>{headingTitle}</CardTitle>
        <CardAction>
          <div className="log-console-heading-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenHistory}
              aria-label="历史日志文件"
              title="历史日志文件"
            >
              <History className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">历史日志</span>
            </Button>
            <FieldHint id="log-console-coverage" label="日志覆盖范围" hint={coverageHint} />
            <Badge variant="secondary" className="bg-primary-soft font-semibold tabular-nums text-primary-strong">
              {countLabel}
            </Badge>
            {viewingHistory && (
              <Button
                onClick={onBackToRealtime}
                variant="outline"
                size="sm"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                返回实时
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="log-console-content">
        {viewingHistory && selectedFile && (
          <div className="surface-soft mb-3 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground">
            <FileText className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={selectedFile.name}>
              {selectedFile.name}
            </span>
            <span className="hidden shrink-0 text-tertiary sm:inline">
              {formatLogFileSize(selectedFile.size)}
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
              {error && logs.length === 0 && (
                <div className="log-console-state is-error flex-wrap" role="alert">
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
              {!error && logs.length === 0 && !runFilteredEmpty && (
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
              {!error && runFilteredEmpty && (
                <div className="log-console-state flex-wrap">
                  <Filter className="h-5 w-5" aria-hidden="true" />
                  <span>当前执行范围内没有日志</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onShowAllRuns}
                  >
                    显示全部执行
                  </Button>
                </div>
              )}
              {!error && filteredEmpty && (
                <div className="log-console-state flex-wrap">
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <span>没有符合当前筛选条件的日志</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClearFilters}
                  >
                    清除筛选
                  </Button>
                </div>
              )}
              {visibleLogs.length > VIRTUAL_ROWS_THRESHOLD ? (
                <VirtualLogRows logs={visibleLogs} scrollRef={containerRef} />
              ) : visibleLogs.map((log, index) => (
                <LogRow
                  key={log.members[0]!.record.id || `${getLogIdentity(log.members[0]!.record)}-${index}`}
                  log={log}
                />
              ))}
            </div>
            {followEligible && follow.paused && (
              <Button
                type="button"
                size="sm"
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-lg"
                onClick={resumeFollow}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                {follow.pendingCount > 0 ? '有新日志' : '回到底部'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
