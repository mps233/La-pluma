import { Card as FrameworkCard, CardContent as FrameworkCardContent, CardHeader as FrameworkCardHeader } from 'framework7-react'
import type { CSSProperties, ComponentType, ReactNode } from 'react'
import { useFramework7Runtime } from '../../framework7Context'

const F7Card = FrameworkCard as unknown as ComponentType<Record<string, unknown>>
const F7CardHeader = FrameworkCardHeader as unknown as ComponentType<Record<string, unknown>>
const F7CardContent = FrameworkCardContent as unknown as ComponentType<Record<string, unknown>>

/**
 * 卡片容器组件 Props
 */
export interface CardProps {
  children: ReactNode
  className?: string
  animated?: boolean
  delay?: number
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

/**
 * 卡片容器组件
 * 统一的卡片样式，支持动画和自定义样式
 */
export function Card({
  children,
  className = '',
  animated = false,
  delay = 0,
}: CardProps) {
  const framework7Runtime = useFramework7Runtime()
  const cardClassName = `app-card surface-panel ${className}`
  const animationStyle = animated
    ? { '--app-card-animation-delay': `${delay}s` } as CSSProperties
    : undefined
  if (!framework7Runtime) {
    return (
      <div
        className={cardClassName}
        data-animated={animated ? 'true' : undefined}
        data-animation-delay={animated ? delay : undefined}
        style={animationStyle}
      >
        {children}
      </div>
    )
  }

  return (
    <F7Card
      className={cardClassName}
      padding={false}
      data-animated={animated ? 'true' : undefined}
      data-animation-delay={animated ? delay : undefined}
      style={animationStyle}
    >
      {children}
    </F7Card>
  )
}

/**
 * 卡片标题组件
 */
export function CardHeader({ icon, title, actions }: CardHeaderProps) {
  const framework7Runtime = useFramework7Runtime()
  if (!framework7Runtime) {
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

  return (
    <F7CardHeader className="app-card-header">
      <div className="flex items-center space-x-2">
        {icon}
        <h3 className="app-section-title text-primary">
          {title}
        </h3>
      </div>
      {actions && <div>{actions}</div>}
    </F7CardHeader>
  )
}

/**
 * 卡片内容组件
 */
export function CardContent({ children, className = '' }: CardContentProps) {
  const framework7Runtime = useFramework7Runtime()
  if (!framework7Runtime) return <div className={`app-card-content ${className}`}>{children}</div>

  return (
    <F7CardContent padding={false} className={`app-card-content ${className}`}>
      {children}
    </F7CardContent>
  )
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
