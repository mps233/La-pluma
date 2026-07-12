import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 页面标题组件 Props
 */
export interface PageHeaderProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  animated?: boolean
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
  animated = true,
}: PageHeaderProps) {
  const Container = animated ? motion.div : 'div'
  const animationProps = animated ? {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
  } : {}

  return (
    <Container 
      className="app-page-header"
      {...animationProps}
    >
      <div className="app-page-heading">
        {icon && (
          <div className="app-page-header-icon icon-well [&_*]:text-current">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="app-page-title text-primary">
            {title}
          </h2>
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
    </Container>
  )
}
