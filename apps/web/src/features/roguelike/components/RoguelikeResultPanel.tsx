import { useState } from 'react'
import { FileText } from 'lucide-react'
import { EmptyState, SmoothPanel } from '@/shared/components'
import { isActiveRunState, isTerminalRunState, type AgentRun } from '@/features/task-execution'
import { RuntimeDiagnosticsPanel } from '@/features/runtime-status'
import {
  describeRoguelikeRunSummary,
  readRoguelikeRunSummary,
  type RoguelikeRunSummary,
} from '../model/runSummary'

interface RoguelikeResultPanelProps {
  run: AgentRun | null
  command?: string
}

interface RetainedResult {
  runId: string
  summary: RoguelikeRunSummary | null
  durationMs: number | null
}

type ResultBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const BADGE_SURFACE: Record<ResultBadgeTone, string> = {
  success: 'status-success',
  warning: 'status-warning',
  danger: 'status-danger',
  info: 'status-info',
  neutral: 'surface-soft text-muted-foreground',
}

function formatRunDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

function SummaryContent({
  summary,
  durationMs,
}: {
  summary: RoguelikeRunSummary
  durationMs: number | null
}) {
  const description = describeRoguelikeRunSummary(summary)
  const duration = formatRunDuration(durationMs)
  const metrics = duration
    ? [...description.metrics, { label: '耗时', value: duration }]
    : description.metrics

  return (
    <div className="roguelike-result-content">
      <p className="roguelike-result-message">{summary.message}</p>
      {metrics.length > 0 && (
        <dl className="roguelike-result-metrics">
          {metrics.map((metric, index) => (
            <div key={`${metric.label}-${index}`} className="roguelike-result-metric">
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {description.events.length > 0 && (
        <div className="roguelike-result-list">
          <h4>事件</h4>
          <ul>
            {description.events.map((event, index) => (
              <li key={`${event}-${index}`}>{event}</li>
            ))}
          </ul>
        </div>
      )}
      {description.notes.length > 0 && (
        <div className="roguelike-result-list">
          <h4>备注</h4>
          <ul>
            {description.notes.map((note, index) => (
              <li key={`${note}-${index}`}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function RoguelikeResultPanel({ run, command }: RoguelikeResultPanelProps) {
  const [retained, setRetained] = useState<RetainedResult | null>(null)
  const active = Boolean(run && isActiveRunState(run.state))
  const terminalRun = run && isTerminalRunState(run.state) ? run : null
  const currentSummary = terminalRun ? readRoguelikeRunSummary(terminalRun) : null
  const currentDuration = terminalRun && typeof terminalRun.durationMs === 'number'
    ? terminalRun.durationMs
    : null

  if (terminalRun && retained?.runId !== terminalRun.runId) {
    setRetained({ runId: terminalRun.runId, summary: currentSummary, durationMs: currentDuration })
  }

  const description = currentSummary ? describeRoguelikeRunSummary(currentSummary) : null
  const previous = active && retained && retained.runId !== run?.runId ? retained : null
  const progressMessage = typeof run?.progress?.message === 'string' && run.progress.message.trim()
    ? run.progress.message.trim()
    : null

  const badge: { label: string; tone: ResultBadgeTone } = !run
    ? { label: '未执行', tone: 'neutral' }
    : active
      ? { label: '执行中', tone: 'info' }
      : description
        ? { label: description.statusLabel, tone: description.tone }
        : { label: '无结果', tone: 'neutral' }

  return (
    <SmoothPanel
      className="roguelike-panel roguelike-result-panel"
      role="region"
      aria-label="执行结果"
    >
      <div className="roguelike-panel-heading">
        <div>
          <h3>执行结果</h3>
          <p>{active ? '本次执行进行中' : run ? '最近一次执行' : '执行后查看结算'}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-bold ${BADGE_SURFACE[badge.tone]}`}>
            {badge.label}
          </span>
        </div>
      </div>

      <div className="roguelike-panel-body roguelike-result-body">
        {!run && (
          <EmptyState
            className="roguelike-result-empty"
            compact
            icon={<FileText size={20} strokeWidth={1.8} />}
            title="还没有执行记录"
            description="执行一次集成战略或生息演算任务后，这里会展示结算与关键结果。"
          />
        )}

        {active && (
          <div className="roguelike-result-active" role="status">
            <strong>执行中</strong>
            <p>{progressMessage ?? '任务已提交，正在等待执行进度。'}</p>
          </div>
        )}

        {previous && (
          previous.summary ? (
            <section className="roguelike-result-previous" aria-label="上次执行结果">
              <h4>上次执行结果</h4>
              <SummaryContent summary={previous.summary} durationMs={previous.durationMs} />
            </section>
          ) : (
            <p className="roguelike-result-previous-note">上一次执行没有可用的结构化结果。</p>
          )
        )}

        {terminalRun && currentSummary && (
          <SummaryContent summary={currentSummary} durationMs={currentDuration} />
        )}
        {terminalRun && !currentSummary && (
          <p className="roguelike-result-missing">本次执行没有可用的结构化结果</p>
        )}

        <RuntimeDiagnosticsPanel command={command} className="roguelike-result-diagnostics" />
      </div>
    </SmoothPanel>
  )
}
