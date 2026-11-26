import { InlineAlert } from '@/shared/components'

export interface TrainingLoadErrorProps {
  title: string
  description: string
  onRetry: () => void
}

export default function TrainingLoadError({
  title,
  description,
  onRetry,
}: TrainingLoadErrorProps) {
  return (
    <InlineAlert tone="error" title={title} onRetry={onRetry} retryLabel="重新加载">
      {description}
    </InlineAlert>
  )
}
