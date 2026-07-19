import { motion, useReducedMotion } from 'framer-motion'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * 按钮组件 Props
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline'
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
    primary: 'brand-action',
    secondary: 'control-surface text-primary',
    danger: 'status-danger-action',
    success: 'status-success-action',
    ghost: 'app-button-ghost text-secondary',
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
      aria-busy={loading || undefined}
      whileHover={isDisabled || shouldReduceMotion ? {} : { y: -1 }}
      whileTap={isDisabled || shouldReduceMotion ? {} : { y: 0, scale: 0.98 }}
      {...props}
    >
      <motion.span
        key={contentKey}
        className={`inline-flex min-h-4 items-center justify-center ${contentGapStyles[size]}`}
        initial={shouldReduceMotion ? false : { opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.14, ease: 'easeOut' }}
      >
        {loading ? (
          <>
            <svg className="app-spinner h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
  const shouldReduceMotion = useReducedMotion()
  const baseStyles = 'app-icon-button'
  
  const variantStyles: Record<string, string> = {
    primary: 'brand-action',
    secondary: 'control-surface text-primary',
    danger: 'status-danger-action',
    ghost: 'app-button-ghost text-secondary',
  }
  
  const sizeStyles: Record<string, string> = {
    sm: 'app-icon-button-size-sm text-xs',
    md: 'app-icon-button-size-md text-sm',
    lg: 'app-icon-button-size-lg text-base',
  }
  
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={props['aria-label'] ?? title}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      whileHover={disabled || shouldReduceMotion ? {} : { scale: 1.04 }}
      whileTap={disabled || shouldReduceMotion ? {} : { scale: 0.96 }}
      {...props}
    >
      {icon}
    </motion.button>
  )
}
