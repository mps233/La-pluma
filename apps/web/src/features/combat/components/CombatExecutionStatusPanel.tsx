import { LoaderCircle, SkipForward } from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { CombatTerminalResult } from '../hooks/useCombatExecution'

export type CombatExecutionWaiting =
  | { kind: 'set'; label: string }
  | { kind: 'queue'; label: string; canSkip: boolean }

export interface CombatExecutionStatusPanelProps {
  waiting: CombatExecutionWaiting | null
  showWaiting: boolean
  isAutoStopping: boolean
  terminalResult: CombatTerminalResult | null
  isRunning: boolean
  isContinuing: boolean
  isSkipping: boolean
  isStopping: boolean
  automationAvailable: boolean
  unavailableMessage: string
  onStartNext: () => void
  onContinueQueue: () => void
  onSkipQueueEntry: () => void
}

const TERMINAL_STATE_LABELS: Record<CombatTerminalResult['state'], string> = {
  succeeded: '执行成功',
  failed: '执行失败',
  stopped: '已终止',
  interrupted: '已中断',
}

const TERMINAL_TONES: Record<CombatTerminalResult['type'], string> = {
  success: 'status-success',
  warning: 'status-warning',
  error: 'status-danger',
}

export default function CombatExecutionStatusPanel({
  waiting,
  showWaiting,
  isAutoStopping,
  terminalResult,
  isRunning,
  isContinuing,
  isSkipping,
  isStopping,
  automationAvailable,
  unavailableMessage,
  onStartNext,
  onContinueQueue,
  onSkipQueueEntry,
}: CombatExecutionStatusPanelProps) {
  const waitingVisible = showWaiting && waiting !== null
  const terminalVisible = terminalResult !== null && !isRunning && waiting === null

  if (!waitingVisible && !terminalVisible) return null

  const unavailableTitle = automationAvailable ? undefined : unavailableMessage

  return (
    <>
      {waitingVisible && waiting && (
        <section className="combat-workspace-section" aria-label="等待继续">
          <div className="flex flex-wrap items-center justify-between gap-3.5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {waiting.kind === 'set' ? '等待继续下一关' : '等待继续下一项'}
              </h2>
              {waiting.label && (
                <p className="mt-1 line-clamp-2 wrap-break-word text-xs text-muted-foreground">
                  {waiting.label}
                </p>
              )}
            </div>

            {isAutoStopping ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
                正在停止…
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {waiting.kind === 'set' ? (
                  <Button
                    size="sm"
                    onClick={onStartNext}
                    disabled={!automationAvailable || isContinuing || isStopping}
                    aria-busy={isContinuing || undefined}
                    title={unavailableTitle}
                  >
                    {isContinuing
                      ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在开始</>
                      : '开始下一关'}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={onContinueQueue}
                      disabled={!automationAvailable || isContinuing || isStopping}
                      aria-busy={isContinuing || undefined}
                      title={unavailableTitle}
                    >
                      {isContinuing
                        ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在开始</>
                        : '开始下一项'}
                    </Button>
                    {waiting.canSkip && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onSkipQueueEntry}
                        disabled={!automationAvailable || isSkipping || isStopping}
                        aria-busy={isSkipping || undefined}
                        title={unavailableTitle}
                      >
                        {isSkipping
                          ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在跳过</>
                          : (
                            <>
                              <SkipForward size={14} aria-hidden="true" />
                              跳过此项
                            </>
                          )}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {terminalVisible && terminalResult && (
        <section
          role="status"
          aria-label="本次执行结果"
          className="combat-workspace-section"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs text-tertiary">本次执行结果</span>
            <Badge
              variant="ghost"
              className={cn('min-h-6 px-2.5 font-semibold', TERMINAL_TONES[terminalResult.type])}
            >
              {TERMINAL_STATE_LABELS[terminalResult.state]}
            </Badge>
          </div>
          <p className="mt-1.5 wrap-break-word text-sm leading-5 text-foreground">
            {terminalResult.message}
          </p>
        </section>
      )}
    </>
  )
}
