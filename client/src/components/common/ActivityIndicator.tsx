export interface ActivityIndicatorProps {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const indicatorSizes = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 28,
} as const

const indicatorLines = Array.from({ length: 8 }, (_, index) => index)

export default function ActivityIndicator({
  size = 'sm',
  className = '',
}: ActivityIndicatorProps) {
  const sizeInPixels = indicatorSizes[size]

  return (
    <span
      className={`app-activity-indicator app-activity-indicator-fallback ${className}`}
      style={{ width: sizeInPixels, height: sizeInPixels }}
      aria-hidden="true"
    >
      {indicatorLines.map(index => <span key={index} />)}
    </span>
  )
}
