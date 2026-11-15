import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  depotQueryOptions,
  getItemIconUrl,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { motion, useReducedMotion } from 'framer-motion'
import { LoaderCircle, Package as PackageIcon, Play } from 'lucide-react'
import Icons from '@/shared/components/Icons'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { EmptyState, Loading } from '@/shared/components'
import { getDepotTypeLabel, summarizeDepot } from '../model/depotSummary'
import InlineDataError from './InlineDataError'
import type { StatisticsCommands } from '../hooks/useStatisticsCommands'

const DEPOT_READ_ERROR = '暂时无法读取仓库数据，请检查服务连接后重试。'

const taskPanelClass = (isActive: boolean) =>
  `data-statistics-task-card gap-0 p-0! transition-colors${isActive ? ' bg-info/5 ring-info/30' : ''}`

const statCardClass = 'data-statistics-kpi'
const chipClass = 'control-surface rounded-full px-2 py-0.5 text-xs whitespace-nowrap'

interface DepotPanelProps {
  isActive: boolean
  command: StatisticsCommands
}

export default function DepotPanel({ isActive, command }: DepotPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  // 资源更新成功后推进，使同一图标的 `<img src>` 换到新的浏览器缓存身份。
  const itemIconVersion = useItemIconCacheVersion()
  const depotQuery = useQuery(depotQueryOptions())
  const [failedDepotImages, setFailedDepotImages] = useState<Record<string, boolean>>({})

  const depotData = depotQuery.data ?? null
  const depotDataLoading = depotQuery.isPending
  const depotDataRefreshing = depotQuery.isFetching
  const depotDataError = depotQuery.isError ? DEPOT_READ_ERROR : null
  const overview = useMemo(() => summarizeDepot(depotData), [depotData])

  if (!isActive) return null

  const isRecognizing = command.activeKind === 'depot' && command.isRunning

  return (
    <motion.div
      id="data-statistics-panel-depot"
      role="tabpanel"
      aria-labelledby="data-statistics-tab-depot"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
      className="min-w-0"
    >
      <Card
        className={taskPanelClass(command.activeTask === 'depot')}
      >
        <div className="data-statistics-task-content app-stack-card">
          <div className="data-statistics-task-header flex items-start gap-3.5 sm:items-center">
            <div className="flex w-full min-w-0 flex-1 items-center gap-3.5 sm:w-auto">
              <div className="flex h-10 w-10 flex-none items-center justify-center" aria-hidden="true">
                <Icons.Package />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">仓库识别</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  汇总物品库存、材料分类与数量
                </p>
              </div>
            </div>

            <div className="data-statistics-task-actions shrink-0">
              <Button
                onClick={() => command.startRecognition('depot')}
                disabled={command.isRunning || isRecognizing}
                aria-busy={isRecognizing || undefined}
              >
                {isRecognizing
                  ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在执行</>
                  : (
                    <>
                      <Play size={15} fill="currentColor" aria-hidden="true" />
                      {command.actionLabel('depot')}
                    </>
                  )}
              </Button>
            </div>
          </div>

          {!depotDataError && !depotData && (depotDataLoading || command.activeTask === 'depot') && (
            <div className="rounded-xl py-12 surface-soft" aria-live="polite">
              <Loading text={command.activeTask === 'depot' ? '正在识别仓库数据' : '正在读取仓库数据'} />
            </div>
          )}
          {depotDataError && (
            <InlineDataError
              title="仓库数据读取失败"
              description={depotDataError}
              isRetrying={depotDataRefreshing}
              onRetry={() => {
                void depotQuery.refetch()
              }}
            />
          )}
          {!depotDataLoading && !depotDataError && !command.isRunning && !depotData && (
            <EmptyState
              compact
              className="py-10"
              icon={<Icons.Package />}
              title="还没有仓库识别结果"
              description="完成一次仓库识别后，物品清单会显示在这里。"
            />
          )}
          {depotData && (
            <div className="app-stack-card">
              <div
                className="data-statistics-kpi-grid grid grid-cols-2 md:grid-cols-3"
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
                <div className={statCardClass}>
                  <p className="text-xs text-muted-foreground">库存最多</p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                    {overview.topItem?.name ?? '-'}
                  </p>
                </div>
                {depotData.timestamp && (
                  <div className={statCardClass}>
                    <p className="text-xs text-muted-foreground">最近识别</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">
                      {new Date(depotData.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                )}
              </div>

              {overview.groups.length > 0 && (
                <section className="rounded-xl surface-soft p-3" aria-labelledby="depot-category-title">
                  <h3 id="depot-category-title" className="mb-2 text-sm font-semibold text-foreground">分类汇总</h3>
                  <div className="flex flex-wrap gap-2">
                    {overview.groups.map((group) => (
                      <div key={group.type} className="control-surface rounded-full px-3 py-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">{group.label}</span>
                        <span className="mx-1 brand-text">·</span>
                        <span>{group.kinds} 种</span>
                        <span className="mx-1 brand-text">/</span>
                        <span>{group.count.toLocaleString()} 件</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {depotData.items && depotData.items.length > 0 && (
                <div className="data-statistics-item-grid grid grid-cols-1 overflow-hidden rounded-xl surface-soft sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {depotData.items.map((item) => {
                    const itemKey = item.id || item.iconId
                    const imageKey = `${itemKey}:${item.iconId}`

                    return (
                      <div
                        key={itemKey}
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
                              <span className={chipClass}>
                                {getDepotTypeLabel(item.classifyType)}
                              </span>
                            )}
                            <span className={`${chipClass} font-semibold`}>
                              ×{item.count.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
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
