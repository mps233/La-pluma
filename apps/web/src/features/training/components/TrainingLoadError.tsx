import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'

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
    <Alert variant="destructive" className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-xl border-0 px-6 py-8 text-center">
      <AlertCircle size={22} strokeWidth={1.9} aria-hidden="true" />
      <AlertTitle className="text-base font-semibold">{title}</AlertTitle>
      <AlertDescription className="max-w-md">{description}</AlertDescription>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重新加载
      </Button>
    </Alert>
  )
}
