import { SearchX } from 'lucide-react'
import { EmptyState, Loading } from '@/shared/components'
import type { CopilotSearchItem } from '../types'
import CombatCopilotDiscoveryCard from './CombatCopilotDiscoveryCard'
import type {
  CombatCopilotDiscoveryView,
  CombatCopilotMatchSettings,
  CombatCopilotSearchProjection,
} from './combatPanelTypes'

interface CombatCopilotDiscoveryResultsProps {
  search: CombatCopilotSearchProjection
  copilots: readonly CopilotSearchItem[]
  visibleItems: readonly CopilotSearchItem[]
  view: CombatCopilotDiscoveryView
  match: CombatCopilotMatchSettings
  recommendedUri?: string
}

export default function CombatCopilotDiscoveryResults({
  search,
  copilots,
  visibleItems,
  view,
  match,
  recommendedUri,
}: CombatCopilotDiscoveryResultsProps) {
  if (search.searching) {
    return (
      <div className="combat-copilot-discovery-loading">
        <Loading text="正在搜索作业…" />
      </div>
    )
  }

  if (search.result === null && search.refreshing) {
    return (
      <div className="combat-copilot-discovery-loading">
        <Loading text="正在加载作业…" />
      </div>
    )
  }

  if (copilots.length === 0) {
    const hasResult = search.result !== null
    return (
      <EmptyState
        compact
        className="combat-copilot-discovery-empty"
        icon={<SearchX size={21} strokeWidth={1.8} aria-hidden="true" />}
        title={hasResult ? '没有匹配结果' : '暂无作业'}
        description={hasResult
          ? '换个关键词、关卡或干员再试。'
          : '暂时没有可展示的作业，换个关键词或稍后重试。'}
      />
    )
  }

  if (visibleItems.length === 0) {
    return (
      <EmptyState
        compact
        className="combat-copilot-discovery-empty"
        icon={<SearchX size={21} strokeWidth={1.8} aria-hidden="true" />}
        title="没有匹配结果"
        description="没有符合作战条件的作业，放宽匹配模式或关闭匹配后再试。"
      />
    )
  }

  return (
    <div className={`combat-copilot-discovery-results is-${view}`}>
      {visibleItems.map(item => (
        <CombatCopilotDiscoveryCard
          key={item.id || item.uri}
          item={item}
          view={view}
          recommended={recommendedUri === item.uri}
          adding={search.addingUri === item.uri}
          matchEnabled={match.enabled}
          ownedOperatorNames={search.ownedOperatorNames}
          onPreview={search.onPreviewUri}
          onAddToQueue={search.onAddToQueue}
        />
      ))}
    </div>
  )
}
