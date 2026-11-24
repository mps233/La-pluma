import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  depotQueryOptions,
  getItemIconUrl,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { useAutomationAvailability } from '@/features/runtime-status'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, LoaderCircle, Package as PackageIcon } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardHeader, CardTitle } from '@/shared/ui/card'
import { EmptyState, Loading } from '@/shared/components'
import { getDepotTypeLabel, summarizeDepot } from '../model/depotSummary'
import { usePanelScrollTop } from '../hooks/usePanelScrollTop'
import StatisticsQueryError from './StatisticsQueryError'
import UnavailableAction from './UnavailableAction'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'

const DEPOT_READ_ERROR = '暂时无法读取仓库数据，请检查服务连接后重试。'

const taskPanelClass = (isActive: boolean) =>
  `gap-0 p-0! transition-colors${isActive ? ' bg-primary/5 ring-primary/30' : ''}`

const statCardClass = 'data-statistics-kpi'

interface DepotPanelProps {
  isActive: boolean
  command: StatisticsCommands
}

export default function DepotPanel({ isActive, command }: DepotPanelProps) {
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
  // 资源更新成功后推进，使同一图标的 `<img src>` 换到新的浏览器缓存身份。
  const itemIconVersion = useItemIconCacheVersion()
  const depotQuery = useQuery(depotQueryOptions())
  const [failedDepotImages, setFailedDepotImages] = useState<Record<string, boolean>>({})
  const [failedDepotImagesVersion, setFailedDepotImagesVersion] = useState(itemIconVersion)

  const depotData = depotQuery.data ?? null
  const depotDataLoading = depotQuery.isPending
  const depotDataRefreshing = depotQuery.isFetching
  const depotDataError = depotQuery.isError ? DEPOT_READ_ERROR : null
  const overview = useMemo(() => summarizeDepot(depotData), [depotData])

  if (failedDepotImagesVersion !== itemIconVersion) {
    setFailedDepotImagesVersion(itemIconVersion)
    setFailedDepotImages({})
  }

  if (!isActive) return null

  const isRecognizing = command.activeKind === 'depot' && command.isRunning
  const unavailableReason = !isAvailable ? unavailableMessage : ''
  const withUnavailableHint = (action: string, node: ReactNode) => (
    unavailableReason
      ? <UnavailableAction action={action} reason={unavailableReason}>{node}</UnavailableAction>
      : node
  )
  const latestRecognition = depotData?.timestamp
    ? new Date(depotData.timestamp).toLocaleString('zh-CN')
    : '-'

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
      className="min-w-0"
    >
      <Card
        role="region"
        aria-labelledby="depot-panel-title"
        data-scroll-clip="panel"
        className={`${taskPanelClass(command.activeTask === 'depot')} overflow-clip`}
      >
        <CardHeader className="px-4 pt-4 pb-0">
          <CardTitle
            id="depot-panel-title"
            role="heading"
            aria-level={2}
            className="text-lg font-semibold"
          >
            仓库识别
          </CardTitle>
          <CardAction>
            {isRecognizing
              ? (
                <Button
                  onClick={() => command.startRecognition('depot')}
                  disabled
                  aria-busy
                >
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  正在执行
                </Button>
              )
              : withUnavailableHint(command.actionLabel('depot'), (
                <Button
                  onClick={() => command.startRecognition('depot')}
                  disabled={!isAvailable || command.isRunning}
                >
                  {command.actionLabel('depot')}
                </Button>
              ))}
          </CardAction>
        </CardHeader>

        <div className="data-statistics-task-content app-stack-card">
          {depotDataLoading && (
            <div className="rounded-xl py-12 surface-soft">
              <Loading text={command.activeTask === 'depot' ? '正在识别仓库数据' : '正在读取仓库数据'} />
            </div>
          )}
          {depotDataError && (
            <StatisticsQueryError
              title="仓库数据读取失败"
              description={depotDataError}
              isRetrying={depotDataRefreshing}
              onRetry={() => {
                void depotQuery.refetch()
              }}
            />
          )}
          {!depotDataLoading && !depotDataError && !depotData && (
            <EmptyState
              compact
              className="py-10"
              icon={<PackageIcon size={24} strokeWidth={1.7} />}
              title="还没有仓库识别结果"
              description="完成一次仓库识别后，物品清单会显示在这里。"
            />
          )}
          {depotData && (
            <div className="app-stack-card">
              <div
                className="data-statistics-kpi-grid data-statistics-kpi-grid-depot grid grid-cols-2 md:grid-cols-3"
                role="group"
                aria-label="仓库数据概览"
              >
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">物品种类</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview.itemCount}
                  </p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">材料种类</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview.materialKinds}
                  </p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">识别分类</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview.categoryCount}
                  </p>
                </div>
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">库存总量</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview.totalCount.toLocaleString()}
                  </p>
                </div>
                <div className={`${statCardClass} data-statistics-kpi-split-cell col-span-2`}>
                  <div className="data-statistics-kpi-split grid h-full grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">库存最多</p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {overview.topItem?.name ?? '-'}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">最近识别</p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {latestRecognition}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {overview.groups.length > 0 && (
                <section className="rounded-xl surface-soft p-3" aria-labelledby="depot-category-title">
                  <h3 id="depot-category-title" className="mb-2 text-sm font-semibold text-foreground">分类汇总</h3>
                  <div className="flex flex-wrap gap-2">
                    {overview.groups.map((group) => (
                      <Badge
                        key={group.type}
                        variant="outline"
                        className="h-auto max-w-full flex-wrap gap-0 whitespace-normal py-1 text-muted-foreground"
                      >
                        <span className="font-medium">{group.label}</span>
                        <span className="mx-1 brand-text">·</span>
                        <span>{group.kinds} 种</span>
                        <span className="mx-1 brand-text">/</span>
                        <span>{group.count.toLocaleString()} 件</span>
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {depotData.items && depotData.items.length > 0 && (
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
                      aria-label="仓库物品清单"
                      tabIndex={0}
                      onScroll={handleScroll}
                      className="data-statistics-scroll-area data-statistics-item-grid grid grid-cols-1 rounded-xl surface-soft sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
                    >
                      {depotData.items.map((item) => {
                        const itemKey = item.id || item.iconId
                        const imageKey = `${itemKey}:${item.iconId}`

                        return (
                          <div
                            key={itemKey}
                            role="listitem"
                            className="data-statistics-depot-item flex min-w-0 items-center gap-3.5 p-3"
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                              {failedDepotImages[imageKey] ? (
                                <span role="img" aria-label={`${item.name}图标不可用`}>
                                  <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                                </span>
                              ) : (
                                <img
                                  src={getItemIconUrl(item.id, itemIconVersion)}
                                  alt={item.name}
                                  className="w-full h-full object-cover"
                                  onError={() => {
                                    setFailedDepotImages(previous => ({ ...previous, [imageKey]: true }))
                                  }}
                                />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-foreground truncate" title={item.name}>
                                {item.name}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {item.classifyType && (
                                  <Badge variant="outline">
                                    {getDepotTypeLabel(item.classifyType)}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="font-semibold">
                                  ×{item.count.toLocaleString()}
                                </Badge>
                              </div>
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
