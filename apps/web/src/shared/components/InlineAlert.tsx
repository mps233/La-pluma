import type { ComponentProps, ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'

export type InlineAlertTone = 'error' | 'warning' | 'info' | 'success'

export interface InlineAlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  readonly tone?: InlineAlertTone
  readonly title?: ReactNode
  readonly action?: ReactNode
  readonly onRetry?: () => void
  readonly retryLabel?: string
  readonly retrying?: boolean
  readonly showIcon?: boolean
}

const TONE_CLASS: Record<InlineAlertTone, string> = {
  error: 'border-destructive/25 bg-destructive/10 text-destructive-text',
  warning: 'border-warning/25 bg-warning/10 text-warning-text',
  info: 'border-info/25 bg-info/10 text-info',
  success: 'border-success/25 bg-success/10 text-success-text',
}

const TONE_ICON: Record<InlineAlertTone, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

export default function InlineAlert({
  tone = 'error',
  title,
  action,
  onRetry,
  retryLabel = '重试',
  retrying = false,
  showIcon = true,
  className,
  children,
  ...props
}: InlineAlertProps) {
  const ToneIcon = TONE_ICON[tone]
  const retryAction = onRetry
    ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={onRetry}
        >
          {retrying
            ? <><LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" />重试中</>
            : <><RefreshCw data-icon="inline-start" aria-hidden="true" />{retryLabel}</>}
        </Button>
      )
    : null

  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      className={cn('px-3 py-2 leading-5', TONE_CLASS[tone], className)}
      {...props}
    >
      {showIcon && <ToneIcon aria-hidden="true" />}
      {title !== undefined && <AlertTitle>{title}</AlertTitle>}
      {children !== undefined && (
        <AlertDescription className="text-current opacity-90">{children}</AlertDescription>
      )}
      {(action ?? retryAction) && <AlertAction>{action ?? retryAction}</AlertAction>}
    </Alert>
  )
}
