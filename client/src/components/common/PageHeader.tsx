import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 页面标题组件 Props
 */
export interface PageHeaderProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  gradientFrom?: string
  gradientVia?: string
  gradientTo?: string
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
  gradientFrom = 'violet-400',
  gradientVia = 'purple-400',
  gradientTo = 'fuchsia-400',
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
      className="flex items-center justify-between"
      {...animationProps}
    >
      <div className="flex items-center space-x-3">
        {icon}
        <div>
          <h2 className={`text-2xl font-bold bg-gradient-to-r from-${gradientFrom} via-${gradientVia} to-${gradientTo} bg-clip-text text-transparent`}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-gray-600 dark:text-gray-500 text-sm hidden sm:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      
      {actions && (
        <div className="flex items-center space-x-4">
          {actions}
        </div>
      )}
    </Container>
  )
}
