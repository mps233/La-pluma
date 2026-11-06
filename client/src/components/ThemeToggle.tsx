import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useUIStore } from '@/stores'

type ThemeMode = 'light' | 'dark' | 'system'

const systemThemeOption: { value: ThemeMode; label: string; icon: LucideIcon } = {
  value: 'system',
  label: '跟随系统',
  icon: Monitor,
}

const themeOptions: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  { value: 'light', label: '亮色模式', icon: Sun },
  { value: 'dark', label: '暗色模式', icon: Moon },
  systemThemeOption,
]

export default function ThemeToggle() {
  // 使用 UI Store 管理主题
  const theme = useUIStore(state => state.theme)
  const setTheme = useUIStore(state => state.setTheme)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mobileMenuId = `theme-menu-${useId().replace(/:/g, '')}`

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setMobileMenuOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileTriggerRef.current?.focus({ preventScroll: true }))
    }
  }, [])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const focusFrame = window.requestAnimationFrame(() => {
      mobileMenuRef.current
        ?.querySelector<HTMLElement>('[aria-checked="true"]')
        ?.focus({ preventScroll: true })
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)
        && !mobileTriggerRef.current?.contains(event.target as Node)) {
        closeMobileMenu()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        mobileMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
      )
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))

      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileMenu(true)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        const nextTarget = event.shiftKey
          ? mobileTriggerRef.current
          : mobileTriggerRef.current
            ?.closest('.la-pluma-navbar-actions')
            ?.querySelector<HTMLElement>('.la-pluma-github-link') ?? mobileTriggerRef.current
        setMobileMenuOpen(false)
        window.requestAnimationFrame(() => nextTarget?.focus({ preventScroll: true }))
        return
      }

      if (items.length === 0) return

      let nextIndex: number | null = null
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % items.length
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + items.length) % items.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = items.length - 1
      }

      const nextItem = nextIndex === null ? undefined : items[nextIndex]
      if (nextItem) {
        event.preventDefault()
        nextItem.focus({ preventScroll: true })
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMobileMenu, mobileMenuOpen])

  const handleThemeChange = (newTheme: ThemeMode, fromMobileMenu = false) => {
    setTheme(newTheme)
    if (fromMobileMenu) closeMobileMenu(true)
  }

  const currentTheme = themeOptions.find(option => option.value === theme) ?? systemThemeOption
  const CurrentThemeIcon = currentTheme.icon

  return (
    <>
      <div
        className="la-pluma-theme-desktop glass"
        data-pill
        role="group"
        aria-label="界面主题"
        data-theme={theme}
      >
        {themeOptions.map(option => {
          const ThemeIcon = option.icon
          const selected = theme === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleThemeChange(option.value)}
              className={`theme-toggle-btn motion-safe:active:scale-[0.94] transition-transform ${selected ? 'is-active' : ''}`}
              title={option.label}
              aria-label={option.label}
              aria-pressed={selected}
            >
              <ThemeIcon strokeWidth={1.8} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="la-pluma-theme-mobile relative flex-none">
        <button
          ref={mobileTriggerRef}
          type="button"
          onClick={() => setMobileMenuOpen(open => !open)}
          className={`la-pluma-theme-trigger group text-secondary transition-colors motion-safe:active:scale-[0.96] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] glass ${mobileMenuOpen ? 'text-primary' : ''}`}
          data-pill
          title={`主题：${currentTheme.label}`}
          aria-label={`切换界面主题，当前${currentTheme.label}`}
          aria-haspopup="menu"
          aria-expanded={mobileMenuOpen}
          aria-controls={mobileMenuId}
        >
          <CurrentThemeIcon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </button>

        {mobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            id={mobileMenuId}
            role="menu"
            aria-label="选择界面主题"
            className="theme-menu-popover surface-panel absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-40 origin-top-right rounded-xl p-1.5"
          >
            {themeOptions.map(option => {
              const ThemeIcon = option.icon
              const selected = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => handleThemeChange(option.value, true)}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${
                    selected ? 'brand-action-subtle' : 'text-secondary hover:bg-[var(--app-surface-muted)] hover:text-primary'
                  }`}
                >
                  <ThemeIcon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  <span className="flex-1 text-left">{option.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-[var(--app-accent)]" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
