import { motion } from 'framer-motion'
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
  fullWidth = false,
  onClick,
  className = '',
  icon,
  type = 'button',
  ...props
}: ButtonProps) {
  const baseStyles = 'app-button'
  
  const variantStyles: Record<string, string> = {
    primary: 'brand-action disabled:!bg-slate-400 disabled:!shadow-none',
    secondary: 'control-surface text-primary',
    danger: 'status-danger-action disabled:!bg-slate-400 disabled:!shadow-none',
    success: 'status-success-action disabled:!bg-slate-400 disabled:!shadow-none',
    ghost: 'text-secondary hover:bg-white/65 hover:text-primary dark:hover:bg-white/10',
    gradient: 'brand-action disabled:!bg-slate-400 disabled:!shadow-none',
    outline: 'control-surface text-primary',
  }
  
  const sizeStyles: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs space-x-1.5',
    md: 'px-4 py-2 text-sm space-x-2',
    lg: 'px-6 py-3 text-base space-x-2',
  }
  
  const widthStyles = fullWidth ? 'w-full' : ''
  
  const isDisabled = disabled || loading
  
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
      {loading ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>加载中...</span>
        </>
      ) : (
        <>
          {icon}
          {children && <span>{children}</span>}
        </>
      )}
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
    ghost: 'text-secondary hover:bg-white/65 hover:text-primary dark:hover:bg-white/10',
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
