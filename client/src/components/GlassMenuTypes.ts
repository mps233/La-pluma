import type { ReactNode } from 'react'

export interface GlassMenuItem {
  label: ReactNode
  icon?: ReactNode
  checked?: boolean
  destructive?: boolean
  disabled?: boolean
  onSelect?: () => void
}

export interface GlassMenuProps {
  icon: ReactNode
  items: GlassMenuItem[]
  'aria-label': string
  align?: 'start' | 'center' | 'end'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  menuClassName?: string
  /** Override the trigger geometry (the tabbar More uses the floating height). */
  triggerClassName?: string
  /**
   * Keep the trigger's own tint instead of snapshotting the page behind it. A control
   * that sits over scrolling content pays for that snapshot on a timer.
   */
  plainTrigger?: boolean
}

export const MENU_TRIGGER_SIZES: Record<NonNullable<GlassMenuProps['size']>, string> = {
  sm: '!h-9 !w-9',
  md: '!h-11 !w-11',
  lg: '!h-[3.25rem] !w-[3.25rem]',
}

export const DEFAULT_MENU_TRIGGER_CLASS =
  '!h-[var(--la-pluma-tabbar-floating-height)] !w-[var(--la-pluma-tabbar-floating-height)] !px-0'
