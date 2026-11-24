import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

export default function UnavailableAction({
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
