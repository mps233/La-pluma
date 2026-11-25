import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'

interface ConfigLoadCardProps {
  failed: boolean
  title: string
  loadingMessage: string
  failedMessage: string
  error?: string | null
  retryLabel?: string
  onRetry: () => void
}

export default function ConfigLoadCard({
  failed,
  title,
  loadingMessage,
  failedMessage,
  error,
  retryLabel = '重新加载',
  onRetry,
}: ConfigLoadCardProps) {
  return (
    <Card
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      aria-label={title}
      className="h-40 gap-0 overflow-hidden p-0!"
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
        {failed
          ? <AlertTriangle size={22} strokeWidth={1.9} className="text-destructive" aria-hidden="true" />
          : <LoaderCircle size={22} strokeWidth={1.9} className="animate-spin" aria-hidden="true" />}
        <div className="w-full min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {failed ? failedMessage : loadingMessage}
          </p>
          {failed && (
            <p className="line-clamp-2 wrap-break-word text-xs text-muted-foreground">
              {error ?? '请稍后重新加载'}
            </p>
          )}
        </div>
        {failed && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        )}
      </div>
    </Card>
  )
}
