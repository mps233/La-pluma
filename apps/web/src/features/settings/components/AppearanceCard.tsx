import { Check } from 'lucide-react'
import { THEMES } from '@/shared/theme/registry'
import { useTheme } from '@/shared/theme/useTheme'
import { Card, CardContent } from '@/shared/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

export default function AppearanceCard() {
  const { themeId, resolvedMode, setThemeId } = useTheme()

  return (
    <Card>
      <CardContent>
        <ToggleGroup
          aria-label="界面主题"
          value={[themeId]}
          onValueChange={(next) => {
            const nextThemeId = next[0]
            if (nextThemeId) setThemeId(nextThemeId)
          }}
          orientation="vertical"
          spacing={2}
          className="w-full"
        >
          {THEMES.map(theme => {
            const selected = theme.id === themeId
            return (
              <ToggleGroupItem
                key={theme.id}
                value={theme.id}
                className="h-auto min-h-12 w-full cursor-pointer justify-start rounded-lg border border-border bg-transparent p-3 text-left hover:bg-muted/60 aria-pressed:border-primary! aria-pressed:bg-primary-soft! aria-pressed:text-foreground!"
              >
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex shrink-0 items-center gap-1 pt-1" aria-hidden="true">
                    {theme.swatches.map(swatch => (
                      <span
                        key={swatch.label}
                        className="size-2.5 rounded-full border border-border"
                        style={{ backgroundColor: swatch[resolvedMode] }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{theme.name}</span>
                  </span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}
