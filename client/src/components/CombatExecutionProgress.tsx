import { useEffect, useState } from 'react'
import { isActiveRunState, type AgentRun } from '../types/run'

function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface CombatExecutionProgressProps {
  run: AgentRun | null
  visible: boolean
}

/**
 * 本次执行进度：补足列表中看不到的队列位置、当前关卡和已用时。
 * 运行状态与逐项结果仍由执行卡片和作业列表负责，这里不复制。
 */
export default function CombatExecutionProgress({ run, visible }: CombatExecutionProgressProps) {
  const active = Boolean(run && isActiveRunState(run.state)) && visible
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return undefined
    const alignTimer = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.clearTimeout(alignTimer)
      window.clearInterval(timer)
    }
  }, [active])

  if (!active || !run) return null

  const progress = run.progress || {}
  const currentStep = typeof progress.currentStep === 'number' && progress.currentStep > 0
    ? Math.trunc(progress.currentStep)
    : null
  const totalSteps = typeof progress.totalSteps === 'number' && progress.totalSteps > 0
    ? Math.trunc(progress.totalSteps)
    : null
  const stage = typeof progress.currentStage === 'string' && progress.currentStage.trim()
    ? progress.currentStage.trim()
    : null
  const message = typeof progress.message === 'string' && progress.message.trim()
    ? progress.message.trim()
    : null
  if (currentStep === null && !stage && !message) return null

  const startedAt = parseTimestamp(run.startedAt)
  const elapsed = formatElapsed(startedAt === null ? null : Math.max(0, now - startedAt))
  const isStopping = run.state === 'stopping'

  return (
    <section
      className="mb-3 border-y border-[var(--app-border)] py-2.5"
      aria-label="本次执行进度"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-primary">本次执行进度</span>
          {currentStep !== null && (
            <span className="font-medium brand-text">
              {isStopping ? '正在停止' : '正在执行'} 第 {currentStep}
              {totalSteps !== null ? ` / ${totalSteps}` : ''} 项
            </span>
          )}
          {!currentStep && stage && <span className="text-secondary">正在执行 {stage}</span>}
          {stage && currentStep !== null && <span className="text-secondary">关卡 {stage}</span>}
        </div>
        {elapsed && <span className="text-xs text-tertiary">已用时 {elapsed}</span>}
      </div>
      {message && message !== `正在执行 ${stage || ''}`.trim() && (
        <p className="mt-1 truncate text-xs text-tertiary">{message}</p>
      )}
    </section>
  )
}
