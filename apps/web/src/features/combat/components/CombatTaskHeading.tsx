import { ChevronRight, Play, Square } from 'lucide-react'
import { Button } from '@/shared/components'
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
          loading={isContinuing}
          loadingText="正在开始"
          title={!automationAvailable ? unavailableMessage : undefined}
          variant="primary"
          size="md"
          icon={<ChevronRight size={16} aria-hidden="true" />}
          className={buttonClassName}
        >
          开始下一关
        </Button>
        <Button
          onClick={onStop}
          disabled={isStopping}
          loading={isStopping}
          loadingText="正在终止"
          variant="secondary"
          size="md"
          className={buttonClassName}
        >
          终止执行
        </Button>
      </div>
    )
  }

  return isRunning ? (
    <Button
      onClick={onStop}
      disabled={isStopping}
      loading={isStopping}
      loadingText="正在终止"
      variant="danger"
      size="md"
      icon={!isStopping ? <Square size={14} fill="currentColor" aria-hidden="true" /> : undefined}
      className={buttonClassName}
    >
      终止执行
    </Button>
  ) : (
    <Button
      onClick={onExecute}
      disabled={!automationAvailable}
      loading={isSubmitting}
      loadingText="正在启动"
      title={!automationAvailable ? unavailableMessage : undefined}
      variant="primary"
      size="md"
      icon={<Play size={15} fill="currentColor" aria-hidden="true" />}
      className={buttonClassName}
    >
      立即执行
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
