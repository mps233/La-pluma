import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

interface ThemeListEditorProps {
  themes: string[]
  disabled: boolean
  onChange: (themes: string[]) => void
}

export default function ThemeListEditor({ themes, disabled, onChange }: ThemeListEditorProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium text-muted-foreground">候选主题</legend>
      <p className="text-xs leading-5 text-muted-foreground">填写游戏内显示的主题名。多个候选会随机选择一个，需已解锁。</p>
      {themes.length === 0 && <p className="text-sm text-muted-foreground">添加至少一个主题名。</p>}
      {themes.map((theme, index) => (
        <div className="flex min-w-0 items-center gap-2" key={index}>
          <Input
            className="min-w-0 flex-1"
            autoComplete="off"
            aria-label={`主题 ${index + 1}`}
            value={theme}
            placeholder="游戏内主题名"
            disabled={disabled}
            onChange={event => onChange(themes.map((current, currentIndex) => currentIndex === index ? event.target.value : current))}
          />
          <Button size="icon" variant="ghost" title={`删除主题 ${index + 1}`} aria-label={`删除主题 ${index + 1}`} disabled={disabled} onClick={() => onChange(themes.filter((_, current) => current !== index))}>
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" disabled={disabled} onClick={() => onChange([...themes, ''])}>
        <Plus size={16} aria-hidden="true" />
        添加主题
      </Button>
    </fieldset>
  )
}
