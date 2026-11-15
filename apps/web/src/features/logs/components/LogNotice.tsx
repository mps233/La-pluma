import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'

export interface LogNoticeData {
  readonly type: 'success' | 'error'
  readonly text: string
}

interface LogNoticeProps extends LogNoticeData {
  readonly onDismiss: () => void
}

export default function LogNotice({ type, text, onDismiss }: LogNoticeProps) {
  return (
    <Card
      className={`log-notice flex flex-row items-center gap-2.5 px-3.5 py-2.5 ${
        type === 'error'
          ? 'bg-destructive/10 text-destructive ring-destructive/20'
          : 'bg-success/10 text-success ring-success/20'
      }`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {type === 'error'
        ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onDismiss}
        title="关闭提示"
        aria-label="关闭提示"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Card>
  )
}
