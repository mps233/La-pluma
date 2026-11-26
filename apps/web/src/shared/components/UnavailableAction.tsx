import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

export interface UnavailableActionProps {
  readonly action: string
  readonly reason: string
  readonly children: ReactNode
  readonly className?: string
}

export default function UnavailableAction({
  action,
  reason,
  children,
  className,
}: UnavailableActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            tabIndex={0}
            className={cn('inline-flex', className)}
            aria-label={`${action}：${reason}`}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{reason}</TooltipContent>
    </Tooltip>
  )
}
