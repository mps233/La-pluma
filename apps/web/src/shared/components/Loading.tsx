import { LoaderCircle } from 'lucide-react'

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

const spinnerSizes = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-7',
} as const

export default function Loading({
  size = 'md',
  text,
}: LoadingProps) {
  return (
    <div
      className="app-loading flex flex-col items-center justify-center space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle className={`animate-spin text-primary-strong ${spinnerSizes[size]}`} aria-hidden="true" />

      {text && (
        <p className="text-sm text-muted-foreground">
          {text}
        </p>
      )}
      {!text && <span className="sr-only">加载中</span>}
    </div>
  )
}
