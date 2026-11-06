import type { ReactNode } from 'react'
import CjkText from './CjkText'

/**
 * 页面标题组件 Props
 */
interface PageHeaderProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  mobileLayout?: 'stack' | 'inline'
}

/**
 * 页面标题组件
 * 统一的页面标题样式，包含图标、标题、副标题
 */
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
          <div className="app-page-header-icon [&_*]:text-current">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="app-page-title text-primary">
            <CjkText>{title}</CjkText>
          </h1>
          {subtitle && (
            <p className="app-page-subtitle text-secondary">
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
