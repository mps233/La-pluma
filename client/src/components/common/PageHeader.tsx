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
  gradientFrom: _gradientFrom = 'violet-400',
  gradientVia: _gradientVia = 'purple-400',
  gradientTo: _gradientTo = 'fuchsia-400',
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
      <div className="flex items-center space-x-4">
        {icon && (
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/70 text-cyan-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_0_0_1px_rgba(6,182,212,0.14),0_10px_26px_rgba(6,182,212,0.12)] dark:bg-white/[0.06] dark:text-cyan-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.08)]">
            {icon}
          </div>
        )}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-slate-600 dark:text-slate-400 text-sm hidden sm:block">
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
