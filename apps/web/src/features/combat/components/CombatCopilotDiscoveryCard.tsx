import { LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { CopilotSearchItem } from '../types'
import type { CombatCopilotDiscoveryView } from './combatPanelTypes'
import {
  COPILOT_DISCOVERY_OPERATOR_LIMIT,
  COPILOT_MATCH_MODE_LABELS,
  describeCopilotStage,
  formatCopilotUploadTime,
} from './copilotDiscoveryPresentation'

export interface CombatCopilotDiscoveryCardProps {
  item: CopilotSearchItem
  view: CombatCopilotDiscoveryView
  recommended: boolean
  adding: boolean
  matchEnabled: boolean
  ownedOperatorNames: ReadonlySet<string>
  onPreview: (uri: string) => void
  onAddToQueue: (uri: string) => void
}

export default function CombatCopilotDiscoveryCard({
  item,
  view,
  recommended,
  adding,
  matchEnabled,
  ownedOperatorNames,
  onPreview,
  onAddToQueue,
}: CombatCopilotDiscoveryCardProps) {
  const title = item.title?.trim() || `作业 ${item.id}`
  const stage = describeCopilotStage(item)
  const uploadedAt = formatCopilotUploadTime(item.uploadTime)
  const operators = item.operators ?? []
  const visibleOperators = operators.slice(0, COPILOT_DISCOVERY_OPERATOR_LIMIT)
  const hiddenOperatorCount = operators.length - visibleOperators.length
  const matchLabel = item.match ? COPILOT_MATCH_MODE_LABELS[item.match.mode] : null
  const unrecognized = matchEnabled && !item.match
  const hasBadges = recommended || Boolean(matchLabel)

  return (
    <article
      className={`combat-copilot-discovery-card is-${view}`}
      onClick={() => onPreview(item.uri)}
    >
      {hasBadges && (
        <div className="combat-copilot-discovery-badges">
          {recommended && <span className="combat-copilot-discovery-badge is-recommended">推荐</span>}
          {matchLabel && (
            <span className={`combat-copilot-discovery-badge is-match is-${item.match?.mode}`}>
              {matchLabel}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        className="combat-copilot-discovery-card-main"
        aria-label={`查看作业 ${title}`}
      >
        <span className="combat-copilot-discovery-card-stage">
          <span className="combat-copilot-discovery-card-code">{stage.code}</span>
          {stage.label && <span className="combat-copilot-discovery-card-label">{stage.label}</span>}
        </span>
        <span className="combat-copilot-discovery-card-title">{title}</span>
        {operators.length > 0 && (
          <span className="combat-copilot-discovery-card-operators">
            {visibleOperators.map((name, index) => {
              const owned = ownedOperatorNames.has(name)
              return (
                <span
                  key={`${name}-${index}`}
                  className={`combat-copilot-discovery-operator-chip ${owned ? 'is-owned' : 'is-missing'}`}
                  title={`${name}（${owned ? '已拥有' : '未拥有'}）`}
                >
                  {name}
                </span>
              )
            })}
            {hiddenOperatorCount > 0 && (
              <span className="combat-copilot-discovery-operator-chip is-more">+{hiddenOperatorCount}</span>
            )}
          </span>
        )}
        <span className="combat-copilot-discovery-card-meta">
          <span>作者 {item.uploader?.trim() || '未知'}</span>
          <span>浏览 {item.views}</span>
          <span>热度 {item.hotScore}</span>
          {uploadedAt && <span>上传 {uploadedAt}</span>}
          {unrecognized && <span className="combat-copilot-discovery-card-unmatched">未识别</span>}
        </span>
      </button>

      <div
        className="combat-copilot-discovery-card-actions"
        onClick={event => event.stopPropagation()}
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={adding}
          aria-busy={adding || undefined}
          aria-label={`加入队列: ${title}`}
          onClick={() => onAddToQueue(item.uri)}
        >
          {adding
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />加入中</>
            : '加入队列'}
        </Button>
      </div>
    </article>
  )
}
