import { useRef, type KeyboardEvent } from 'react'
import { LayoutGrid, List, Power, Search, X } from 'lucide-react'
import { Button, IconButton, Input, Select } from '@/shared/components'
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
          <Input
            type="text"
            className="combat-copilot-discovery-keyword"
            aria-label="搜索作业关键词"
            placeholder="搜索作业标题、说明"
            value={keyword}
            onChange={onKeywordChange}
            onKeyDown={handleKeywordKeyDown}
            icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
          />
          {keyword !== '' && (
            <IconButton
              icon={<X size={15} aria-hidden="true" />}
              title="清除搜索关键词"
              aria-label="清除搜索关键词"
              size="sm"
              onClick={handleClearKeyword}
              className="combat-copilot-discovery-clear"
            />
          )}
        </div>
        <Button
          variant="primary"
          size="md"
          className="combat-copilot-discovery-submit"
          loading={searching}
          loadingText="搜索中"
          onClick={onSubmit}
        >
          搜索
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
            size="md"
            className="combat-copilot-discovery-operator-trigger"
            aria-haspopup="dialog"
            onClick={onOpenOperatorFilter}
          >
            干员{operatorCount > 0 ? ` ${operatorCount}` : ''}
          </Button>
          <IconButton
            icon={<Power className="h-4 w-4" aria-hidden="true" />}
            variant="secondary"
            size="md"
            className="combat-copilot-discovery-operator-toggle"
            aria-label={operatorFilterEnabled ? '停用干员筛选' : '启用干员筛选'}
            title={operatorFilterEnabled ? '停用干员筛选' : '启用干员筛选'}
            aria-pressed={operatorFilterEnabled}
            onClick={onToggleOperatorFilter}
          />
        </div>

        <Button
          variant="secondary"
          size="md"
          className={`combat-copilot-discovery-toggle${matchEnabled ? ' is-active' : ''}`}
          aria-pressed={matchEnabled}
          aria-haspopup="dialog"
          onClick={onOpenMatch}
        >
          匹配
        </Button>

        <Select
          className="combat-copilot-discovery-order"
          aria-label="排序"
          value={order}
          onChange={handleOrderChange}
          options={ORDER_OPTIONS}
        />

        <div className="combat-copilot-discovery-view-toggle" role="group" aria-label="结果视图">
          <IconButton
            icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />}
            size="sm"
            variant="ghost"
            className={`combat-copilot-discovery-view-button${view === 'grid' ? ' is-active' : ''}`}
            aria-label="网格视图"
            title="网格视图"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
          />
          <IconButton
            icon={<List className="h-4 w-4" aria-hidden="true" />}
            size="sm"
            variant="ghost"
            className={`combat-copilot-discovery-view-button${view === 'list' ? ' is-active' : ''}`}
            aria-label="列表视图"
            title="列表视图"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
          />
        </div>
      </div>
    </section>
  )
}
