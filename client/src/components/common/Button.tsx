import { Button as FrameworkButton } from 'framework7-react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { useFramework7Runtime } from '../../framework7Context'

const F7Button = FrameworkButton as unknown as ComponentType<Record<string, unknown>>

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
  const framework7Runtime = useFramework7Runtime()
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

  const content = loading
    ? loadingText
    : <><span className="button-icon-slot">{icon}</span>{children && <span>{children}</span>}</>

  if (!framework7Runtime) {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={isDisabled}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${isDisabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
        aria-busy={loading || undefined}
        data-status-key={statusKey ?? undefined}
        {...props}
      >
        <span className={`inline-flex min-h-4 items-center justify-center ${contentGapStyles[size]}`}>
          {loading ? (
            <>
              <span
                className={`${size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} app-spinner shrink-0 rounded-full border-2 border-current border-r-transparent`}
                aria-hidden="true"
              />
              {loadingText && <span>{loadingText}</span>}
            </>
          ) : content}
        </span>
      </button>
    )
  }

  return (
    <F7Button
      type={type}
      href={false}
      onClick={onClick}
      disabled={isDisabled}
      preloader={loading}
      loading={loading}
      fill={variant === 'primary' || variant === 'danger' || variant === 'success'}
      tonal={variant === 'secondary' || variant === 'outline'}
      outline={variant === 'outline'}
      large={size === 'lg'}
      small={size === 'sm'}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${isDisabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      aria-busy={loading || undefined}
      data-status-key={statusKey ?? undefined}
      {...props}
    >
      <span className={`inline-flex min-h-4 items-center justify-center ${contentGapStyles[size]}`}>
        {content}
      </span>
    </F7Button>
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
  const framework7Runtime = useFramework7Runtime()
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

  if (!framework7Runtime) {
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

  return (
    <F7Button
      type="button"
      href={false}
      onClick={onClick}
      disabled={disabled}
      round
      title={title}
      aria-label={props['aria-label'] ?? title}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      {...props}
    >
      {icon}
    </F7Button>
  )
}
