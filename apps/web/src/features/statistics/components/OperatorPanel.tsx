import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getOperatorAvatarUrl,
  operBoxQueryOptions,
  operatorCatalogWithSourceQueryOptions,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { useAutomationAvailability } from '@/features/runtime-status'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, LoaderCircle, RotateCcw, UserRound, Users } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { EmptyState, Loading, UnavailableAction } from '@/shared/components'
import {
  DEFAULT_OPERATOR_FILTERS,
  buildKnownOperatorIdSet,
  buildOwnedOperatorIdSet,
  hasActiveOperatorFilters,
  isOwnedOperator,
  isProfessionFilterUnavailable,
  isUnknownOperator,
  selectOperators,
  type FilterElite,
  type FilterOwnership,
  type FilterPotential,
  type FilterProfession,
  type FilterRarity,
  type OperatorFilters,
  type SortBy,
} from '../model/operatorFilters'
import { describeOperBoxRecognitionHint } from '../model/operatorRecognition'
import { usePanelScrollTop } from '../hooks/usePanelScrollTop'
import OperatorFilterMenu, { type FilterMenuOption } from './OperatorFilterMenu'
import StatisticsQueryError from './StatisticsQueryError'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'
import type { OpenMenu } from '../types'

const OPER_BOX_READ_ERROR = '暂时无法读取干员识别结果，请检查服务连接后重试。'
const OPERATOR_CATALOG_READ_ERROR = '暂时无法读取干员资料，请检查资源状态后重试。'

const taskPanelClass = (isActive: boolean) =>
  `gap-0 p-0! transition-colors${isActive ? ' bg-primary/5 ring-primary/30' : ''}`

const statCardClass = 'data-statistics-kpi'
const coverageUnavailable = '—'

const AVATAR_FALLBACK_VARIANTS = ['base', '2', '1'] as const

const ownershipOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: 'owned', label: '已拥有' },
  { value: 'unowned', label: '未拥有' },
]
const rarityOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '6', label: '6星' },
  { value: '5', label: '5星' },
  { value: '4', label: '4星' },
  { value: '3', label: '3星' },
  { value: '2', label: '2星' },
  { value: '1', label: '1星' },
]
const professionOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: 'PIONEER', label: '先锋' },
  { value: 'WARRIOR', label: '近卫' },
  { value: 'TANK', label: '重装' },
  { value: 'SNIPER', label: '狙击' },
  { value: 'CASTER', label: '术师' },
  { value: 'MEDIC', label: '医疗' },
  { value: 'SUPPORT', label: '辅助' },
  { value: 'SPECIAL', label: '特种' },
]
const eliteOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '2', label: '精英2' },
  { value: '1', label: '精英1' },
  { value: '0', label: '精英0' },
]
const potentialOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '6', label: '潜能6' },
  { value: '5', label: '潜能5' },
  { value: '4', label: '潜能4' },
  { value: '3', label: '潜能3' },
  { value: '2', label: '潜能2' },
  { value: '1', label: '潜能1' },
]
const sortOptions: readonly FilterMenuOption[] = [
  { value: 'default', label: '默认顺序' },
  { value: 'rarity', label: '星级降序' },
  { value: 'level', label: '等级降序' },
  { value: 'potential', label: '潜能降序' },
]
const ownershipLabels: Record<FilterOwnership, string> = {
  all: '拥有状态',
  owned: '已拥有',
  unowned: '未拥有',
}
const professionLabels: Record<FilterProfession, string> = {
  all: '职业',
  PIONEER: '先锋',
  WARRIOR: '近卫',
  TANK: '重装',
  SNIPER: '狙击',
  CASTER: '术师',
  MEDIC: '医疗',
  SUPPORT: '辅助',
  SPECIAL: '特种',
}
const sortLabels: Record<SortBy, string> = {
  default: '排序',
  rarity: '星级降序',
  level: '等级降序',
  potential: '潜能降序',
}

interface OperatorPanelProps {
  isActive: boolean
  command: StatisticsCommands
}

