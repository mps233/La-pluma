import { useRef, type KeyboardEvent } from 'react'
import { LayoutGrid, List, LoaderCircle, Power, Search, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import {
  COPILOT_SEARCH_ORDERS,
  COPILOT_SEARCH_ORDER_LABELS,
  isCopilotSearchOrder,
  type CopilotSearchOrder,
} from '../model/copilotDiscovery'
import type { OperatorSelection } from '../model/operatorFilter'
import type { CopilotStageCandidate } from '../types'
import type { CombatCopilotDiscoveryView } from './combatPanelTypes'
import CombatCopilotStageSelect from './CombatCopilotStageSelect'
import { countOperatorSelection } from './copilotDiscoveryPresentation'

export interface CombatCopilotSearchBarProps {
  keyword: string
  level: string
  order: CopilotSearchOrder
  operatorSelection: OperatorSelection
  stages: readonly CopilotStageCandidate[]
  stagesLoading: boolean
  stagesError: string | null
  matchEnabled: boolean
  operatorFilterEnabled: boolean
  view: CombatCopilotDiscoveryView
  searching: boolean
  onKeywordChange: (value: string) => void
  onSubmit: () => void
  onLevelChange: (candidate: CopilotStageCandidate | null) => void
  onOrderChange: (order: CopilotSearchOrder) => void
  onOpenOperatorFilter: () => void
  onToggleOperatorFilter: () => void
  onOpenMatch: () => void
  onViewChange: (view: CombatCopilotDiscoveryView) => void
  onRetryData: () => void
}

const ORDER_OPTIONS = COPILOT_SEARCH_ORDERS.map(order => ({
  value: order,
  label: COPILOT_SEARCH_ORDER_LABELS[order],
}))

export default function CombatCopilotSearchBar({
  keyword,
  level,
  order,
  operatorSelection,
  stages,
  stagesLoading,
  stagesError,
  matchEnabled,
  operatorFilterEnabled,
  view,
  searching,
  onKeywordChange,
  onSubmit,
  onLevelChange,
  onOrderChange,
  onOpenOperatorFilter,
  onToggleOperatorFilter,
  onOpenMatch,
  onViewChange,
  onRetryData,
}: CombatCopilotSearchBarProps) {
  const operatorCount = countOperatorSelection(operatorSelection.included, operatorSelection.excluded)
  const keywordFieldRef = useRef<HTMLDivElement>(null)

  const handleClearKeyword = () => {
    onKeywordChange('')
    keywordFieldRef.current?.querySelector('input')?.focus()
  }

  const handleKeywordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onSubmit()
  }

  const handleOrderChange = (value: string) => {
    if (!isCopilotSearchOrder(value)) return
    onOrderChange(value)
  }

  return (
    <section className="combat-copilot-discovery-search" aria-label="作业搜索">
      <div className="combat-copilot-discovery-search-row">
        <div ref={keywordFieldRef} className="combat-copilot-discovery-keyword-field">
          <div className="relative">
            <Search size={17} strokeWidth={1.9} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <Input
              type="text"
              autoComplete="off"
              className="combat-copilot-discovery-keyword pl-9"
              aria-label="搜索作业关键词"
              placeholder="搜索作业标题、说明"
              value={keyword}
              onChange={event => onKeywordChange(event.target.value)}
              onKeyDown={handleKeywordKeyDown}
            />
          </div>
          {keyword !== '' && (
            <Button
              size="icon"
              variant="ghost"
              title="清除搜索关键词"
              aria-label="清除搜索关键词"
              onClick={handleClearKeyword}
              className="combat-copilot-discovery-clear"
            >
              <X size={15} aria-hidden="true" />
            </Button>
          )}
        </div>
        <Button
          className="combat-copilot-discovery-submit"
          disabled={searching}
          aria-busy={searching || undefined}
          onClick={onSubmit}
        >
          {searching
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />搜索中</>
            : '搜索'}
        </Button>
      </div>

      <div className="combat-copilot-discovery-filters">
        <CombatCopilotStageSelect
          stages={stages}
          value={level}
          loading={stagesLoading}
          error={stagesError}
          onChange={onLevelChange}
          onRetryData={onRetryData}
        />

        <div className={`combat-copilot-discovery-operator-control${operatorFilterEnabled ? '' : ' is-disabled'}`}>
          <Button
            variant="secondary"
            className="combat-copilot-discovery-operator-trigger"
            aria-haspopup="dialog"
            onClick={onOpenOperatorFilter}
          >
            干员{operatorCount > 0 ? ` ${operatorCount}` : ''}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="combat-copilot-discovery-operator-toggle"
            aria-label={operatorFilterEnabled ? '停用干员筛选' : '启用干员筛选'}
            title={operatorFilterEnabled ? '停用干员筛选' : '启用干员筛选'}
            aria-pressed={operatorFilterEnabled}
            onClick={onToggleOperatorFilter}
          >
            <Power className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <Button
          variant="secondary"
          className={`combat-copilot-discovery-toggle${matchEnabled ? ' is-active' : ''}`}
          aria-pressed={matchEnabled}
          aria-haspopup="dialog"
          onClick={onOpenMatch}
        >
          匹配
        </Button>

        <Select
          items={ORDER_OPTIONS}
          value={order}
          onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) handleOrderChange(next) }}
        >
          <SelectTrigger aria-label="排序" className="combat-copilot-discovery-order w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_OPTIONS.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          value={[view]}
          onValueChange={next => {
            const nextView = next[0]
            if (nextView === 'grid' || nextView === 'list') onViewChange(nextView)
          }}
          multiple={false}
          aria-label="结果视图"
          spacing={0.5}
        >
          <ToggleGroupItem value="grid" aria-label="网格视图" title="网格视图">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="列表视图" title="列表视图">
            <List className="h-4 w-4" aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </section>
  )
}
