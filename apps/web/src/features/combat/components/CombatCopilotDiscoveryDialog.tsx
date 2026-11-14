import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { SearchX } from 'lucide-react'
import { EmptyState, Loading } from '@/shared/components'
import { Modal } from '@/shared/components/Modal'
import { usePanelState } from '../hooks/usePanelState'
import {
  DEFAULT_COPILOT_SEARCH_LIMIT,
  normalizeCopilotSearchRequest,
  type CopilotSearchOrder,
  type CopilotSearchRequestInput,
} from '../model/copilotDiscovery'
import {
  writeCopilotDiscoveryViewPreference,
  writeCopilotMatchPreference,
  writeCopilotOperatorFilterPreference,
} from '../model/copilotDiscoveryPreferences'
import { normalizeOperatorSelection, type OperatorSelection } from '../model/operatorFilter'
import type { CopilotSearchItem, CopilotSearchResult, CopilotStageCandidate } from '../types'
import CombatCopilotDiscoveryCard from './CombatCopilotDiscoveryCard'
import CombatCopilotMatchDialog from './CombatCopilotMatchDialog'
import CombatCopilotOperatorFilterDialog from './CombatCopilotOperatorFilterDialog'
import CombatCopilotSearchBar from './CombatCopilotSearchBar'
import {
  COPILOT_DISCOVERY_DIALOG_ID,
  type CombatCopilotDiscoveryView,
  type CombatCopilotMatchSettings,
  type CombatCopilotSearchProjection,
} from './combatPanelTypes'
import { filterCopilotSearchItems } from './copilotDiscoveryPresentation'

export interface CombatCopilotDiscoveryDialogProps {
  search: CombatCopilotSearchProjection
}

const EMPTY_ITEMS: readonly CopilotSearchItem[] = []
const EMPTY_OPERATOR_SELECTION: OperatorSelection = { included: [], excluded: [] }
const DISCOVERY_SCROLL_THRESHOLD_PX = 24

type AppendedPageState = { base: CopilotSearchResult; items: readonly CopilotSearchItem[]; page: number; hasNext: boolean; loading: boolean }

const mergeCopilotItems = (base: readonly CopilotSearchItem[], extra: readonly CopilotSearchItem[]) => [...new Map([...base, ...extra].map(item => [item.uri, item] as const)).values()]

