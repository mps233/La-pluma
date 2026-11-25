import type { ComponentProps, ReactNode } from 'react'

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
  ...props
}: EmptyStateProps) {
  return (
    <div className={`app-empty-state${compact ? ' is-compact' : ''} ${className}`} {...props}>
      {icon && <div className="app-empty-state-icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action && <div className="app-empty-state-action">{action}</div>}
    </div>
  )
}
