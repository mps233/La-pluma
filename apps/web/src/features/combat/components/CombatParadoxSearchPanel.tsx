import { LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { usePanelState } from '../hooks/usePanelState'
import type { PanelStateStore } from '../model/panelState'
import type { ParadoxSearchResult } from '../types'

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
      <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-foreground">
        <svg className="h-4 w-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span>干员搜索</span>
      </h5>
      <div className="flex space-x-2">
        <label htmlFor="combat-paradox-operator" className="sr-only">搜索悖论模拟干员</label>
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
          className="shrink-0 px-3"
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
            {result.copilots.slice(0, 6).map((copilot, idx) => {
              const stars = Math.min(5, Math.max(1, Math.ceil(copilot.hotScore)))

              return (
                <button
                  key={copilot.id}
                  onClick={() => onSelectUri(copilot.uri)}
                  className="min-h-11 w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono brand-text">{copilot.uri}</span>
                    {idx === 0 && (
                      <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium brand-chip">推荐</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center space-x-2 text-muted-foreground">
                    <span>浏览 {copilot.views.toLocaleString()}</span>
                    <span>/</span>
                    <div className="flex items-center">
                      {[...Array(stars)].map((_, i) => (
                        <svg key={i} className="h-3 w-3 brand-text" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