export default function OperatorPanel({ isActive, command }: OperatorPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const { isAvailable, unavailableMessage } = useAutomationAvailability()
  const {
    setScrollNode,
    setContentBandNode,
    isScrolled,
    isInContentBand,
    scrollMetrics,
    handleScroll,
    scrollToTop,
  } = usePanelScrollTop(shouldReduceMotion)
  const itemIconVersion = useItemIconCacheVersion()
  const operBoxQuery = useQuery(operBoxQueryOptions())
  const operatorCatalogQuery = useQuery(operatorCatalogWithSourceQueryOptions())

  const operBoxData = operBoxQuery.data ?? null
  const catalogData = operatorCatalogQuery.data
  const allOperators = useMemo(
    () => catalogData?.operators ?? [],
    [catalogData],
  )
  const catalogSource = catalogData?.source ?? 'remote'
  const catalogTrusted = !operatorCatalogQuery.isError
    && catalogData?.source === 'remote'
    && allOperators.length > 0
  const operBoxDataError = operBoxQuery.isError ? OPER_BOX_READ_ERROR : null
  const operatorCatalogError = operatorCatalogQuery.isError ? OPERATOR_CATALOG_READ_ERROR : null
  const operatorDataError = operBoxDataError || operatorCatalogError
  const operatorDataLoading = operBoxQuery.isPending || operatorCatalogQuery.isPending
  const operatorDataRefreshing = operBoxQuery.isFetching || operatorCatalogQuery.isFetching

  // 筛选和排序状态属于本面板；面板常驻，切换 tab 不丢筛选。
  const [filters, setFilters] = useState<OperatorFilters>(DEFAULT_OPERATOR_FILTERS)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({})
  const [avatarStages, setAvatarStages] = useState<Record<string, number>>({})
  const [avatarVersion, setAvatarVersion] = useState(itemIconVersion)

  if (avatarVersion !== itemIconVersion) {
    setAvatarVersion(itemIconVersion)
    setLoadedImages({})
    setAvatarStages({})
  }

  const filteredOperators = useMemo(
    () => selectOperators({ catalog: allOperators, catalogSource, operBox: operBoxData, filters }),
    [allOperators, catalogSource, operBoxData, filters],
  )

  const ownedOperatorIds = useMemo(
    () => buildOwnedOperatorIdSet(operBoxData),
    [operBoxData],
  )

  const knownOperatorIds = useMemo(
    () => buildKnownOperatorIdSet(operBoxData),
    [operBoxData],
  )

  const ownedOperatorCount = useMemo(
    () => new Set((operBoxData?.data || []).map(operator => operator.id)).size,
    [operBoxData],
  )
  const operatorCatalogCount = catalogTrusted ? allOperators.length : null
  const operatorCoverage = operatorCatalogCount !== null
    ? Math.min(100, Math.round((ownedOperatorCount / operatorCatalogCount) * 100))
    : null
  const coverageLabel = operatorCoverage !== null ? `${operatorCoverage}%` : coverageUnavailable
  const catalogCountLabel = operatorCatalogCount !== null ? String(operatorCatalogCount) : coverageUnavailable
  const recognitionHint = describeOperBoxRecognitionHint(operBoxData?.recognition)

  // 当筛选条件变化时，清理不再显示的干员图片加载状态。
  // 这是有上限的缓存修剪，不是渲染循环；既有行为由 layout 测试覆盖。
  useEffect(() => {
    const currentOperIds = new Set(filteredOperators.map(op => op.id))

    setLoadedImages(prev => {
      const loadedIds = Object.keys(prev)

      if (loadedIds.length > 500) {
        const newLoadedImages: Record<string, boolean> = {}
        loadedIds.forEach(id => {
          if (currentOperIds.has(id) && prev[id]) {
            newLoadedImages[id] = prev[id]
          }
        })
        return newLoadedImages
      }

      return prev
    })
  }, [filters, filteredOperators])

  const filtersActive = hasActiveOperatorFilters(filters)
  const professionFilterUnavailable = isProfessionFilterUnavailable({ catalogSource, filters })

  const resetOperatorFilters = () => {
    setFilters(DEFAULT_OPERATOR_FILTERS)
  }

  if (!isActive) return null

  const isRecognizing = command.activeKind === 'operbox' && command.isRunning
  const isFetchingMaterials = command.activeKind === 'materials' && command.isRunning
  const unavailableReason = !isAvailable ? unavailableMessage : ''
  const withUnavailableHint = (action: string, node: ReactNode) => (
    unavailableReason
      ? <UnavailableAction action={action} reason={unavailableReason}>{node}</UnavailableAction>
      : node
  )
  const hasOperBoxRows = Boolean(operBoxData?.data && operBoxData.data.length > 0)
  const showLoading = operatorDataLoading && !hasOperBoxRows
  const showErrorPlaceholder = !showLoading && Boolean(operatorDataError) && !hasOperBoxRows
  const showErrorBanner = !showLoading && Boolean(operatorDataError) && hasOperBoxRows
  const showEmpty = !showLoading && !operatorDataError && !hasOperBoxRows
  const showContent = !showLoading && hasOperBoxRows
  const readError = (
    <StatisticsQueryError
      title="干员数据读取失败"
      description={operatorDataError ?? OPER_BOX_READ_ERROR}
      isRetrying={operatorDataRefreshing}
      onRetry={() => {
        void operBoxQuery.refetch()
        void operatorCatalogQuery.refetch()
      }}
    />
  )

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
      className="min-w-0"
    >
      <Card
        role="region"
        aria-labelledby="operator-panel-title"
        data-scroll-clip="panel"
        className={`${taskPanelClass(command.activeTask === 'operbox')} overflow-clip`}
      >
        <CardHeader className="px-4 pt-4 pb-0 max-sm:gap-3">
          <CardTitle
            id="operator-panel-title"
            role="heading"
            aria-level={2}
            className="text-lg font-semibold"
          >
            干员识别
          </CardTitle>
          <CardAction className="flex flex-wrap items-center justify-end gap-2 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-2 max-sm:w-full max-sm:justify-start max-sm:justify-self-stretch">
            {isFetchingMaterials
              ? (
                <Button
                  onClick={command.fetchMaterials}
                  disabled
                  aria-busy
                  variant="outline"
                >
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  正在获取
                </Button>
              )
              : withUnavailableHint('获取材料数据', (
                <Button
                  onClick={command.fetchMaterials}
                  disabled={!isAvailable || command.isRunning}
                  variant="outline"
                >
                  获取材料数据
                </Button>
              ))}
            {isRecognizing
              ? (
                <Button
                  onClick={() => command.startRecognition('operbox')}
                  disabled
                  aria-busy
                >
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  正在执行
                </Button>
              )
              : withUnavailableHint(command.actionLabel('operbox'), (
                <Button
                  onClick={() => command.startRecognition('operbox')}
                  disabled={!isAvailable || command.isRunning}
                >
                  {command.actionLabel('operbox')}
                </Button>
              ))}
          </CardAction>
        </CardHeader>

        <div className="data-statistics-task-content app-stack-card">
          {showLoading && (
            <div className="rounded-xl py-12 surface-soft">
              <Loading text={command.activeTask === 'operbox' ? '正在识别干员数据' : '正在读取干员数据'} />
            </div>
          )}
          {showErrorPlaceholder && readError}
          {showEmpty && (
            <EmptyState
              compact
              className="py-10"
              icon={<Users size={24} strokeWidth={1.7} />}
              title="还没有干员识别结果"
              description="完成一次干员识别后，清单会显示在这里。"
            />
          )}
          {showContent && (
            <div className="app-stack-card">
              {showErrorBanner && readError}
              <div role="group" aria-label="干员数据概览">
                <dl className="data-statistics-kpi-grid grid grid-cols-3 divide-x divide-border">
                  <div className={statCardClass}>
                    <dt className="text-xs text-muted-foreground">已识别</dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">{ownedOperatorCount}</dd>
                  </div>
                  <div className={statCardClass}>
                    <dt className="text-xs text-muted-foreground">干员资料</dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">{catalogCountLabel}</dd>
                  </div>
                  <div className={statCardClass}>
                    <dt className="text-xs text-muted-foreground">档案覆盖</dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">{coverageLabel}</dd>
                  </div>
                </dl>
              </div>

              <section className="rounded-xl surface-soft p-3" aria-labelledby="operator-filter-title">
                <div className="mb-3 flex items-center justify-between gap-3.5">
                  <div className="min-w-0">
                    <h3 id="operator-filter-title" className="text-sm font-semibold text-foreground">筛选与排序</h3>
                    {operBoxData?.timestamp && (
                      <p className="mt-1 truncate text-xs text-tertiary">
                        更新于 {new Date(operBoxData.timestamp).toLocaleString('zh-CN')}
                      </p>
                    )}
                    {recognitionHint && (
                      <p role="status" className="mt-1 text-xs leading-5 text-warning-text">
                        {recognitionHint}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
                    显示 <span className="font-semibold brand-text">{filteredOperators.length}</span> 项
                  </p>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2">
                  <OperatorFilterMenu
                    menuKey="ownership"
                    label={ownershipLabels[filters.ownership]}
                    value={filters.ownership}
                    options={ownershipOptions}
                    isActive={filters.ownership !== 'all'}
                    open={openMenu === 'ownership'}
                    onOpenChange={open => setOpenMenu(open ? 'ownership' : null)}
                    onSelect={value => setFilters(current => ({ ...current, ownership: value as FilterOwnership }))}
                  />

                  <OperatorFilterMenu
                    menuKey="rarity"
                    label={filters.rarity === 'all' ? '星级' : `${filters.rarity}星`}
                    value={filters.rarity}
                    options={rarityOptions}
                    isActive={filters.rarity !== 'all'}
                    open={openMenu === 'rarity'}
                    menuWidth={112}
                    onOpenChange={open => setOpenMenu(open ? 'rarity' : null)}
                    onSelect={value => setFilters(current => ({ ...current, rarity: value as FilterRarity }))}
                  />

                  <OperatorFilterMenu
                    menuKey="profession"
                    label={professionLabels[filters.profession]}
                    value={filters.profession}
                    options={professionOptions}
                    isActive={filters.profession !== 'all'}
                    open={openMenu === 'profession'}
                    mobileAlign="end"
                    onOpenChange={open => setOpenMenu(open ? 'profession' : null)}
                    onSelect={value => setFilters(current => ({ ...current, profession: value as FilterProfession }))}
                  />

                  <OperatorFilterMenu
                    menuKey="elite"
                    label={filters.elite === 'all' ? '精英化' : `精英${filters.elite}`}
                    value={filters.elite}
                    options={eliteOptions}
                    isActive={filters.elite !== 'all'}
                    open={openMenu === 'elite'}
                    menuWidth={112}
                    onOpenChange={open => setOpenMenu(open ? 'elite' : null)}
                    onSelect={value => setFilters(current => ({ ...current, elite: value as FilterElite }))}
                  />

                  <OperatorFilterMenu
                    menuKey="potential"
                    label={filters.potential === 'all' ? '潜能' : `潜能${filters.potential}`}
                    value={filters.potential}
                    options={potentialOptions}
                    isActive={filters.potential !== 'all'}
                    open={openMenu === 'potential'}
                    menuWidth={112}
                    onOpenChange={open => setOpenMenu(open ? 'potential' : null)}
                    onSelect={value => setFilters(current => ({ ...current, potential: value as FilterPotential }))}
                  />

                  <OperatorFilterMenu
                    menuKey="sort"
                    label={sortLabels[filters.sortBy]}
                    value={filters.sortBy}
                    options={sortOptions}
                    isActive={filters.sortBy !== 'default'}
                    open={openMenu === 'sort'}
                    mobileAlign="end"
                    onOpenChange={open => setOpenMenu(open ? 'sort' : null)}
                    onSelect={value => setFilters(current => ({ ...current, sortBy: value as SortBy }))}
                  />

                  {filtersActive && (
                    <Button
                      onClick={resetOperatorFilters}
                      variant="ghost"
                      size="sm"
                      className="min-h-11 w-[calc(33.333%-0.5rem)] sm:w-auto"
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      重置
                    </Button>
                  )}
                </div>
              </section>

              {filteredOperators.length === 0 ? (
                professionFilterUnavailable ? (
                  <EmptyState
                    compact
                    className="py-10"
                    icon={<Users size={24} strokeWidth={1.7} />}
                    title="快照目录不含职业信息"
                    description="当前只能使用识别快照，快照不含职业信息，无法按职业筛选。清除筛选后可继续浏览。"
                    action={(
                      <Button variant="secondary" size="sm" onClick={resetOperatorFilters}>
                        清除筛选
                      </Button>
                    )}
                  />
                ) : (
                  <EmptyState
                    compact
                    className="py-10"
                    icon={<Users size={24} strokeWidth={1.7} />}
                    title="没有符合条件的干员"
                    description="调整筛选条件后再查看。"
                    action={filtersActive ? (
                      <Button variant="secondary" size="sm" onClick={resetOperatorFilters}>
                        清除筛选
                      </Button>
                    ) : undefined}
                  />
                )
              ) : (
                <div className="min-w-0">
                  <div
                    ref={setContentBandNode}
                    data-scroll-anchor="back-to-top"
                    className="flex items-start"
                    style={{
                      position: 'sticky',
                      top: 'var(--layout-content-sticky-top)',
                      zIndex: 'var(--layout-z-sticky)',
                      height: '1.75rem',
                      marginBottom: '-1.75rem',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    {isScrolled && isInContentBand && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="bg-popover shadow-md dark:bg-popover"
                        style={{ pointerEvents: 'auto' }}
                        onClick={scrollToTop}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                        回到顶部
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <div
                      ref={setScrollNode}
                      role="list"
                      aria-label="干员列表"
                      tabIndex={0}
                      onScroll={handleScroll}
                      className="data-statistics-scroll-area data-statistics-item-grid grid grid-cols-2 rounded-xl surface-soft sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    >
                      {filteredOperators.map((oper) => {
                        const isOwned = isOwnedOperator(oper, ownedOperatorIds)
                        const isUnknown = !isOwned && isUnknownOperator(oper, knownOperatorIds)
                        const imageLoaded = loadedImages[oper.id] || false
                        const avatarStage = avatarStages[oper.id] ?? 0
                        const avatarVariant = AVATAR_FALLBACK_VARIANTS[avatarStage] ?? null
                        const avatarFailed = avatarVariant === null

                        return (
                          <div
                            key={oper.id}
                            role="listitem"
                            className={`data-statistics-operator-item relative overflow-hidden p-3 ${
                              isOwned
                                ? ''
                                : 'opacity-70 grayscale-[0.15]'
                            }`}
                          >
                            {!isOwned && (
                              <Badge
                                variant="secondary"
                                className="absolute left-2 top-2 z-10 font-semibold text-muted-foreground"
                              >
                                {isUnknown ? '未知' : '未拥有'}
                              </Badge>
                            )}

                            <div
                              className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl bg-muted"
                              aria-busy={Boolean(oper.id) && !imageLoaded && !avatarFailed ? true : undefined}
                            >
                              {oper.id ? (
                                <>
                                  {!imageLoaded && !avatarFailed && (
                                    <Skeleton className="absolute inset-0 rounded-none" />
                                  )}
                                  {avatarFailed ? (
                                    <div
                                      role="img"
                                      aria-label={`${oper.name}头像不可用`}
                                      className="absolute inset-0 flex items-center justify-center text-muted-foreground"
                                    >
                                      <UserRound size={28} strokeWidth={1.7} aria-hidden="true" />
                                    </div>
                                  ) : (
                                    <img
                                      src={getOperatorAvatarUrl(oper.id, avatarVariant, itemIconVersion)}
                                      alt={oper.name}
                                      className={`h-full w-full object-cover transition-opacity duration-300 ${
                                        imageLoaded ? 'opacity-100' : 'opacity-0'
                                      }`}
                                      onLoad={() => setLoadedImages(prev => ({ ...prev, [oper.id]: true }))}
                                      onError={() => {
                                        setAvatarStages(prev => ({ ...prev, [oper.id]: avatarStage + 1 }))
                                      }}
                                    />
                                  )}
                                  {!isOwned && imageLoaded && !avatarFailed && (
                                    <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--background)_62%,transparent)]"></div>
                                  )}
                                </>
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                                  无头像
                                </div>
                              )}
                              {oper.rarity !== undefined && oper.rarity > 0 && (
                                <Badge
                                  variant="ghost"
                                  className="brand-chip absolute top-1.5 right-1.5 rounded-full border-0 px-2 py-0.5 text-xs font-semibold hover:bg-primary-soft hover:text-primary-strong"
                                >
                                  {Math.min(oper.rarity, 6)}★
                                </Badge>
                              )}
                            </div>

                            <div className="text-center space-y-2">
                              <div className="text-sm font-bold text-foreground truncate" title={oper.name}>
                                {oper.name || '未知干员'}
                              </div>
                              {isOwned && (
                                <>
                                  <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                                    {oper.elite !== undefined && (
                                      <Badge variant="secondary">
                                        精{oper.elite}
                                      </Badge>
                                    )}
                                    {oper.level !== undefined && (
                                      <Badge variant="secondary">
                                        Lv.{oper.level}
                                      </Badge>
                                    )}
                                  </div>
                                  {oper.potential !== undefined && (
                                    <div className="text-xs text-muted-foreground">
                                      潜能 {oper.potential}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {scrollMetrics.hasOverflow && (
                      <div
                        aria-hidden="true"
                        data-scroll-indicator="track"
                        className="data-statistics-scroll-indicator"
                      >
                        <div
                          data-scroll-indicator="thumb"
                          className="data-statistics-scroll-thumb"
                          style={{
                            height: `${scrollMetrics.viewportRatio * 100}%`,
                            top: `${scrollMetrics.progress * (1 - scrollMetrics.viewportRatio) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
