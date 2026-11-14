import type { ReactNode } from 'react'
import SmoothSurface from './SmoothSurface'

interface CardProps {
  children: ReactNode
  className?: string
  smoothCorners?: boolean
}

interface CardHeaderProps {
  icon?: ReactNode
  title: string
  actions?: ReactNode
}

interface CardContentProps {
  children: ReactNode
  className?: string
}

function SmoothCardSurface({ children }: { children: ReactNode }) {
  return (
    <SmoothSurface className="app-card-smooth-surface">
      {children}
    </SmoothSurface>
  )
}

export function Card({
  children,
  className = '',
  smoothCorners = false,
}: CardProps) {
  const cardClassName = `app-card surface-panel ${className}`
  const cardContent = smoothCorners ? <SmoothCardSurface>{children}</SmoothCardSurface> : children

  return (
    <div
      className={cardClassName}
      data-smooth-corners={smoothCorners ? 'true' : undefined}
    >
      {cardContent}
    </div>
  )
}

export function CardHeader({ icon, title, actions }: CardHeaderProps) {
  return (
    <div className="app-card-header">
      <div className="flex items-center space-x-2">
        {icon}
        <h3 className="app-section-title text-foreground">{title}</h3>
      </div>
      {actions && <div>{actions}</div>}
    </div>
  )
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={`app-card-content ${className}`}>{children}</div>
}
