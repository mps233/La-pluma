import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { OpenMenu } from '../types'

export type FilterMenuKey = Exclude<OpenMenu, null>

export interface FilterMenuOption {
  value: string
  label: string
}

interface FilterMenuProps {
  menuKey: FilterMenuKey
  label: string
  value: string
  options: readonly FilterMenuOption[]
  isActive: boolean
  isOpen: boolean
  mobileAlign?: 'start' | 'end'
  menuWidth?: number
  onOpenChange: (menu: OpenMenu) => void
  onSelect: (value: string) => void
}

interface FilterMenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

const filterButtonClass = (isActive: boolean) =>
  `flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-2 text-xs font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[0.97] sm:w-auto sm:gap-1.5 sm:px-3 ${
    isActive
      ? 'brand-action-subtle'
      : 'control-surface text-muted-foreground'
  }`

const menuSurfaceClass = 'data-statistics-menu-surface fixed z-2000 overflow-y-auto overscroll-contain rounded-xl py-1 surface-panel'

const menuOptionClass = (isActive: boolean) =>
  `min-h-11 w-full px-3 text-left text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
    isActive
      ? 'brand-chip font-medium'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`

export default function FilterMenu({
  menuKey,
  label,
  value,
  options,
  isActive,
  isOpen,
  mobileAlign = 'start',
  menuWidth = 128,
  onOpenChange,
  onSelect,
}: FilterMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<FilterMenuPosition | null>(null)
  const menuId = `data-filter-${menuKey}-${useId().replace(/:/g, '')}`

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = Math.min(16, viewportWidth / 2)
    const gap = 6
    const width = Math.min(menuWidth, Math.max(0, viewportWidth - margin * 2))
    const alignEnd = mobileAlign === 'end' && viewportWidth < 640
    const preferredLeft = alignEnd ? rect.right - width : rect.left
    const left = Math.min(
      Math.max(preferredLeft, margin),
      Math.max(margin, viewportWidth - margin - width),
    )
    const naturalHeight = Math.min(options.length * 44 + 8, 320)
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin)
    const spaceAbove = Math.max(0, rect.top - gap - margin)
    const placement = spaceBelow < Math.min(naturalHeight, 176) && spaceAbove > spaceBelow
      ? 'top'
      : 'bottom'
    const availableHeight = placement === 'top' ? spaceAbove : spaceBelow

    setMenuPosition({
      top: placement === 'top' ? rect.top - gap : rect.bottom + gap,
      left,
      width,
      maxHeight: Math.min(naturalHeight, availableHeight),
      placement,
    })
  }, [menuWidth, mobileAlign, options.length])

  const restoreTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }, [])

  const closeMenu = useCallback((restoreFocus = false) => {
    onOpenChange(null)
    if (restoreFocus) restoreTriggerFocus()
  }, [onOpenChange, restoreTriggerFocus])

  useEffect(() => {
    if (!isOpen) return

    const focusFrame = window.requestAnimationFrame(() => {
      const selectedOption = menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
      const firstOption = menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
      ;(selectedOption ?? firstOption)?.focus({ preventScroll: true })
    })

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [closeMenu, isOpen, updateMenuPosition])

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    )
    if (menuItems.length === 0) return

    event.preventDefault()
    const activeIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? menuItems.length - 1
        : event.key === 'ArrowUp'
          ? (activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1)
          : (activeIndex + 1) % menuItems.length
    menuItems[nextIndex]?.focus({ preventScroll: true })
  }

  return (
    <div
      ref={containerRef}
      className="filter-menu-container relative w-[calc(33.333%-0.5rem)] sm:w-auto"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            closeMenu()
          } else {
            updateMenuPosition()
            onOpenChange(menuKey)
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          updateMenuPosition()
          onOpenChange(menuKey)
        }}
        className={filterButtonClass(isActive)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-none transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {isOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${label}筛选`}
          data-placement={menuPosition.placement}
          className={menuSurfaceClass}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            transform: menuPosition.placement === 'top' ? 'translateY(-100%)' : undefined,
            transformOrigin: menuPosition.placement === 'top' ? 'bottom' : 'top',
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              onClick={() => {
                onSelect(option.value)
                closeMenu(true)
              }}
              className={menuOptionClass(value === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
