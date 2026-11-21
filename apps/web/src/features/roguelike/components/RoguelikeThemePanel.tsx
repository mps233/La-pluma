import { Check } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { ROGUELIKE_THEME_PRESETS } from '../model/roguelikeTasks'
import type { RoguelikeTask } from '../types'

interface RoguelikeThemePanelProps {
  task: RoguelikeTask
  theme: string
  disabled?: boolean
  error?: string
  onThemeChange: (value: string) => void
}

export default function RoguelikeThemePanel({
  task,
  theme,
  disabled,
  error,
  onThemeChange,
}: RoguelikeThemePanelProps) {
  const presets = ROGUELIKE_THEME_PRESETS[task.id]
  const inputId = `roguelike-${task.id}-theme`
  const errorId = `${inputId}-error`
  const handleThemeChange = (value: string) => {
    if (disabled) return
    onThemeChange(value)
  }

  return (
    <Card className="roguelike-panel gap-0 p-0!">
      <div className="roguelike-panel-heading">
        <h2>主题</h2>
        <Badge variant="ghost" className="surface-soft text-tertiary pointer-events-none">
          {presets.length} 个可用
        </Badge>
      </div>
      <div className="roguelike-panel-body">
        <div className="roguelike-theme-grid" role="group" aria-label="主题预设">
          {presets.map(preset => {
            const selected = theme === preset.value
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleThemeChange(preset.value)}
                disabled={disabled}
                aria-pressed={selected}
                className="roguelike-theme-option min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="roguelike-theme-copy">
                  <strong>{preset.label}</strong>
                  <small>{preset.value}</small>
                </span>
                {selected && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        <div className="roguelike-custom-theme">
          <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-muted-foreground">
            自定义主题代号
          </label>
          <Input
            id={inputId}
            name={`maa-${task.id}-theme`}
            type="text"
            autoComplete="off"
            placeholder={task.placeholder}
            value={theme}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-errormessage={error ? errorId : undefined}
            onChange={event => handleThemeChange(event.target.value)}
          />
          {error && <p id={errorId} className="mt-2 text-xs form-error-text">{error}</p>}
        </div>
      </div>
    </Card>
  )
}
