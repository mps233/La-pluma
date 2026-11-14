import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { IconButton, SmoothPanel } from '@/shared/components'

export interface LogNoticeData {
  readonly type: 'success' | 'error'
  readonly text: string
}

interface LogNoticeProps extends LogNoticeData {
  readonly onDismiss: () => void
}

export default function LogNotice({ type, text, onDismiss }: LogNoticeProps) {
  return (
    <SmoothPanel
      cornerSize="compact"
      surfaceClassName={`log-notice ${type === 'error' ? 'is-error' : 'is-success'}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {type === 'error'
        ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
      <IconButton
        icon={<X className="h-4 w-4" aria-hidden="true" />}
        onClick={onDismiss}
        variant="ghost"
        size="sm"
        title="关闭提示"
        aria-label="关闭提示"
      />
    </SmoothPanel>
  )
}
