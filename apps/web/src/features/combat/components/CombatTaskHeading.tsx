import { ChevronRight, LoaderCircle, Play, Square } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { CombatTask } from '../types'

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
  /** 迁移前两份卡片的按钮间距不同；保持原类名即可保持基线。 */
  buttonClassName: string
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
  buttonClassName,
}: CombatRunActionProps) {
  if (isWaitingForNext) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={onStartNext}
          disabled={!automationAvailable || isContinuing || isStopping}
          aria-busy={isContinuing || undefined}
          title={!automationAvailable ? unavailableMessage : undefined}
          className={buttonClassName}
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
        <Button
          onClick={onStop}
          disabled={isStopping}
          aria-busy={isStopping || undefined}
          variant="secondary"
          className={buttonClassName}
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
      className={buttonClassName}
    >
      {isStopping
        ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
        : (
          <>
            <Square size={14} fill="currentColor" aria-hidden="true" />
            终止执行
          </>
        )}
    </Button>
  ) : (
    <Button
      onClick={onExecute}
      disabled={!automationAvailable || isSubmitting}
      aria-busy={isSubmitting || undefined}
      title={!automationAvailable ? unavailableMessage : undefined}
      className={buttonClassName}
    >
      {isSubmitting
        ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在启动</>
        : (
          <>
            <Play size={15} fill="currentColor" aria-hidden="true" />
            立即执行
          </>
        )}
    </Button>
  )
}

interface CombatTaskHeadingProps extends CombatRunActionProps {
  task: CombatTask
}

export default function CombatTaskHeading({
  task,
  ...run
}: CombatTaskHeadingProps) {
  return (
    <div className="combat-task-heading flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="combat-task-icon">
          {task.icon}
        </div>
        <div className="min-w-0">
          <h4 className="truncate text-lg font-semibold text-foreground">{task.name}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{task.description}</p>
        </div>
      </div>

      <CombatRunAction {...run} />
    </div>
  )
}
