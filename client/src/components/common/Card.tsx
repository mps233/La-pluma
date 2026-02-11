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
    default: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    violet: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    emerald: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    purple: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    orange: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    cyan: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    amber: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
    teal: 'border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60',
  }

  // 主题色 hover 样式
  const hoverStyles: Record<string, string> = {
    default: 'hover:border-gray-300 dark:hover:border-white/20 hover:shadow-lg',
    violet: 'hover:border-violet-400 dark:hover:border-violet-500/30 hover:shadow-[0_4px_12px_rgba(139,92,246,0.15)]',
    emerald: 'hover:border-emerald-400 dark:hover:border-emerald-500/30 hover:shadow-[0_4px_12px_rgba(16,185,129,0.15)]',
    purple: 'hover:border-purple-400 dark:hover:border-purple-500/30 hover:shadow-[0_4px_12px_rgba(168,85,247,0.15)]',
    orange: 'hover:border-orange-400 dark:hover:border-orange-500/30 hover:shadow-[0_4px_12px_rgba(249,115,22,0.15)]',
    cyan: 'hover:border-cyan-400 dark:hover:border-cyan-500/30 hover:shadow-[0_4px_12px_rgba(6,182,212,0.15)]',
    amber: 'hover:border-amber-400 dark:hover:border-amber-500/30 hover:shadow-[0_4px_12px_rgba(245,158,11,0.15)]',
    teal: 'hover:border-teal-400 dark:hover:border-teal-500/30 hover:shadow-[0_4px_12px_rgba(20,184,166,0.15)]',
  }

  return (
    <Container 
      className={`rounded-3xl p-6 border ${themeStyles[theme]} ${hoverStyles[theme]} transition-all ${className}`}
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
    <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        {icon}
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
    <div className={`p-6 ${className}`}>
      {children}
    </div>
  )
}

/**
 * 信息卡片组件（带边框和背景色）
 */
export function InfoCard({ children, type = 'info', className = '' }: InfoCardProps) {
  const typeStyles: Record<string, string> = {
    info: 'border-blue-300 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/5',
    warning: 'border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5',
    error: 'border-rose-300 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/5',
    success: 'border-emerald-300 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5',
  }

  return (
    <div className={`rounded-3xl p-5 border ${typeStyles[type]} ${className}`}>
      {children}
    </div>
  )
}
