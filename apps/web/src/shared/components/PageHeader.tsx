import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  mobileLayout?: 'stack' | 'inline'
}

export default function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  mobileLayout = 'stack',
}: PageHeaderProps) {
  return (
    <div
      className={`app-page-header ${mobileLayout === 'inline' ? 'is-mobile-inline' : ''}`}
    >
      <div className="app-page-heading">
        {icon && (
          <div className="app-page-header-icon **:text-current">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="app-page-title text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="app-page-subtitle text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      
      {actions && (
        <div className="app-page-actions">
          {actions}
        </div>
      )}
    </div>
  )
}
