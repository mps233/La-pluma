import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { useTheme } from '@/shared/theme/useTheme'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

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
  const { mode: theme, setMode: setTheme } = useTheme()

  const currentTheme = themeOptions.find(option => option.value === theme) ?? systemThemeOption
  const CurrentThemeIcon = currentTheme.icon

  return (
    <>
      <ToggleGroup
        aria-label="界面主题"
        value={[theme]}
        onValueChange={(next) => {
          const nextTheme = next[0] as ThemeMode | undefined
          if (nextTheme && nextTheme !== theme) setTheme(nextTheme)
        }}
        multiple={false}
        data-theme={theme}
        className="la-pluma-theme-desktop max-lg:hidden gap-1! rounded-full!"
      >
        {themeOptions.map(option => {
          const ThemeIcon = option.icon
          const selected = theme === option.value
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              title={option.label}
              aria-label={option.label}
              className={cn(
                'theme-toggle-btn p-0! hover:bg-card/38! aria-pressed:bg-transparent! aria-pressed:hover:bg-transparent! aria-pressed:hover:text-primary-foreground! [&_svg]:size-[1.125rem]!',
                selected && 'is-active',
              )}
            >
              <ThemeIcon strokeWidth={1.8} aria-hidden="true" />
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>

      <div className="la-pluma-theme-mobile relative flex-none">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            className="la-pluma-theme-trigger group text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary data-popup-open:bg-muted"
            title={`主题：${currentTheme.label}`}
            aria-label={`切换界面主题，当前${currentTheme.label}`}
          >
            <CurrentThemeIcon className="size-5" strokeWidth={1.8} aria-hidden="true" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={8}
            aria-label="选择界面主题"
            className="w-40! p-1.5!"
          >
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(next) => {
                const nextTheme = next as ThemeMode | undefined
                if (nextTheme) setTheme(nextTheme)
              }}
            >
              {themeOptions.map(option => {
                const ThemeIcon = option.icon
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    closeOnClick
                    className="min-h-11 gap-2.5! pl-3! pr-8 aria-checked:bg-primary-soft! aria-checked:text-primary-strong!"
                  >
                    <ThemeIcon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                    <span className="flex-1 text-left">{option.label}</span>
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
