import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/components'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = stages.find(candidate => candidate.stageId === value) ?? null
  const selectedOption = selected ? deriveCopilotStageOption(selected) : null

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const visibleStages = useMemo(() => {
    const query = normalize(term)
    return stages.filter(candidate => matchesStage(candidate, query))
  }, [stages, term])

  const handleToggle = () => {
    if (!open) {
      setTerm('')
      setRenderedCount(COPILOT_DISCOVERY_STAGE_PAGE_SIZE)
    }
    setOpen(!open)
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
    <div className="combat-copilot-discovery-stage" ref={containerRef}>
      <Button
        variant="secondary"
        className="combat-copilot-discovery-stage-trigger"
        aria-expanded={open}
        aria-label={selectedOption ? `关卡筛选：${selectedOption.code}` : '关卡筛选'}
        onClick={handleToggle}
      >
        {selectedOption?.code ?? '关卡'}
      </Button>

      {open && (
        <div className="combat-copilot-discovery-stage-panel" role="dialog" aria-label="选择关卡">
          <Input
            type="text"
            aria-label="搜索关卡"
            placeholder="搜索关卡代号或名称"
            value={term}
            onChange={handleTermChange}
            icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
          />

          {loading && <p className="combat-copilot-discovery-stage-state" role="status">关卡数据加载中…</p>}

          {error && (
            <div className="combat-copilot-discovery-stage-error" role="alert">
              <span>{error}</span>
              <Button size="sm" variant="secondary" onClick={onRetryData}>重试</Button>
            </div>
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
        </div>
      )}
    </div>
  )
}
