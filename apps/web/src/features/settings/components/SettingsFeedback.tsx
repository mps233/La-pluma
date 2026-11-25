import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertAction, AlertDescription } from '@/shared/ui/alert'

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
  className = '',
}: SettingsFeedbackProps) {
  if (tone === 'error') {
    return (
      <Alert variant="destructive" className={`text-xs ${className}`}>
        <AlertCircle aria-hidden="true" />
        <AlertDescription className="text-xs">{message}</AlertDescription>
        {action && <AlertAction>{action}</AlertAction>}
      </Alert>
    )
  }

  const toneClass = 'status-success'
  return (
    <div role="status" className={`rounded-lg px-3 py-2.5 text-xs leading-5 ${toneClass} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">{message}</p>
        {action}
      </div>
    </div>
  )
}
