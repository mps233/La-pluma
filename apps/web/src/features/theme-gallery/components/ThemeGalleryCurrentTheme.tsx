import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import type { ThemeMode } from '@/shared/theme/bootTheme'
import { DEFAULT_THEME_ID } from '@/shared/theme/registry'
import { useTheme } from '@/shared/theme/useTheme'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

const modeOptions: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const resolvedModeLabels = { light: '亮色', dark: '暗色' } as const

export function ThemeGalleryCurrentTheme() {
  const { activeTheme, mode, resolvedMode, setMode } = useTheme()

  return (
    <Card>
      <CardHeader className="border-b py-3.5">
        <CardTitle role="heading" aria-level={3}>当前主题</CardTitle>
      </CardHeader>
      <CardContent className="app-stack-card">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="text-sm font-medium text-foreground">{activeTheme.name}</span>
          <span className="text-xs text-tertiary">{activeTheme.description}</span>
        </div>

        <div className="flex flex-wrap gap-3.5">
          {activeTheme.swatches.map(swatch => (
            <div key={swatch.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2 surface-soft">
              <span
                className="h-6 w-6 shrink-0 rounded-lg border border-border"
                style={{ backgroundColor: swatch[resolvedMode] }}
                aria-hidden="true"
              />
              <span>
                <span className="block text-xs text-muted-foreground">{swatch.label}</span>
                <span className="block font-mono text-xs text-tertiary">{swatch[resolvedMode]}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="界面主题">
          {modeOptions.map(option => {
            const ModeIcon = option.icon
            const selected = mode === option.value
            return (
              <Button
                key={option.value}
                variant={selected ? 'default' : 'secondary'}
                size="sm"
                aria-pressed={selected}
                onClick={() => setMode(option.value)}
              >
                <ModeIcon size={15} aria-hidden="true" />
                {option.label}
              </Button>
            )
          })}
        </div>

        <p className="text-xs text-tertiary">
          生效{resolvedModeLabels[resolvedMode]}，html class {resolvedMode === 'dark' ? '含 dark' : '无 dark'}
          {activeTheme.id === DEFAULT_THEME_ID ? '，data-theme 未设置（shadcn 基线）' : `，data-theme=${activeTheme.id}`}
        </p>
      </CardContent>
    </Card>
  )
}
