import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { GlassButton } from '@zakisheriff/liquid-glass'
import ActivityIndicator from './ActivityIndicator'
import Tooltip from './Tooltip'

/**
 * 按钮组件 Props
 */
interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
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
interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
  icon: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  tooltip?: ReactNode
  tooltipSide?: 'top' | 'bottom'
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

type ButtonVariant = NonNullable<ButtonProps['variant']>

const glassVariants: Record<ButtonVariant, {
  variant: 'filled' | 'glass' | 'clear'
  tint?: string
  destructive?: boolean
}> = {
  primary: { variant: 'filled', tint: 'var(--app-accent-action)' },
  secondary: { variant: 'glass' },
  danger: { variant: 'filled', tint: 'var(--app-danger-action)', destructive: true },
  success: { variant: 'filled', tint: 'var(--app-success-action)' },
  ghost: { variant: 'clear', tint: 'var(--app-text-muted)' },
  outline: { variant: 'glass' },
}

/**
 * 按钮组件
 * 统一的 Liquid Glass 按钮，支持多种变体和状态。
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
  const isDisabled = disabled || loading
  const glassVariant = glassVariants[variant]
  const content = loading ? loadingText : children
  const leadingIcon = loading
    ? <ActivityIndicator size={size === 'sm' ? 'xs' : 'sm'} />
    : icon

  return (
    <GlassButton
      {...props}
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      tabIndex={isDisabled ? -1 : tabIndex}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      data-status-key={statusKey ?? undefined}
      icon={leadingIcon}
      variant={glassVariant.variant}
      tint={glassVariant.tint}
      destructive={glassVariant.destructive}
      size={size}
      className={`app-glass-button app-glass-button-${size} ${fullWidth ? 'w-full' : ''} ${loading ? 'is-loading' : ''} ${className}`.trim()}
    >
      {content}
    </GlassButton>
  )
}

/**
 * 图标按钮组件
 * 只显示图标的 Liquid Glass 按钮。
 */
export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  onClick,
  className = '',
  title,
  tooltip,
  tooltipSide,
  ...props
}: IconButtonProps) {
  const glassVariant = glassVariants[variant]

  const button = (
    <GlassButton
      {...props}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip ? undefined : title}
      aria-label={props['aria-label'] ?? title}
      icon={icon}
      variant={glassVariant.variant}
      tint={glassVariant.tint}
      destructive={glassVariant.destructive}
      size={size}
      className={`app-glass-icon-button app-glass-icon-button-${size} ${className}`.trim()}
    />
  )

  return tooltip
    ? <Tooltip content={tooltip} side={tooltipSide}>{button}</Tooltip>
    : button
}
