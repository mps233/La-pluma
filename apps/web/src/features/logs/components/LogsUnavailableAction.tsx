import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

interface LogsUnavailableActionProps {
  readonly action: string
  readonly reason: string
  readonly children: ReactNode
  readonly className?: string
}

export default function LogsUnavailableAction({
  action,
  reason,
  children,
  className = 'inline-flex',
}: LogsUnavailableActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className={className} aria-label={`${action}：${reason}`} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{reason}</TooltipContent>
    </Tooltip>
  )
}
