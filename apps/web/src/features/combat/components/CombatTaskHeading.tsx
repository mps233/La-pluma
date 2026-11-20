import type { ReactNode } from 'react'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import type { CombatTask } from '../types'

const RUN_ACTION_BUTTON_CLASS = 'combat-task-run-button min-h-11 px-4 text-sm sm:px-5'

function UnavailableAction({
  action,
  reason,
  children,
}: {
  action: string
  reason: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" aria-label={`${action}：${reason}`} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{reason}</TooltipContent>
    </Tooltip>
  )
}

export interface CombatRunActionProps {
  automationAvailable: boolean
  unavailableMessage: string
  isRunning: boolean
  isStopping: boolean
  isSubmitting: boolean
  isWaitingForNext?: boolean
  isContinuing?: boolean
  onExecute: () => void
  onStop: () => void
  onStartNext?: () => void
}

export function CombatRunAction({
  automationAvailable,
  unavailableMessage,
  isRunning,
  isStopping,
  isSubmitting,
  isWaitingForNext = false,
  isContinuing = false,
  onExecute,
  onStop,
  onStartNext,
}: CombatRunActionProps) {
  const unavailableReason = !automationAvailable ? unavailableMessage : ''
  const withUnavailableHint = (action: string, node: ReactNode) => (
    unavailableReason
      ? <UnavailableAction action={action} reason={unavailableReason}>{node}</UnavailableAction>
      : node
  )

  if (isWaitingForNext) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {withUnavailableHint('开始下一关', (
          <Button
            onClick={onStartNext}
            disabled={!automationAvailable || isContinuing || isStopping}
            aria-busy={isContinuing || undefined}
            className={`${RUN_ACTION_BUTTON_CLASS} w-full`}
          >
            {isContinuing
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在开始</>
              : (
                <>
                  <ChevronRight size={16} aria-hidden="true" />
                  开始下一关
                </>
              )}
          </Button>
        ))}
        <Button
          onClick={onStop}
          disabled={isStopping}
          aria-busy={isStopping || undefined}
          variant="secondary"
          className={RUN_ACTION_BUTTON_CLASS}
        >
          {isStopping
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
            : '终止执行'}
        </Button>
      </div>
    )
  }

  return isRunning ? (
    <Button
      onClick={onStop}
      disabled={isStopping}
      aria-busy={isStopping || undefined}
      variant="destructive"
      className={RUN_ACTION_BUTTON_CLASS}
    >
      {isStopping
        ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
        : '终止执行'}
    </Button>
  ) : (
    withUnavailableHint('立即执行', (
      <Button
        onClick={onExecute}
        disabled={!automationAvailable || isSubmitting}
        aria-busy={isSubmitting || undefined}
        className={RUN_ACTION_BUTTON_CLASS}
      >
        {isSubmitting
          ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在启动</>
          : '立即执行'}
      </Button>
    ))
  )
}

interface CombatTaskHeadingProps extends CombatRunActionProps {
  task: CombatTask
  executeHint?: string
}

export default function CombatTaskHeading({
  task,
  executeHint,
  ...run
}: CombatTaskHeadingProps) {
  return (
    <div className="combat-task-heading flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-foreground">{task.name}</h2>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 md:items-end">
        <CombatRunAction {...run} />
        {executeHint && (
          <p className="max-w-full text-xs leading-4 text-muted-foreground md:text-right">{executeHint}</p>
        )}
      </div>
    </div>
  )
}
