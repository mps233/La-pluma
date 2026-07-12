import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 卡片容器组件 Props
 */
export interface CardProps {
  children: ReactNode
  className?: string
  animated?: boolean
  delay?: number
  hover?: boolean
  theme?: 'default' | 'violet' | 'emerald' | 'purple' | 'orange' | 'cyan' | 'amber'
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
  animated = true,
  delay = 0,
  hover = false,
  theme = 'default',
}: CardProps) {
  const Container = animated ? motion.div : 'div'
  const animationProps = animated ? {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { delay },
  } : {}

  const hoverProps = hover ? {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.98 },
  } : {}

  // 主题色样式
  const themeStyles: Record<string, string> = {
    default: 'surface-panel',
    violet: 'surface-panel',
    emerald: 'surface-panel',
    purple: 'surface-panel',
    orange: 'surface-panel',
    cyan: 'surface-panel',
    amber: 'surface-panel',
    teal: 'surface-panel',
  }

  // 主题色 hover 样式
  const hoverStyles: Record<string, string> = {
    default: 'surface-panel-hover',
    violet: 'surface-panel-hover',
    emerald: 'surface-panel-hover',
    purple: 'surface-panel-hover',
    orange: 'surface-panel-hover',
    cyan: 'surface-panel-hover',
    amber: 'surface-panel-hover',
    teal: 'surface-panel-hover',
  }

  return (
    <Container 
      className={`app-card ${themeStyles[theme]} ${hoverStyles[theme]} transition-all ${className}`}
      {...animationProps}
      {...hoverProps}
    >
      {children}
    </Container>
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
        <h3 className="app-section-title text-primary">
          {title}
        </h3>
      </div>
      {actions && <div>{actions}</div>}
    </div>
  )
}

/**
 * 卡片内容组件
 */
export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={`app-card-content ${className}`}>
      {children}
    </div>
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
