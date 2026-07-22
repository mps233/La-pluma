import type { CSSProperties, ReactNode } from 'react'
import SmoothSurface from './SmoothSurface'

/**
 * 卡片容器组件 Props
 */
export interface CardProps {
  children: ReactNode
  className?: string
  animated?: boolean
  delay?: number
  smoothCorners?: boolean
}

/**
 * 卡片标题组件 Props
 */
export interface CardHeaderProps {
  icon?: ReactNode
  title: string
  actions?: ReactNode
}

/**
 * 卡片内容组件 Props
 */
export interface CardContentProps {
  children: ReactNode
  className?: string
}

/**
 * 信息卡片组件 Props
 */
export interface InfoCardProps {
  children: ReactNode
  type?: 'info' | 'warning' | 'error' | 'success'
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
 * 统一的卡片样式，支持动画和自定义样式
 */
export function Card({
  children,
  className = '',
  animated = false,
  delay = 0,
  smoothCorners = false,
}: CardProps) {
  const cardClassName = `app-card surface-panel ${className}`
  const cardContent = smoothCorners ? <SmoothCardSurface>{children}</SmoothCardSurface> : children
  const animationStyle = animated
    ? { '--app-card-animation-delay': `${delay}s` } as CSSProperties
    : undefined

  return (
    <div
      className={cardClassName}
      data-animated={animated ? 'true' : undefined}
      data-animation-delay={animated ? delay : undefined}
      data-smooth-corners={smoothCorners ? 'true' : undefined}
      style={animationStyle}
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
        <h3 className="app-section-title text-primary">{title}</h3>
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

/**
 * 信息卡片组件（带边框和背景色）
 */
export function InfoCard({ children, type = 'info', className = '' }: InfoCardProps) {
  const typeStyles: Record<string, string> = {
    info: 'status-info',
    warning: 'status-warning',
    error: 'status-danger',
    success: 'status-success',
  }

  return (
    <div className={`app-info-card ${typeStyles[type]} ${className}`}>
      {children}
    </div>
  )
}
