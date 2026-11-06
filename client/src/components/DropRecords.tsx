import { useState } from 'react'
import { Package as PackageIcon, RefreshCw, Target, TrendingUp } from 'lucide-react'
import { getItemIconUrl } from '../services/api'
import { useItemIconCacheVersion } from '../hooks/useItemIconCacheVersion'
import type { DropRecordsProps } from '@/types/components'
import { Button, Card, EmptyState, Loading, CjkText } from './common'
import { keepNumberWithUnit } from '../utils/typography'
import StatisticsSummary from './StatisticsSummary'

interface DropRecordsViewProps extends DropRecordsProps {
  isLoading?: boolean
  error?: string | null
}

interface DropRecordsErrorProps {
  description: string
  onRetry: () => void
}

function DropRecordsError({ description, onRetry }: DropRecordsErrorProps) {
  return (
    <Card smoothCorners className="drop-records-panel !p-0">
      <div className="drop-records-panel-content">
        <div className="form-error-surface flex flex-col items-start gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="min-w-0">
            <p className="font-semibold text-primary">掉落记录读取失败</p>
            <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere] form-error-text">{description}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            className="w-full sm:w-auto"
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            重新加载
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default function DropRecords({
  dropStatistics,
  dropDays,
  setDropDays,
  onRefresh,
  isLoading = false,
  error = null,
}: DropRecordsViewProps) {
  useItemIconCacheVersion()
  const [failedItemImages, setFailedItemImages] = useState<Record<string, boolean>>({})

  if (isLoading && !dropStatistics && !error) {
    return (
      <Card smoothCorners className="drop-records-panel !p-0">
        <div className="drop-records-panel-content py-12">
          <Loading text="正在读取掉落记录..." />
        </div>
      </Card>
    )
  }

  if (error && !dropStatistics) {
    return <DropRecordsError description={error} onRetry={onRefresh} />
  }

  if (!dropStatistics) {
    return (
      <Card smoothCorners className="drop-records-panel !p-0">
        <div className="drop-records-panel-content">
          <EmptyState
            className="py-12"
            icon={<TrendingUp className="h-8 w-8" strokeWidth={1.6} aria-hidden="true" />}
            title="暂无掉落记录"
            description="执行作战任务后会自动记录掉落数据"
            action={(
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                重新加载
              </Button>
            )}
          />
        </div>
      </Card>
    )
  }

  const { total, items, stages, dateRange } = dropStatistics

  // 按掉落数量排序物品
  const sortedItems = Object.entries(items).sort((a, b) => b[1].count - a[1].count)
  
  // 按战斗次数排序关卡
  const sortedStages = Object.entries(stages).sort((a, b) => b[1].battles - a[1].battles)
  const averageSanity = total.battles > 0
    ? Math.round(total.sanity / total.battles)
    : null
  const summaryStats = [
    { label: '战斗次数', value: total.battles.toLocaleString(), unit: '次', muted: total.battles === 0 },
    { label: '理智药', value: total.medicine.toLocaleString(), unit: '瓶', muted: total.medicine === 0 },
    { label: '源石', value: total.stone.toLocaleString(), unit: '颗', muted: total.stone === 0 },
  ]
  const dateRangeLabel = dateRange.start && dateRange.end
    ? `${dateRange.start} 至 ${dateRange.end}`
    : null

  return (
    <div className="app-stack-section">
      {error && (
        <div className="form-error-surface flex flex-col items-start gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="min-w-0">
            <p className="font-semibold text-primary">掉落记录刷新失败</p>
            <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere] form-error-text">{error}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            className="w-full sm:w-auto"
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            重新加载
          </Button>
        </div>
      )}

      <Card smoothCorners className="drop-records-summary-card !p-0">
        <div className="drop-records-summary-content">
          <div className="drop-records-summary-header">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-primary"><CjkText>掉落记录</CjkText></h2>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                {keepNumberWithUnit(`统计最近 ${dropDays} 天`)}
              </p>
            </div>
            <div className="drop-records-summary-actions">
              <div className="drop-records-period" role="group" aria-label="统计周期">
                {[3, 7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setDropDays(days)}
                    aria-pressed={dropDays === days}
                    aria-label={`统计最近 ${days} 天`}
                    className={`drop-records-period-button${dropDays === days ? ' is-selected' : ''}`}
                  >
                    {days}天
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={isLoading}
                loadingText="正在刷新..."
                onClick={onRefresh}
                className="w-full sm:w-auto"
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                刷新
              </Button>
            </div>
          </div>

          <StatisticsSummary
            ariaLabel="掉落记录统计概览"
            primary={{
              label: '总理智消耗',
              value: total.sanity.toLocaleString(),
              detail: averageSanity !== null
                ? keepNumberWithUnit(`平均每场 ${averageSanity.toLocaleString()} 理智`)
                : '本周期暂无战斗记录',
            }}
            stats={summaryStats}
            meta={dateRangeLabel
              ? [{ label: '统计范围', value: dateRangeLabel }]
              : undefined}
          />
        </div>
      </Card>

      {/* 材料掉落统计 */}
      <div className="min-w-0">
        <Card smoothCorners className="drop-records-panel !p-0">
          <div className="drop-records-panel-content">
        <h3 className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold text-primary">
          <PackageIcon className="h-4 w-4 flex-none self-center text-tertiary" strokeWidth={1.9} aria-hidden="true" />
          <span className="min-w-0"><CjkText>材料掉落统计</CjkText></span>
          <span className="text-sm font-normal text-tertiary">共 {keepNumberWithUnit(`${sortedItems.length} 种`)}</span>
        </h3>

        {sortedItems.length === 0 ? (
          <EmptyState
            compact
            className="py-8"
            icon={<PackageIcon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}
            title="本周期没有材料掉落"
            description="切换统计周期或完成作战后再查看。"
          />
        ) : (
        <div className="drop-records-item-grid grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {sortedItems.slice(0, 20).map(([itemName, itemData]) => (
            <div
              key={itemName}
              className="drop-records-item-row flex min-w-0 items-center gap-3 p-3"
            >
              {/* 物品图标 */}
              {itemData.iconId && (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-surface-muted)]">
                  {failedItemImages[itemName] ? (
                    <span role="img" aria-label={`${itemName}图标不可用`}>
                      <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                    </span>
                  ) : (
                    <img
                      src={getItemIconUrl(itemData.iconId)}
                      alt={itemName}
                      className="maa-item-icon h-full w-full object-cover"
                      onError={() => setFailedItemImages(previous => ({ ...previous, [itemName]: true }))}
                    />
                  )}
                </div>
              )}

              {/* 物品信息 */}
              <div className="flex-1 min-w-0">
                <div className="break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]" title={itemName}>
                  {itemName}
                </div>
                <div className="mt-1 text-xs font-medium tabular-nums text-secondary">
                  ×{itemData.count.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
        )}

        {sortedItems.length > 20 && (
          <p className="mt-3 text-center text-xs text-tertiary">
            仅显示前 20{'\u00A0'}种材料
          </p>
        )}
          </div>
        </Card>
      </div>

      {/* 关卡统计 */}
      <div className="min-w-0">
        <Card smoothCorners className="drop-records-panel !p-0">
          <div className="drop-records-panel-content">
        <h3 className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold text-primary">
          <Target className="h-4 w-4 flex-none self-center text-tertiary" strokeWidth={1.9} aria-hidden="true" />
          <span className="min-w-0"><CjkText>关卡统计</CjkText></span>
          <span className="text-sm font-normal text-tertiary">共 {keepNumberWithUnit(`${sortedStages.length} 个关卡`)}</span>
        </h3>

        {sortedStages.length === 0 ? (
          <EmptyState
            compact
            className="py-8"
            icon={<Target className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}
            title="本周期没有关卡记录"
            description="切换统计周期或完成作战后再查看。"
          />
        ) : (
        <div className="drop-records-stage-list flex min-w-0 flex-col gap-3">
          {sortedStages.map(([stageName, stageData]) => (
            <div
              key={stageName}
              className="drop-records-stage-row min-w-0 p-4"
            >
              <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 break-words text-base font-semibold text-primary [overflow-wrap:anywhere]">
                  {stageName}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 text-xs text-secondary">
                  <span className="tabular-nums">{keepNumberWithUnit(`${stageData.battles} 次`)}</span>
                  <span className="text-tertiary" aria-hidden="true">·</span>
                  <span className="tabular-nums text-tertiary">{keepNumberWithUnit(`${stageData.sanity} 理智`)}</span>
                </span>
              </div>

              {/* 掉落物品 */}
              <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {Object.entries(stageData.items).length === 0 && (
                  <span className="text-sm text-tertiary">没有记录到掉落物</span>
                )}
                {Object.entries(stageData.items).map(([itemName, count]) => (
                  <span
                    key={itemName}
                    className="max-w-full break-words whitespace-normal text-xs text-secondary [overflow-wrap:anywhere]"
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
    </div>
  )
}
