import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * 按钮组件 Props
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'gradient' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  loadingText?: ReactNode
  statusKey?: string | number
  fullWidth?: boolean
  icon?: ReactNode
  type?: 'button' | 'submit' | 'reset'
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

/**
 * 图标按钮组件 Props
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
  icon: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

/**
 * 按钮组件
 * 统一的按钮样式，支持多种变体和状态
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  loadingText = '加载中...',
  statusKey,
  fullWidth = false,
  onClick,
  className = '',
  icon,
  type = 'button',
  ...props
}: ButtonProps) {
  const shouldReduceMotion = useReducedMotion()
  const baseStyles = 'app-button'
  
  const variantStyles: Record<string, string> = {
    primary: 'brand-action disabled:!bg-slate-400 disabled:!shadow-none',
    secondary: 'control-surface text-primary',
    danger: 'status-danger-action disabled:!bg-slate-400 disabled:!shadow-none',
    success: 'status-success-action disabled:!bg-slate-400 disabled:!shadow-none',
    ghost: 'app-button-ghost text-secondary',
    gradient: 'brand-action disabled:!bg-slate-400 disabled:!shadow-none',
    outline: 'control-surface text-primary',
  }
  
  const sizeStyles: Record<string, string> = {
    sm: 'app-button-size-sm text-xs',
    md: 'app-button-size-md text-sm',
    lg: 'app-button-size-lg text-base',
  }

  const contentGapStyles: Record<string, string> = {
    sm: 'gap-1.5',
    md: 'gap-2',
    lg: 'gap-2',
  }
  
  const widthStyles = fullWidth ? 'w-full' : ''
  
  const isDisabled = disabled || loading
  const contentKey = statusKey ?? (loading ? 'loading' : 'ready')
  
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${isDisabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      whileHover={isDisabled ? {} : { y: -1 }}
      whileTap={isDisabled ? {} : { y: 0, scale: 0.98 }}
      {...props}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={contentKey}
          className={`inline-flex min-h-4 items-center justify-center ${contentGapStyles[size]}`}
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 7 }}
          transition={{ duration: shouldReduceMotion ? 0.08 : 0.15, ease: 'easeOut' }}
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {loadingText && <span>{loadingText}</span>}
            </>
          ) : (
            <>
              {icon}
              {children && <span>{children}</span>}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

/**
 * 图标按钮组件
 * 只显示图标的按钮
 */
export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  onClick,
  className = '',
  title,
  ...props
}: IconButtonProps) {
  const baseStyles = 'app-icon-button'
  
  const variantStyles: Record<string, string> = {
    primary: 'brand-action',
    secondary: 'control-surface text-primary',
    danger: 'status-danger-action',
    ghost: 'app-button-ghost text-secondary',
  }
  
  const sizeStyles: Record<string, string> = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base',
  }
  
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      whileHover={disabled ? {} : { scale: 1.05 }}
      whileTap={disabled ? {} : { scale: 0.95 }}
      {...props}
    >
      {icon}
    </motion.button>
  )
}
