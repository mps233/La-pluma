import { LoaderCircle } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Item, ItemContent, ItemTitle } from '@/shared/ui/item'
import type { CopilotMatchMode, CopilotSearchItem } from '../types'
import type { CombatCopilotDiscoveryView } from './combatPanelTypes'
import {
  COPILOT_DISCOVERY_OPERATOR_LIMIT,
  COPILOT_MATCH_MODE_LABELS,
  describeCopilotStage,
  formatCopilotHotScore,
  formatCopilotUploadTime,
} from './copilotDiscoveryPresentation'

export interface CombatCopilotDiscoveryCardProps {
  item: CopilotSearchItem
  view: CombatCopilotDiscoveryView
  recommended: boolean
  adding: boolean
  matchEnabled: boolean
  ownedOperatorNames: ReadonlySet<string>
  ownershipKnown?: boolean
  onPreview: (uri: string) => void
  onAddToQueue: (uri: string) => void
}

const MATCH_BADGE_TONES: Readonly<Record<CopilotMatchMode, string>> = {
  ready: 'bg-success/10 text-success-text',
  borrow: 'bg-primary-soft text-primary-strong',
  train: 'bg-warning/15 text-warning-text',
  check: 'bg-muted text-muted-foreground',
  blocked: 'bg-destructive/10 text-destructive',
}

export default function CombatCopilotDiscoveryCard({
  item,
  view,
  recommended,
  adding,
  matchEnabled,
  ownedOperatorNames,
  ownershipKnown = true,
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
  const matchMode = item.match?.mode
  const unrecognized = matchEnabled && !item.match
  const hasBadges = recommended || Boolean(matchLabel)

  return (
    <article
      className={`combat-copilot-discovery-card is-${view}`}
      onClick={() => onPreview(item.uri)}
    >
      {hasBadges && (
        <div className="combat-copilot-discovery-badges">
          {recommended && (
            <Badge variant="secondary" className="bg-success/10 text-success-text">推荐</Badge>
          )}
          {matchLabel && matchMode && (
            <Badge variant="secondary" className={MATCH_BADGE_TONES[matchMode]}>
              {matchLabel}
            </Badge>
          )}
        </div>
      )}

      <Item
        render={(
          <button
            type="button"
            aria-label={`查看作业 ${title}`}
          />
        )}
        className="min-w-0 px-0 py-0 text-left"
      >
        <ItemContent className="gap-1.5">
          <span className="combat-copilot-discovery-card-stage">
            <span className="combat-copilot-discovery-card-code">{stage.code}</span>
            {stage.label && <span className="combat-copilot-discovery-card-label">{stage.label}</span>}
          </span>
          <ItemTitle className="block w-full truncate text-sm leading-snug font-semibold">{title}</ItemTitle>
          {operators.length > 0 && (
            <span className="combat-copilot-discovery-card-operators">
              {visibleOperators.map((name, index) => {
                const owned = ownedOperatorNames.has(name)
                const ownershipClass = !ownershipKnown
                  ? 'bg-muted text-tertiary'
                  : owned ? 'bg-success/10 text-success-text' : 'bg-transparent text-tertiary'
                const ownershipLabel = !ownershipKnown
                  ? '拥有状态未知'
                  : owned ? '已拥有' : '未拥有'
                return (
                  <Badge
                    key={`${name}-${index}`}
                    variant="secondary"
                    className={ownershipClass}
                    title={`${name}（${ownershipLabel}）`}
                  >
                    {name}
                  </Badge>
                )
              })}
              {hiddenOperatorCount > 0 && (
                <Badge variant="secondary" className="bg-muted text-tertiary">+{hiddenOperatorCount}</Badge>
              )}
            </span>
          )}
          <span className="combat-copilot-discovery-card-meta">
            <span>作者 {item.uploader?.trim() || '未知'}</span>
            <span>浏览 {item.views}</span>
            <span>热度 {formatCopilotHotScore(item.hotScore)}</span>
            {uploadedAt && <span>上传 {uploadedAt}</span>}
            {unrecognized && <span className="combat-copilot-discovery-card-unmatched">未识别</span>}
          </span>
        </ItemContent>
      </Item>

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
