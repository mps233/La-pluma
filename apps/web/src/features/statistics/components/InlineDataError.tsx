import { LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import Icons from '@/shared/components/Icons'

interface InlineDataErrorProps {
  title: string
  description: string
  isRetrying: boolean
  onRetry: () => void
}

export default function InlineDataError({
  title,
  description,
  isRetrying,
  onRetry,
}: InlineDataErrorProps) {
  return (
    <div
      className="form-error-surface flex flex-col items-start gap-3.5 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 wrap-break-word text-sm leading-6 wrap-anywhere form-error-text">{description}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={isRetrying}
        aria-busy={isRetrying || undefined}
        onClick={onRetry}
        className="w-full sm:w-auto"
      >
        {isRetrying
          ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在重试...</>
          : (
            <>
              <Icons.RefreshCw className="h-4 w-4" aria-hidden="true" />
              重新加载
            </>
          )}
      </Button>
    </div>
  )
}
