import { useState } from 'react'
import { LoaderCircle, Package as PackageIcon, Target } from 'lucide-react'
import type { FetchStatus } from '@tanstack/react-query'
import Icons from '@/shared/components/Icons'
import { EmptyState, Loading, SegmentedControl, type SegmentedControlOption } from '@/shared/components'
import { getItemIconUrl, useItemIconCacheVersion } from '@/features/game-data'
import { DROP_ITEM_DISPLAY_LIMIT, sortDropItems, sortDropStages } from '../model/dropRecords'
import type { DropRecordsProps } from '../types'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import StatisticsQueryError from './StatisticsQueryError'

const DROP_PERIOD_OPTIONS: readonly SegmentedControlOption<string>[] = [3, 7, 14, 30]
  .map(days => ({ value: String(days), label: `${days}天` }))

interface DropRecordsViewProps extends DropRecordsProps {
  isLoading?: boolean
  isPlaceholderData?: boolean
  fetchStatus?: FetchStatus
  error?: string | null
}

export default function DropRecords({
  dropStatistics,
  dropDays,
  setDropDays,
  onRefresh,
  isLoading = false,
  isPlaceholderData = false,
  fetchStatus = 'idle',
  error = null,
}: DropRecordsViewProps) {
  const itemIconVersion = useItemIconCacheVersion()
  const [failedItemImages, setFailedItemImages] = useState<Record<string, boolean>>({})
  const [failedItemImagesVersion, setFailedItemImagesVersion] = useState(itemIconVersion)

  if (failedItemImagesVersion !== itemIconVersion) {
    setFailedItemImagesVersion(itemIconVersion)
    setFailedItemImages({})
  }

  if (isLoading && !dropStatistics && !error) {
    return (
      <Card className="drop-records-panel gap-0 p-0!">
        <div className="drop-records-panel-content py-12">
          <Loading text="正在读取掉落记录..." />
        </div>
      </Card>
    )
  }

  if (error && !dropStatistics) {
    return (
      <Card className="drop-records-panel gap-0 p-0!">
        <div className="drop-records-panel-content">
          <StatisticsQueryError
            title="掉落记录读取失败"
            description={error}
            isRetrying={isLoading}
            onRetry={onRefresh}
          />
        </div>
      </Card>
    )
  }

  if (!dropStatistics) {
    return (
      <Card className="drop-records-panel gap-0 p-0!">
        <div className="drop-records-panel-content">
          <EmptyState
            className="py-12"
            icon={<Icons.TrendingUp className="h-8 w-8" />}
            title="暂无掉落记录"
            description="执行作战任务后会自动记录掉落数据"
            action={(
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
              >
                <Icons.RefreshCw className="h-4 w-4" aria-hidden="true" />
                重新加载
              </Button>
            )}
          />
        </div>
      </Card>
    )
  }

  const { total, items, stages, dateRange } = dropStatistics

  const sortedItems = sortDropItems(items)
  const sortedStages = sortDropStages(stages)
  const metricCards = [
    { label: '总理智消耗', value: total.sanity.toLocaleString() },
    { label: '战斗次数', value: total.battles.toLocaleString() },
    { label: '理智药', value: total.medicine.toLocaleString() },
    { label: '源石', value: total.stone.toLocaleString() },
  ]

  return (
    <div className="app-stack-section">
      <h2 className="text-lg font-semibold text-foreground">掉落记录</h2>
      {error && (
        <StatisticsQueryError
          title="掉落记录刷新失败"
          description={error}
          isRetrying={isLoading}
          onRetry={onRefresh}
        />
      )}

      <div className="drop-records-metric-panel grid grid-cols-2 overflow-hidden rounded-xl surface-soft md:grid-cols-4">
        {metricCards.map((metric) => (
          <div key={metric.label} className="drop-records-metric-row min-w-0 p-4">
            <p className="mb-2 text-xs text-muted-foreground">{metric.label}</p>
            <p
              className="wrap-break-word text-xl font-bold text-foreground wrap-anywhere sm:text-2xl"
              title={String(metric.value)}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-stretch justify-between gap-3.5 sm:flex-row sm:items-center" data-region="toolbar">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-muted-foreground">统计周期</span>
          <SegmentedControl
            ariaLabel="统计周期"
            value={String(dropDays)}
            options={DROP_PERIOD_OPTIONS}
            onChange={(value) => setDropDays(Number(value))}
            className="grid w-full grid-cols-4 sm:inline-flex sm:w-auto"
          />
          {fetchStatus === 'paused' && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
              等待网络恢复...
            </span>
          )}
          {isPlaceholderData && fetchStatus !== 'paused' && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              正在读取新周期...
            </span>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={isLoading}
          aria-busy={isLoading || undefined}
          onClick={onRefresh}
          className="w-full sm:w-auto"
        >
          {isLoading && !isPlaceholderData
            ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在刷新...</>
            : (
              <>
                <Icons.RefreshCw className="h-4 w-4" aria-hidden="true" />
                刷新
              </>
            )}
        </Button>
      </div>

      <div className="min-w-0">
        <Card className="drop-records-panel gap-0 p-0!">
          <div className="drop-records-panel-content">
            <h3 className="mb-4 text-lg font-bold text-foreground">材料掉落统计</h3>

            {sortedItems.length === 0 ? (
              <EmptyState
                compact
                className="py-8"
                icon={<PackageIcon size={24} strokeWidth={1.7} />}
                title="本周期没有材料掉落"
                description="切换统计周期或完成作战后再查看。"
              />
            ) : (
              <div className="drop-records-item-grid grid min-w-0 grid-cols-1 overflow-hidden rounded-xl surface-soft sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {sortedItems.slice(0, DROP_ITEM_DISPLAY_LIMIT).map((itemData) => {
                  const iconKey = itemData.id ?? itemData.iconId

                  return (
                    <div
                      key={itemData.name}
                      className="drop-records-item-row flex min-w-0 items-center gap-3.5 p-3"
                    >
                      {iconKey && (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                          {failedItemImages[itemData.name] ? (
                            <span role="img" aria-label={`${itemData.name}图标不可用`}>
                              <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                            </span>
                          ) : (
                            <img
                              src={getItemIconUrl(iconKey, itemIconVersion)}
                              alt={itemData.name}
                              className="h-full w-full object-cover"
                              onError={() => setFailedItemImages(previous => ({ ...previous, [itemData.name]: true }))}
                            />
                          )}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="wrap-break-word text-sm font-bold text-foreground wrap-anywhere" title={itemData.name}>
                          {itemData.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="brand-chip rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap">
                            ×{itemData.count.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {sortedItems.length > DROP_ITEM_DISPLAY_LIMIT && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                仅显示前 20 种材料
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="min-w-0">
        <Card className="drop-records-panel gap-0 p-0!">
          <div className="drop-records-panel-content">
            <h3 className="mb-4 text-lg font-bold text-foreground">关卡统计</h3>

            {sortedStages.length === 0 ? (
              <EmptyState
                compact
                className="py-8"
                icon={<Target size={24} strokeWidth={1.7} />}
                title="本周期没有关卡记录"
                description="切换统计周期或完成作战后再查看。"
              />
            ) : (
              <div className="drop-records-stage-list min-w-0 overflow-hidden rounded-xl surface-soft">
                {sortedStages.map((stageData) => (
                  <div
                    key={stageData.name}
                    className="drop-records-stage-row min-w-0 p-4"
                  >
                    <div className="mb-3 min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 wrap-break-word text-lg font-bold text-foreground wrap-anywhere">
                          {stageData.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                          {stageData.battles} 次
                        </span>
                        <span className="shrink-0 whitespace-nowrap brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                          {stageData.sanity} 理智
                        </span>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap gap-2">
                      {Object.entries(stageData.items).length === 0 && (
                        <span className="text-sm text-tertiary">没有记录到掉落物</span>
                      )}
                      {Object.entries(stageData.items).map(([itemName, count]) => (
                        <span
                          key={itemName}
                          className="max-w-full wrap-break-word whitespace-normal surface-soft rounded-md px-2 py-1 text-xs text-muted-foreground wrap-anywhere"
                        >
                          {itemName} ×{count}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {dateRange.start && dateRange.end && (
        <div className="wrap-break-word text-center text-sm text-muted-foreground wrap-anywhere">
          统计时间: {dateRange.start} 至 {dateRange.end} (共 {dateRange.days} 天)
        </div>
      )}
    </div>
  )
}
