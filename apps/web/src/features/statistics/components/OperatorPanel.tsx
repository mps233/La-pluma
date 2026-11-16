import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getOperatorAvatarUrl,
  operBoxQueryOptions,
  operatorCatalogQueryOptions,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { motion, useReducedMotion } from 'framer-motion'
import { Download, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import Icons from '@/shared/components/Icons'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { EmptyState, Loading } from '@/shared/components'
import {
  DEFAULT_OPERATOR_FILTERS,
  buildKnownOperatorIdSet,
  buildOwnedOperatorIdSet,
  hasActiveOperatorFilters,
  isOwnedOperator,
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
import OperatorFilterMenu, { type FilterMenuOption } from './OperatorFilterMenu'
import InlineDataError from './InlineDataError'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'
import type { OpenMenu } from '../types'

const OPER_BOX_READ_ERROR = '暂时无法读取干员识别结果，请检查服务连接后重试。'
const OPERATOR_CATALOG_READ_ERROR = '暂时无法读取干员资料，请检查资源状态后重试。'

const taskPanelClass = (isActive: boolean) =>
  `data-statistics-task-card gap-0 p-0! transition-colors${isActive ? ' bg-info/5 ring-info/30' : ''}`

const statCardClass = 'data-statistics-kpi'
const chipClass = 'control-surface rounded-full px-2 py-0.5 text-xs whitespace-nowrap'

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
  const itemIconVersion = useItemIconCacheVersion()
  const operBoxQuery = useQuery(operBoxQueryOptions())
  const operatorCatalogQuery = useQuery(operatorCatalogQueryOptions())

  const operBoxData = operBoxQuery.data ?? null
  const allOperators = useMemo(
    () => operatorCatalogQuery.data ?? [],
    [operatorCatalogQuery.data],
  )
  const operBoxDataError = operBoxQuery.isError ? OPER_BOX_READ_ERROR : null
  const operatorCatalogError = operatorCatalogQuery.isError ? OPERATOR_CATALOG_READ_ERROR : null
  const operatorDataError = operBoxDataError || operatorCatalogError
  const operatorDataLoading = operBoxQuery.isPending || operatorCatalogQuery.isPending
  const operatorDataRefreshing = operBoxQuery.isFetching || operatorCatalogQuery.isFetching

  // 筛选和排序状态属于本面板；面板常驻，切换 tab 不丢筛选。
  const [filters, setFilters] = useState<OperatorFilters>(DEFAULT_OPERATOR_FILTERS)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({})

  const filteredOperators = useMemo(
    () => selectOperators({ catalog: allOperators, operBox: operBoxData, filters }),
    [allOperators, operBoxData, filters],
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
  // 档案分母优先用本地目录；只有识别快照带识别目录时才用快照总数，
  // 旧快照的 recognition.total 只是已识别数量，不能当作完整目录。
  const operatorCatalogCount = allOperators.length
    || operBoxData?.operTotal
    || ownedOperatorCount
  const recognitionHint = describeOperBoxRecognitionHint(operBoxData?.recognition)
  const operatorCoverage = operatorCatalogCount > 0
    ? Math.round((ownedOperatorCount / operatorCatalogCount) * 100)
    : 0

  // 当筛选条件变化时，清理不再显示的干员图片加载状态。
  // 这是有上限的缓存修剪，不是渲染循环；既有行为由 layout 测试覆盖。
  useEffect(() => {
    const currentOperIds = new Set(filteredOperators.map(op => op.id))

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 有界缓存清理
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

  const resetOperatorFilters = () => {
    setFilters(DEFAULT_OPERATOR_FILTERS)
  }

  if (!isActive) return null

  const isRecognizing = command.activeKind === 'operbox' && command.isRunning
  const isFetchingMaterials = command.activeKind === 'materials' && command.isRunning

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
      className="min-w-0"
    >
      <Card
        className={taskPanelClass(command.activeTask === 'operbox')}
      >
        <div className="data-statistics-task-content app-stack-card">
          <div className="data-statistics-task-header flex items-start gap-3.5 sm:items-center">
            <div className="flex w-full min-w-0 flex-1 items-center gap-3.5 sm:w-auto">
              <div className="flex h-10 w-10 flex-none items-center justify-center" aria-hidden="true">
                <Icons.Users />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">干员识别</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  读取档案、等级、精英化与潜能数据
                </p>
              </div>
            </div>

            <div className="data-statistics-task-actions flex shrink-0 items-center gap-2">
              <Button
                onClick={command.fetchMaterials}
                disabled={command.isRunning || isFetchingMaterials}
                aria-busy={isFetchingMaterials || undefined}
                variant="outline"
              >
                {isFetchingMaterials
                  ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在获取</>
                  : (
                    <>
                      <Download size={16} aria-hidden="true" />
                      获取材料数据
                    </>
                  )}
              </Button>
              <Button
                onClick={() => command.startRecognition('operbox')}
                disabled={command.isRunning || isRecognizing}
                aria-busy={isRecognizing || undefined}
              >
                {isRecognizing
                  ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在执行</>
                  : (
                    <>
                      <Play size={15} fill="currentColor" aria-hidden="true" />
                      {command.actionLabel('operbox')}
                    </>
                  )}
              </Button>
            </div>
          </div>

          {!operatorDataError && !operBoxData && (operatorDataLoading || command.activeTask === 'operbox') && (
            <div className="rounded-xl py-12 surface-soft" aria-live="polite">
              <Loading text={command.activeTask === 'operbox' ? '正在识别干员数据' : '正在读取干员数据'} />
            </div>
          )}
          {operatorDataError && (
            <InlineDataError
              title="干员数据读取失败"
              description={operatorDataError}
              isRetrying={operatorDataRefreshing}
              onRetry={() => {
                void operBoxQuery.refetch()
                void operatorCatalogQuery.refetch()
              }}
            />
          )}
          {!operatorDataLoading && !operatorDataError && !command.isRunning && (!operBoxData?.data || operBoxData.data.length === 0) && (
            <EmptyState
              compact
              className="py-10"
              icon={<Icons.Users />}
              title="还没有干员识别结果"
              description="完成一次干员识别后，清单会显示在这里。"
            />
          )}
          {operBoxData && operBoxData.data && operBoxData.data.length > 0 && (
            <div className="app-stack-card">
              <div
                className="data-statistics-kpi-grid grid grid-cols-2 lg:grid-cols-4"
                aria-label="干员数据概览"
              >
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">已识别</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{ownedOperatorCount}</p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">干员资料</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{operatorCatalogCount}</p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">当前显示</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{filteredOperators.length}</p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">档案覆盖</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{operatorCoverage}%</p>
                </div>
              </div>

              <section className="rounded-xl surface-soft p-3" aria-labelledby="operator-filter-title">
                <div className="mb-3 flex items-center justify-between gap-3.5">
                  <div className="min-w-0">
                    <h3 id="operator-filter-title" className="text-sm font-semibold text-foreground">筛选与排序</h3>
                    {operBoxData.timestamp && (
                      <p className="mt-1 truncate text-xs text-tertiary">
                        更新于 {new Date(operBoxData.timestamp).toLocaleString('zh-CN')}
                      </p>
                    )}
                    {recognitionHint && (
                      <p role="status" className="mt-1 text-xs leading-5 text-warning">
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
                <EmptyState
                  compact
                  className="py-10"
                  icon={<Icons.Users />}
                  title="没有符合条件的干员"
                  description="调整筛选条件后再查看。"
                  action={filtersActive ? (
                    <Button variant="secondary" size="sm" onClick={resetOperatorFilters}>
                      清除筛选
                    </Button>
                  ) : undefined}
                />
              ) : (
                <div className="data-statistics-item-grid grid grid-cols-2 overflow-hidden rounded-xl surface-soft sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {filteredOperators.map((oper) => {
                    const isOwned = isOwnedOperator(oper, ownedOperatorIds)
                    const isUnknown = !isOwned && isUnknownOperator(oper, knownOperatorIds)
                    const imageLoaded = loadedImages[oper.id] || false

                    return (
                      <div
                        key={oper.id}
                        className={`data-statistics-operator-item relative overflow-hidden p-3 ${
                          isOwned
                            ? ''
                            : 'opacity-70 grayscale-[0.15]'
                        }`}
                      >
                        {!isOwned && (
                          <div className="control-surface absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            {isUnknown ? '未知' : '未拥有'}
                          </div>
                        )}

                        <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl bg-muted">
                          {oper.id ? (
                            <>
                              {!imageLoaded && (
                                <div className="absolute inset-0 animate-pulse bg-muted"></div>
                              )}
                              <img
                                src={getOperatorAvatarUrl(oper.id, 'base', itemIconVersion)}
                                alt={oper.name}
                                className={`h-full w-full object-cover transition-opacity duration-300 ${
                                  imageLoaded ? 'opacity-100' : 'opacity-0'
                                }`}
                                onLoad={() => setLoadedImages(prev => ({ ...prev, [oper.id]: true }))}
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  const currentSrc = target.src
                                  if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                                    target.src = getOperatorAvatarUrl(oper.id, '2', itemIconVersion)
                                  } else if (currentSrc.includes('_2.png')) {
                                    target.src = getOperatorAvatarUrl(oper.id, '1', itemIconVersion)
                                  } else {
                                    target.style.display = 'none'
                                    setLoadedImages(prev => ({ ...prev, [oper.id]: true }))
                                  }
                                }}
                              />
                              {!isOwned && imageLoaded && (
                                <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--background)_62%,transparent)]"></div>
                              )}
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                              无头像
                            </div>
                          )}
                          {oper.rarity !== undefined && oper.rarity > 0 && (
                            <div className="brand-chip absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-xs font-semibold">
                              {Math.min(oper.rarity, 6)}★
                            </div>
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
                                  <span className={chipClass}>
                                    精{oper.elite}
                                  </span>
                                )}
                                {oper.level !== undefined && (
                                  <span className={chipClass}>
                                    Lv.{oper.level}
                                  </span>
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
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
