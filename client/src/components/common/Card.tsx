import type { ReactNode } from 'react'
import CjkText from './CjkText'
import SmoothSurface from './SmoothSurface'

/**
 * 卡片容器组件 Props
 */
interface CardProps {
  children: ReactNode
  className?: string
  smoothCorners?: boolean
}

/**
 * 卡片标题组件 Props
 */
interface CardHeaderProps {
  icon?: ReactNode
  title: string
  actions?: ReactNode
}

/**
 * 卡片内容组件 Props
 */
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

/**
 * 卡片容器组件
 * 统一的卡片样式，支持连续圆角和自定义样式
 */
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

/**
 * 卡片标题组件
 */
export function CardHeader({ icon, title, actions }: CardHeaderProps) {
  return (
    <div className="app-card-header">
      <div className="flex items-center space-x-2">
        {icon}
        <h3 className="app-section-title text-primary"><CjkText>{title}</CjkText></h3>
      </div>
      {actions && <div>{actions}</div>}
    </div>
  )
}

/**
 * 卡片内容组件
 */
export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={`app-card-content ${className}`}>{children}</div>
}
