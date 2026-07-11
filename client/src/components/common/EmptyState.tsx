import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`app-empty-state${compact ? ' is-compact' : ''} ${className}`}>
      {icon && <div className="app-empty-state-icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action && <div className="app-empty-state-action">{action}</div>}
    </div>
  )
}
