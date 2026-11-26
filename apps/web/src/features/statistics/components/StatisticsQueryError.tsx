import { InlineAlert } from '@/shared/components'

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
    <InlineAlert
      tone="error"
      title={title}
      onRetry={onRetry}
      retryLabel="重新加载"
      retrying={isRetrying}
    >
      <span className="wrap-break-word wrap-anywhere">{description}</span>
    </InlineAlert>
  )
}
