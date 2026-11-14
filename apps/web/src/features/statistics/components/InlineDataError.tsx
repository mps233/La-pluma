import { Button } from '@/shared/components'
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
        loading={isRetrying}
        loadingText="正在重试..."
        onClick={onRetry}
        className="w-full sm:w-auto"
        icon={<Icons.RefreshCw className="h-4 w-4" />}
      >
        重新加载
      </Button>
    </div>
  )
}
