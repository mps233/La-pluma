import { LoaderCircle } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Item, ItemContent } from '@/shared/ui/item'
import { usePanelState } from '../hooks/usePanelState'
import type { PanelStateStore } from '../model/panelState'
import type { ParadoxSearchResult } from '../types'
import { formatCopilotHotScore } from './copilotDiscoveryPresentation'

interface CombatParadoxSearchPanelProps {
  nameStore: PanelStateStore<string>
  result: ParadoxSearchResult | null
  searching: boolean
  onSearch: (name: string) => void
  onCancel: () => void
  onSelectUri: (uri: string) => void
}

export default function CombatParadoxSearchPanel({
  nameStore,
  result,
  searching,
  onSearch,
  onCancel,
  onSelectUri,
}: CombatParadoxSearchPanelProps) {
  const [name, setName] = usePanelState(nameStore)

  const handleNameChange = (value: string) => {
    // 输入变化即放弃在途搜索；旧响应不会写入新的展示状态。
    onCancel()
    setName(value)
  }

  return (
    <div className="combat-workspace-section">
      <h3 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-foreground">
        <svg aria-hidden="true" className="h-4 w-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span>干员搜索</span>
      </h3>
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor="combat-paradox-operator" className="sr-only">搜索悖论模拟干员</FieldLabel>
        <Input
          id="combat-paradox-operator"
          type="text"
          name="maa-paradox-operator"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="古米、能天使"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || searching || !name.trim()) return
            e.preventDefault()
            onSearch(name)
          }}
          className="min-h-11 min-w-0 flex-1"
        />
        <Button
          onClick={() => onSearch(name)}
          disabled={searching || !name.trim()}
          aria-busy={searching || undefined}
          variant="secondary"
          className="min-h-11 shrink-0 px-3"
        >
          {searching
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />加载中...</>
            : '搜索'}
        </Button>
      </div>

      {result && result.copilots && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium brand-text">{result.operator}</span>
            <span className="text-tertiary">{result.copilots.length} 个作业</span>
          </div>
          <div className="max-h-56 divide-y divide-border overflow-hidden overflow-y-auto rounded-lg border border-border bg-card">
            {result.copilots.map((copilot, idx) => (
              <Item
                key={copilot.id}
                render={(
                  <button
                    type="button"
                    onClick={() => onSelectUri(copilot.uri)}
                  />
                )}
                className="min-h-11 rounded-none px-3 py-2 text-left text-xs hover:bg-muted"
              >
                <ItemContent className="gap-1">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono brand-text">{copilot.uri}</span>
                    {idx === 0 && (
                      <Badge variant="ghost" className="brand-chip shrink-0">推荐</Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span>浏览 {copilot.views.toLocaleString()}</span>
                    <span>/</span>
                    <span>热度 {formatCopilotHotScore(copilot.hotScore)}</span>
                  </span>
                </ItemContent>
              </Item>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
