import { useMemo, useState, type UIEvent } from 'react'
import { cn } from 'cn'
import { EmptyState, InlineAlert, Loading, SearchField } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { Item } from '@/shared/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import type { CopilotStageCandidate } from '../types'
import {
  COPILOT_DISCOVERY_STAGE_PAGE_SIZE,
  deriveCopilotStageOption,
} from './copilotDiscoveryPresentation'

export interface CombatCopilotStageSelectProps {
  stages: readonly CopilotStageCandidate[]
  value: string
  loading: boolean
  error: string | null
  onChange: (candidate: CopilotStageCandidate | null) => void
  onRetryData: () => void
}

const normalize = (value: string): string => value.trim().toLowerCase()
const STAGE_LIST_SCROLL_THRESHOLD_PX = 24

function matchesStage(candidate: CopilotStageCandidate, query: string): boolean {
  if (!query) return true
  return [candidate.code, candidate.name, candidate.category, candidate.zone, candidate.stageId]
    .some(value => normalize(value).includes(query))
}

export default function CombatCopilotStageSelect({
  stages,
  value,
  loading,
  error,
  onChange,
  onRetryData,
}: CombatCopilotStageSelectProps) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [renderedCount, setRenderedCount] = useState(COPILOT_DISCOVERY_STAGE_PAGE_SIZE)
  const selected = stages.find(candidate => candidate.stageId === value) ?? null
  const selectedOption = selected ? deriveCopilotStageOption(selected) : null

  const visibleStages = useMemo(() => {
    const query = normalize(term)
    return stages.filter(candidate => matchesStage(candidate, query))
  }, [stages, term])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setTerm('')
      setRenderedCount(COPILOT_DISCOVERY_STAGE_PAGE_SIZE)
    }
    setOpen(nextOpen)
  }

  const handleTermChange = (next: string) => {
    setTerm(next)
    setRenderedCount(COPILOT_DISCOVERY_STAGE_PAGE_SIZE)
  }

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    if (list.scrollHeight - list.scrollTop - list.clientHeight > STAGE_LIST_SCROLL_THRESHOLD_PX) return
    setRenderedCount(count => (
      Math.min(count + COPILOT_DISCOVERY_STAGE_PAGE_SIZE, visibleStages.length)
    ))
  }

  const handleSelect = (candidate: CopilotStageCandidate | null) => {
    setOpen(false)
    setTerm('')
    onChange(candidate)
  }

  return (
    <div className="combat-copilot-discovery-stage">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              className="combat-copilot-discovery-stage-trigger"
              aria-label={selectedOption ? `关卡筛选：${selectedOption.code}` : '关卡筛选'}
            />
          }
        >
          {selectedOption?.code ?? '关卡'}
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="选择关卡"
          className="combat-copilot-discovery-stage-panel grid w-(--combat-stage-panel-width) gap-2"
        >
          <SearchField
            ariaLabel="搜索关卡"
            placeholder="搜索关卡代号或名称"
            value={term}
            onValueChange={handleTermChange}
            onClear={() => setRenderedCount(COPILOT_DISCOVERY_STAGE_PAGE_SIZE)}
            clearable
          />

          {loading && <Loading size="sm" text="关卡数据加载中…" />}

          {error && (
            <InlineAlert title="关卡数据读取失败" onRetry={onRetryData}>
              {error}
            </InlineAlert>
          )}

          {!loading && !error && (
            <>
              <div className="combat-copilot-discovery-stage-list" onScroll={handleScroll}>
                <Item
                  render={(
                    <button
                      type="button"
                      onClick={() => handleSelect(null)}
                    />
                  )}
                  className={cn('combat-copilot-discovery-stage-option', !value && 'is-selected')}
                >
                  全部关卡
                </Item>
                {visibleStages.slice(0, renderedCount).map((candidate) => {
                  const option = deriveCopilotStageOption(candidate)
                  const optionLabel = ['选择关卡', option.code, option.name, option.zone]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <Item
                      key={candidate.stageId}
                      render={(
                        <button
                          type="button"
                          aria-label={optionLabel}
                          onClick={() => handleSelect(candidate)}
                        />
                      )}
                      className={cn(
                        'combat-copilot-discovery-stage-option',
                        candidate.stageId === value && 'is-selected',
                      )}
                    >
                      {option.code && (
                        <span className="combat-copilot-discovery-stage-code">{option.code}</span>
                      )}
                      {option.name && (
                        <span className="combat-copilot-discovery-stage-name">{option.name}</span>
                      )}
                      {option.zone && (
                        <span className="combat-copilot-discovery-stage-zone">{option.zone}</span>
                      )}
                    </Item>
                  )
                })}
              </div>

              {visibleStages.length === 0 && (
                <EmptyState
                  compact
                  title="没有符合条件的关卡"
                  description="换个关卡代号或名称再试。"
                />
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
