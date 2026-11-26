import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleMinus } from 'lucide-react'
import { InlineAlert } from '@/shared/components'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { formatExecutionActionSummary, isUnconfirmedGameAction } from '@/shared/lib/executionSummary'
import {
  executionSummaryHasFailure,
  type AutomationExecutionSummary as AutomationExecutionSummaryData,
} from '../model/automationRun'
import { filterExecutionActionsForDisplay, hasExecutionDetailContent } from '../model/executionActionDisplay'
import { describeDeferredMastery, describeGameTaskDetail } from '../model/gameTaskResultText'

interface AutomationExecutionSummaryProps {
  summary: AutomationExecutionSummaryData | null
  runId: string | null
}

interface RetainedSummary {
  fingerprint: string
  summary: AutomationExecutionSummaryData
  detailsOpen: boolean
}

export default function AutomationExecutionSummary({
  summary,
  runId,
}: AutomationExecutionSummaryProps) {
  const shouldReduceMotion = useReducedMotion()
  const [view, setView] = useState<RetainedSummary | null>(null)
  const fingerprint = summary ? `${runId ?? 'schedule'}:${JSON.stringify(summary)}` : ''

  // 渲染期按新摘要调整展示状态：保留上一份摘要、决定是否自动展开详情。
  // 相同内容不会重复调整，因此用户手动收起后不会被同一 run 的重复投影覆盖。
  if (summary && fingerprint !== view?.fingerprint) {
    setView({
      fingerprint,
      summary,
      detailsOpen: executionSummaryHasFailure(summary),
    })
  }

  const lastSummary = view?.summary ?? null
  const detailsOpen = view?.detailsOpen ?? false
  if (!lastSummary) return null

  const visibleActions = filterExecutionActionsForDisplay(lastSummary.actions)
  const hasDetailContent = hasExecutionDetailContent(lastSummary, visibleActions)

  const toggleDetails = () => {
    setView(current => current ? { ...current, detailsOpen: !current.detailsOpen } : current)
  }

  return (
    <section className="border-t border-border px-3.5 py-3 sm:px-4" aria-label="最近执行结果">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">最近执行</h4>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {`用时 ${Math.max(1, Math.round(lastSummary.durationMs / 1000))} 秒`}
        </span>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
          {formatExecutionActionSummary(lastSummary.actions)
            || (lastSummary.failedCount > 0
              ? `${lastSummary.failedCount} 项任务执行失败`
              : lastSummary.skippedCount > 0
                ? `${lastSummary.skippedCount} 项任务已跳过`
                : '任务流程执行完成')}
        </span>
        {hasDetailContent && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={toggleDetails}
            aria-expanded={detailsOpen}
            aria-label={detailsOpen ? '收起执行详情' : '展开执行详情'}
            title={detailsOpen ? '收起详情' : '展开详情'}
            className="size-11 shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <ChevronDown
              strokeWidth={2}
              className={`${shouldReduceMotion ? '' : 'transition-transform duration-200'} ${detailsOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>

      {detailsOpen && hasDetailContent && (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          {lastSummary.summaries.some(summary => summary.stage || summary.drops) && (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              {lastSummary.summaries
                .filter(summary => summary.stage || summary.drops)
                .map((summary, summaryIndex) => (
                  <div key={`${summary.task}-${summary.stage || summaryIndex}`} className="min-w-0 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-700 dark:text-gray-200">
                      <span className="font-semibold">{summary.stage || summary.task}</span>
                      {summary.times && <span className="text-gray-400">{summary.times} 次</span>}
                      {summary.duration && <span className="text-gray-400">{summary.duration}</span>}
                    </div>
                    {summary.drops && (
                      <p className="mt-1 wrap-break-word leading-5 text-gray-500 dark:text-gray-400">{summary.drops}</p>
                    )}
                  </div>
                ))}
            </div>
          )}

          {lastSummary.reports.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-border pt-2">
              {lastSummary.reports.map((report, reportIndex) => (
                <div
                  key={`${report.provider}-${report.stage || reportIndex}-${reportIndex}`}
                  className={`flex min-w-0 items-start gap-2 text-xs ${report.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
                >
                  {report.status === 'success'
                    ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                    : <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />}
                  <span className="min-w-0 wrap-break-word">
                    {report.message}{report.stage ? ` · ${report.stage}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {visibleActions.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-border pt-2">
              {visibleActions.map((action, actionIndex) => {
                const unconfirmed = isUnconfirmedGameAction(action)
                return (
                  <div key={`${action.action}-${action.task}-${actionIndex}`} className="min-w-0">
                    <div
                      className={`flex min-w-0 items-start gap-2 text-xs ${unconfirmed ? 'text-gray-500 dark:text-gray-400' : action.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : action.status === 'skipped' ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {unconfirmed
                        ? <CircleMinus size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                        : action.status === 'success'
                        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                        : action.status === 'skipped'
                          ? <CircleMinus size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                          : <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />}
                      <span className="min-w-0 wrap-break-word">{action.message}</span>
                    </div>
                    {action.action === 'operprogress' && action.details && action.details.length > 0 && (
                      <div className="mt-1 space-y-1 pl-5">
                        {action.details.map((detail, detailIndex) => (
                          <div
                            key={`${detail.name}-${detailIndex}`}
                            className={`flex min-w-0 items-start gap-2 text-xs ${unconfirmed || detail.result === 'Skipped' ? 'text-gray-500 dark:text-gray-400' : detail.result === 'Success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                          >
                            {unconfirmed || detail.result === 'Skipped'
                              ? <CircleMinus size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                              : detail.result === 'Success'
                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                                : <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />}
                            <span className="min-w-0 wrap-break-word">{describeGameTaskDetail(detail)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {action.action === 'operprogress' && action.deferredMastery && action.deferredMastery.length > 0 && (
                      <div className="mt-1 space-y-1 pl-5">
                        <Badge variant="secondary" className="bg-warning/10 text-warning-text">待处理</Badge>
                        {action.deferredMastery.map((entry, deferredIndex) => (
                          <div
                            key={`${entry.name}-${deferredIndex}`}
                            className="flex min-w-0 items-start gap-2 text-xs text-amber-600 dark:text-amber-400"
                          >
                            <CircleMinus size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                            <span className="min-w-0 wrap-break-word">{describeDeferredMastery(entry)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {lastSummary.errors
            ?.filter(error => {
              const taskName = typeof error === 'string' ? error : error.task
              return !lastSummary.actions?.some(action => action.status === 'failed' && action.task === taskName)
            })
            .map((error, errorIndex) => (
              <InlineAlert key={`${typeof error === 'string' ? error : error.task}-${errorIndex}`} tone="error" className="mt-2">
                {typeof error === 'string' ? error : `${error.task}：${error.error}`}
              </InlineAlert>
            ))}

          {lastSummary.warnings.map((warning, warningIndex) => (
            <InlineAlert key={`${warning}-${warningIndex}`} tone="warning" className="mt-2">
              {warning}
            </InlineAlert>
          ))}
        </motion.div>
      )}
    </section>
  )
}
