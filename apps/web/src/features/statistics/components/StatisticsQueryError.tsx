import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'

interface StatisticsQueryErrorProps {
  title: string
  description: string
  isRetrying: boolean
  onRetry: () => void
}

export default function StatisticsQueryError({
  title,
  description,
  isRetrying,
  onRetry,
}: StatisticsQueryErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="wrap-break-word wrap-anywhere">{description}</AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRetrying}
          aria-busy={isRetrying || undefined}
          onClick={onRetry}
        >
          {isRetrying
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在重试...</>
            : (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                重新加载
              </>
            )}
        </Button>
      </AlertAction>
    </Alert>
  )
}
