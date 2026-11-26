import type { ReactNode } from 'react'
import { cn } from 'cn'
import { InlineAlert } from '@/shared/components'

export type SettingsFeedbackTone = 'success' | 'error'

export interface SettingsFeedbackProps {
  readonly tone: SettingsFeedbackTone
  readonly message: string
  readonly action?: ReactNode
  readonly className?: string
}

export default function SettingsFeedback({
  tone,
  message,
  action,
  className,
}: SettingsFeedbackProps) {
  return (
    <InlineAlert
      tone={tone}
      role={tone === 'success' ? 'status' : 'alert'}
      action={action}
      className={cn('text-xs [&_[data-slot=alert-description]]:text-xs', className)}
    >
      {message}
    </InlineAlert>
  )
}
