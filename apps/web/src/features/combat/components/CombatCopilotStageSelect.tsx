import { useMemo, useState, type UIEvent } from 'react'
import { Search } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
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

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
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
          <div className="relative">
            <Search size={17} strokeWidth={1.9} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <Input
              type="text"
              autoComplete="off"
              aria-label="搜索关卡"
              placeholder="搜索关卡代号或名称"
              value={term}
              onChange={event => handleTermChange(event.target.value)}
              className="pl-9"
            />
          </div>

          {loading && <p className="combat-copilot-discovery-stage-state" role="status">关卡数据加载中…</p>}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>关卡数据读取失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button size="sm" variant="secondary" onClick={onRetryData}>重试</Button>
              </AlertAction>
            </Alert>
          )}

          {!loading && !error && (
            <>
              <ul className="combat-copilot-discovery-stage-list" onScroll={handleScroll}>
                <li>
                  <button
                    type="button"
                    className={`combat-copilot-discovery-stage-option${value ? '' : ' is-selected'}`}
                    onClick={() => handleSelect(null)}
                  >
                    全部关卡
                  </button>
                </li>
                {visibleStages.slice(0, renderedCount).map((candidate) => {
                  const option = deriveCopilotStageOption(candidate)
                  const optionLabel = ['选择关卡', option.code, option.name, option.zone]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <li key={candidate.stageId}>
                      <button
                        type="button"
                        className={`combat-copilot-discovery-stage-option${
                          candidate.stageId === value ? ' is-selected' : ''
                        }`}
                        aria-label={optionLabel}
                        onClick={() => handleSelect(candidate)}
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
                      </button>
                    </li>
                  )
                })}
              </ul>

              {visibleStages.length === 0 && (
                <p className="combat-copilot-discovery-stage-state">没有符合条件的关卡。</p>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
