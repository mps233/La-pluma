import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { GlassButtonGroup, GlassButtonGroupItem } from '@/components/liquid-glass'
import { GlassMenu } from './LayoutGlassChrome'
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

  const currentTheme = themeOptions.find(option => option.value === theme) ?? systemThemeOption
  const CurrentThemeIcon = currentTheme.icon

  return (
    <>
      <GlassButtonGroup
        className="la-pluma-theme-desktop bg-[var(--app-surface-muted)] text-[var(--app-text)]"
        data-pill
        aria-label="界面主题"
        data-theme={theme}
        material="tinted"
        size="md"
      >
        {themeOptions.map(option => {
          const ThemeIcon = option.icon
          const selected = theme === option.value
          return (
            <GlassButtonGroupItem
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={`theme-toggle-btn motion-safe:active:scale-[0.94] transition-transform ${selected ? 'is-active' : ''}`}
              title={option.label}
              aria-label={option.label}
              aria-pressed={selected}
            >
              <ThemeIcon strokeWidth={1.8} aria-hidden="true" />
            </GlassButtonGroupItem>
          )
        })}
      </GlassButtonGroup>

      <GlassMenu
        icon={<CurrentThemeIcon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}
        items={themeOptions.map(option => {
          const ThemeIcon = option.icon
          return {
            label: option.label,
            icon: <ThemeIcon className="!h-[1rem] !w-[1rem] shrink-0" strokeWidth={1.8} aria-hidden="true" />,
            checked: theme === option.value,
            onSelect: () => setTheme(option.value),
          }
        })}
        aria-label={`切换界面主题，当前${currentTheme.label}`}
        align="end"
        size="md"
        plainTrigger
        className="la-pluma-theme-mobile flex-none"
        triggerClassName="la-pluma-theme-trigger !px-0"
      />
    </>
  )
}
