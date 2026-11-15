import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { OpenMenu } from '../types'

export type FilterMenuKey = Exclude<OpenMenu, null>

export interface FilterMenuOption {
  value: string
  label: string
}

interface OperatorFilterMenuProps {
  menuKey: FilterMenuKey
  label: string
  value: string
  options: readonly FilterMenuOption[]
  isActive: boolean
  open: boolean
  mobileAlign?: 'start' | 'end'
  menuWidth?: number
  onOpenChange: (open: boolean) => void
  onSelect: (value: string) => void
}

const PHONE_QUERY = '(max-width: 639px)'

function subscribePhone(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(PHONE_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function getPhoneSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

const filterButtonClass = (isActive: boolean) =>
  `flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-2 text-xs font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[0.97] sm:w-auto sm:gap-1.5 sm:px-3 ${
    isActive
      ? 'brand-action-subtle'
      : 'control-surface text-muted-foreground'
  }`

export default function OperatorFilterMenu({
  menuKey,
  label,
  value,
  options,
  isActive,
  open,
  mobileAlign = 'start',
  menuWidth = 128,
  onOpenChange,
  onSelect,
}: OperatorFilterMenuProps) {
  const isPhone = useSyncExternalStore(subscribePhone, getPhoneSnapshot, () => false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)

  useLayoutEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    const focusSelected = () => {
      const content = contentRef.current
      if (!content) return
      const selected = content.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      const first = content.querySelector<HTMLElement>('[role="menuitemradio"]')
      ;(selected ?? first)?.focus({ preventScroll: true })
    }
    const timeout = window.setTimeout(focusSelected, 0)
    return () => window.clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('[data-filter-menu]')) return
      queueMicrotask(() => {
        if (!openRef.current) return
        if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return
        onOpenChange(false)
      })
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => document.removeEventListener('focusin', handleFocusIn)
  }, [onOpenChange, open])

  return (
    <div className="w-[calc(33.333%-0.5rem)] sm:w-auto">
      <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false} orientation="vertical" loopFocus={false}>
        <DropdownMenuTrigger
          ref={triggerRef}
          data-filter-menu={menuKey}
          className={filterButtonClass(isActive)}
        >
          <span className="truncate">{label}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 flex-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={contentRef}
          align={isPhone && mobileAlign === 'end' ? 'end' : 'start'}
          sideOffset={6}
          aria-label={`${label}筛选`}
          className="max-h-[min(20rem,var(--available-height))] min-w-0 overflow-y-auto overscroll-contain"
          style={{ width: menuWidth, maxWidth: 'calc(100vw - 2rem)' }}
          onKeyDownCapture={(event) => {
            // Base UI 的 radio menu 在首尾不会稳定循环；保留筛选菜单原有的环绕行为。
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
            )
            if (items.length === 0) return
            const index = items.indexOf(document.activeElement as HTMLElement)
            if (event.key === 'ArrowDown' && index === items.length - 1) {
              event.preventDefault()
              event.stopPropagation()
              items[0]?.focus()
            } else if (event.key === 'ArrowUp' && index === 0) {
              event.preventDefault()
              event.stopPropagation()
              items[items.length - 1]?.focus()
            }
          }}
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={next => onSelect(String(next))}
          >
            {options.map(option => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                closeOnClick
                className="min-h-11"
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
