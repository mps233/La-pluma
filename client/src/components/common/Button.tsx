import type { ButtonHTMLAttributes, ReactNode } from 'react'
import ActivityIndicator from './ActivityIndicator'

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
  tabIndex,
  ...props
}: ButtonProps) {
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
  const content = loading ? (
    <>
      <ActivityIndicator size={size === 'sm' ? 'xs' : 'sm'} />
      {loadingText && <span>{loadingText}</span>}
    </>
  ) : (
    <>
      <span className="button-icon-slot">{icon}</span>
      {children && <span>{children}</span>}
    </>
  )

  const disabledStyles = disabled && !loading ? 'cursor-not-allowed opacity-50' : ''
  const loadingStyles = loading ? 'is-loading cursor-progress' : ''

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      tabIndex={isDisabled ? -1 : tabIndex}
      aria-disabled={isDisabled || undefined}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${disabledStyles} ${loadingStyles} ${className}`}
      aria-busy={loading || undefined}
      data-status-key={statusKey ?? undefined}
      {...props}
    >
      <span className={`inline-flex min-h-4 items-center justify-center ${contentGapStyles[size]}`}>
        {content}
      </span>
    </button>
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
    sm: 'app-icon-button-size-sm text-xs',
    md: 'app-icon-button-size-md text-sm',
    lg: 'app-icon-button-size-lg text-base',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={props['aria-label'] ?? title}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      {...props}
    >
      {icon}
    </button>
  )
}