export default function CombatCopilotDiscoveryDialog({ search }: CombatCopilotDiscoveryDialogProps) {
  const [keyword, setKeyword] = usePanelState(search.keywordStore)
  const [level, setLevel] = usePanelState(search.levelStore)
  const [operatorSelection, setOperatorSelection] = usePanelState(search.operatorStore)
  const [operatorFilterEnabled, setOperatorFilterEnabled] = usePanelState(search.operatorFilterEnabledStore)
  const [operatorFilterRemember, setOperatorFilterRemember] = usePanelState(search.operatorFilterRememberStore)
  const [order, setOrder] = usePanelState(search.orderStore)
  const [match, setMatch] = usePanelState(search.matchStore)
  const [view, setView] = usePanelState(search.viewStore)
  const [operatorFilterOpen, setOperatorFilterOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [appendedPages, setAppendedPages] = useState<AppendedPageState | null>(null)
  const loadingPageRef = useRef(false)

  const appended = appendedPages?.base === search.result ? appendedPages : null
  const baseItems = search.result?.copilots ?? EMPTY_ITEMS
  const copilots = useMemo(
    () => (appended ? mergeCopilotItems(baseItems, appended.items) : baseItems),
    [appended, baseItems],
  )
  const total = search.result?.total ?? copilots.length
  const lastLoadedPage = appended?.page ?? search.result?.page ?? 1
  const hasNextPage = appended?.hasNext ?? search.result?.hasNext ?? false
  const visibleItems = useMemo(
    () => filterCopilotSearchItems(copilots, match),
    [copilots, match],
  )
  const recommendedUri = search.result?.recommended?.uri
  const activeOperatorSelection = operatorFilterEnabled ? operatorSelection : EMPTY_OPERATOR_SELECTION

  useEffect(() => {
    if (!search.isOpen) return
    writeCopilotOperatorFilterPreference({
      selection: operatorSelection,
      enabled: operatorFilterEnabled,
      remember: operatorFilterRemember,
    })
  }, [operatorFilterEnabled, operatorFilterRemember, operatorSelection, search.isOpen])

  useEffect(() => {
    if (!search.isOpen) return
    writeCopilotMatchPreference(match)
  }, [match, search.isOpen])

  useEffect(() => {
    if (!search.isOpen) return
    writeCopilotDiscoveryViewPreference(view)
  }, [view, search.isOpen])

  const buildRequest = (overrides: CopilotSearchRequestInput) => normalizeCopilotSearchRequest({
    keyword,
    level,
    includedOperators: activeOperatorSelection.included,
    excludedOperators: activeOperatorSelection.excluded,
    orderBy: order,
    page: 1,
    limit: DEFAULT_COPILOT_SEARCH_LIMIT,
    ...overrides,
  })

  const buildPageRequest = (page: number) => buildRequest({ page, keyword: search.result?.keyword ?? keyword })

  const loadNextPage = async () => {
    const base = search.result
    if (!base || !hasNextPage || search.searching || loadingPageRef.current) return
    loadingPageRef.current = true
    const nextPage = lastLoadedPage + 1
    setAppendedPages({ base, items: appended?.items ?? EMPTY_ITEMS, page: lastLoadedPage, hasNext: hasNextPage, loading: true })
    const result = await search.onLoadMore(buildPageRequest(nextPage))
    loadingPageRef.current = false
    setAppendedPages(current => current?.base !== base ? current : {
      base,
      items: result ? mergeCopilotItems(current.items, result.copilots) : current.items,
      page: result?.page ?? (result ? nextPage : current.page),
      hasNext: result?.hasNext ?? (result ? false : current.hasNext),
      loading: false,
    })
  }

  const handleBodyScroll = (event: UIEvent<HTMLDivElement>) => {
    const body = event.currentTarget
    if (body.scrollHeight - body.scrollTop - body.clientHeight > DISCOVERY_SCROLL_THRESHOLD_PX) return
    void loadNextPage()
  }

  const handleClose = () => {
    setOperatorFilterOpen(false)
    setMatchOpen(false)
    search.onCancel()
    search.onClose()
  }

  const handleKeywordChange = (value: string) => {
    setKeyword(value)
    search.onCancel()
  }

  const handleSubmit = () => {
    search.onSearch(buildRequest({}))
  }

  const handleLevelChange = (candidate: CopilotStageCandidate | null) => {
    const nextLevel = candidate?.stageId ?? ''
    setLevel(nextLevel)
    search.onSearch(buildRequest({ level: nextLevel }))
  }

  const handleOrderChange = (nextOrder: CopilotSearchOrder) => {
    setOrder(nextOrder)
    search.onSearch(buildRequest({ orderBy: nextOrder }))
  }

  const handleOperatorConfirm = (selection: OperatorSelection, remember: boolean) => {
    const normalized = normalizeOperatorSelection(selection)
    setOperatorSelection(normalized)
    setOperatorFilterRemember(remember)
    const active = operatorFilterEnabled ? normalized : EMPTY_OPERATOR_SELECTION
    search.onSearch(buildRequest({
      includedOperators: active.included,
      excludedOperators: active.excluded,
    }))
  }

  const handleToggleOperatorFilter = () => {
    const nextEnabled = !operatorFilterEnabled
    setOperatorFilterEnabled(nextEnabled)
    const active = nextEnabled ? operatorSelection : EMPTY_OPERATOR_SELECTION
    search.onSearch(buildRequest({
      includedOperators: active.included,
      excludedOperators: active.excluded,
    }))
  }

  const handleMatchChange = (settings: CombatCopilotMatchSettings) => {
    setMatch(settings)
  }

  const handleViewChange = (nextView: CombatCopilotDiscoveryView) => {
    setView(nextView)
  }

  const renderResults = () => {
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

  return (
    <Modal
      isOpen={search.isOpen}
      onClose={handleClose}
      title="发现作业"
      size="xl"
      dialogId={COPILOT_DISCOVERY_DIALOG_ID}
      onBodyScroll={handleBodyScroll}
    >
      <div className="combat-copilot-discovery">
        <CombatCopilotSearchBar
          keyword={keyword}
          level={level}
          order={order}
          operatorSelection={operatorSelection}
          stages={search.stages}
          stagesLoading={search.stagesLoading}
          stagesError={search.stagesError}
          matchEnabled={match.enabled}
          operatorFilterEnabled={operatorFilterEnabled}
          view={view}
          searching={search.searching}
          onKeywordChange={handleKeywordChange}
          onSubmit={handleSubmit}
          onLevelChange={handleLevelChange}
          onOrderChange={handleOrderChange}
          onOpenOperatorFilter={() => setOperatorFilterOpen(true)}
          onToggleOperatorFilter={handleToggleOperatorFilter}
          onOpenMatch={() => setMatchOpen(true)}
          onViewChange={handleViewChange}
          onRetryData={search.onRetryData}
        />

        {search.result && (
          <div className="combat-copilot-discovery-summary">
            <span>共 {total} 条</span>
            {total > copilots.length && <span>已加载 {copilots.length} 条</span>}
            {match.enabled && (
              <span className="combat-copilot-discovery-match-count">匹配 {visibleItems.length} 条</span>
            )}
          </div>
        )}

        {renderResults()}

        {appended?.loading && <div className="combat-copilot-discovery-loading"><Loading text="正在加载更多…" /></div>}
      </div>

      <CombatCopilotOperatorFilterDialog
        isOpen={operatorFilterOpen}
        selection={operatorSelection}
        enabled={operatorFilterEnabled}
        remember={operatorFilterRemember}
        operators={search.operators}
        operatorsLoading={search.operatorsLoading}
        operatorsError={search.operatorsError}
        onRetryData={search.onRetryData}
        onConfirm={handleOperatorConfirm}
        onClose={() => setOperatorFilterOpen(false)}
      />

      <CombatCopilotMatchDialog
        isOpen={matchOpen}
        settings={match}
        ownedOperatorNames={search.ownedOperatorNames}
        onChange={handleMatchChange}
        onClose={() => setMatchOpen(false)}
      />
    </Modal>
  )
}
