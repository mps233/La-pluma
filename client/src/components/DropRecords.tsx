import { useState } from 'react'
import { motion } from 'framer-motion'
import { Package as PackageIcon } from 'lucide-react'
import Icons from './Icons'
import { getItemIconUrl } from '../services/api'
import type { DropRecordsProps } from '@/types/components'
import { Button, Card, EmptyState, Loading } from './common'

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
    <Card animated smoothCorners className="drop-records-panel !p-0">
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
            icon={<Icons.RefreshCw className="h-4 w-4" />}
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
  const [failedItemImages, setFailedItemImages] = useState<Record<string, boolean>>({})

  if (isLoading && !dropStatistics && !error) {
    return (
      <Card animated smoothCorners className="drop-records-panel !p-0">
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
      <Card animated smoothCorners className="drop-records-panel !p-0">
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
                icon={<Icons.RefreshCw className="h-4 w-4" />}
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
  const metricCards = [
    { label: '总理智消耗', value: total.sanity.toLocaleString(), icon: <Icons.Zap className="h-4 w-4" /> },
    { label: '战斗次数', value: total.battles.toLocaleString(), icon: <Icons.Crosshair /> },
    { label: '理智药', value: total.medicine, icon: <Icons.Clipboard /> },
    { label: '源石', value: total.stone, icon: <Icons.Star className="h-4 w-4" /> },
  ]

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
            icon={<Icons.RefreshCw className="h-4 w-4" />}
          >
            重新加载
          </Button>
        </div>
      )}

      {/* 顶部统计卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="app-grid-card grid-cols-2 md:grid-cols-4"
      >
        {metricCards.map((metric) => (
          <div key={metric.label} className="min-w-0 surface-soft app-info-card">
            <div className="mb-2 flex items-center justify-between text-secondary">
              <p className="text-xs">{metric.label}</p>
              <span className="brand-text">{metric.icon}</span>
            </div>
            <p
              className="break-words text-xl font-bold text-primary [overflow-wrap:anywhere] sm:text-2xl"
              title={String(metric.value)}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </motion.div>

      {/* 天数选择器 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-secondary">统计周期</span>
          <div className="grid w-full grid-cols-4 gap-1 sm:inline-grid sm:w-auto" role="group" aria-label="统计周期">
            {[3, 7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setDropDays(days)}
                aria-pressed={dropDays === days}
                aria-label={`统计最近 ${days} 天`}
                className={`app-native-button min-h-11 min-w-0 w-full px-2 text-sm font-medium ${
                  dropDays === days
                    ? 'app-native-button-primary'
                    : ''
                }`}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>
        
        <Button
          variant="secondary"
          size="sm"
          loading={isLoading}
          loadingText="正在刷新..."
          onClick={onRefresh}
          className="w-full sm:w-auto"
          icon={<Icons.RefreshCw className="h-4 w-4" />}
        >
          刷新
        </Button>
      </motion.div>

      {/* 材料掉落统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="min-w-0"
      >
        <Card smoothCorners className="drop-records-panel !p-0">
          <div className="drop-records-panel-content">
        <h3 className="mb-4 flex min-w-0 flex-wrap items-center gap-2 text-lg font-bold text-primary">
          <span className="shrink-0"><Icons.Package /></span>
          <span className="min-w-0">材料掉落统计</span>
          <span className="break-words text-sm font-normal text-secondary [overflow-wrap:anywhere]">
            (共 {sortedItems.length} 种)
          </span>
        </h3>

        {sortedItems.length === 0 ? (
          <EmptyState
            compact
            className="py-8"
            icon={<Icons.Package />}
            title="本周期没有材料掉落"
            description="切换统计周期或完成作战后再查看。"
          />
        ) : (
        <div className="app-grid-card min-w-0 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {sortedItems.slice(0, 20).map(([itemName, itemData], idx) => (
            <motion.div
              key={itemName}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.02 }}
              className="group surface-soft app-info-card flex min-w-0 items-center gap-3 p-3 transition-colors hover:border-[color-mix(in_srgb,var(--app-accent)_42%,var(--app-border))] hover:bg-[var(--app-accent-soft)]"
            >
              {/* 物品图标 */}
              {itemData.iconId && (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl surface-soft">
                  {failedItemImages[itemName] ? (
                    <span role="img" aria-label={`${itemName}图标不可用`}>
                      <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                    </span>
                  ) : (
                    <img
                      src={getItemIconUrl(itemData.iconId)}
                      alt={itemName}
                      className="h-full w-full object-cover"
                      onError={() => setFailedItemImages(previous => ({ ...previous, [itemName]: true }))}
                    />
                  )}
                </div>
              )}
              
              {/* 物品信息 */}
              <div className="flex-1 min-w-0">
                <div className="break-words text-sm font-bold text-primary [overflow-wrap:anywhere]" title={itemName}>
                  {itemName}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="brand-chip rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap">
                    ×{itemData.count.toLocaleString()}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        )}

        {sortedItems.length > 20 && (
          <p className="mt-4 text-center text-sm text-secondary">
            仅显示前 20 种材料
          </p>
        )}
          </div>
        </Card>
      </motion.div>

      {/* 关卡统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="min-w-0"
      >
        <Card smoothCorners className="drop-records-panel !p-0">
          <div className="drop-records-panel-content">
        <h3 className="mb-4 flex min-w-0 flex-wrap items-center gap-2 text-lg font-bold text-primary">
          <span className="shrink-0"><Icons.Target /></span>
          <span className="min-w-0">关卡统计</span>
          <span className="break-words text-sm font-normal text-secondary [overflow-wrap:anywhere]">
            (共 {sortedStages.length} 个关卡)
          </span>
        </h3>

        {sortedStages.length === 0 ? (
          <EmptyState
            compact
            className="py-8"
            icon={<Icons.Target />}
            title="本周期没有关卡记录"
            description="切换统计周期或完成作战后再查看。"
          />
        ) : (
        <div className="min-w-0 space-y-3">
          {sortedStages.map(([stageName, stageData], idx) => (
            <motion.div
              key={stageName}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="min-w-0 surface-soft app-info-card"
            >
              <div className="mb-3 min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-lg font-bold text-primary [overflow-wrap:anywhere]">
                    {stageName}
                  </span>
                  <span className="shrink-0 whitespace-nowrap brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                    {stageData.battles} 次
                  </span>
                  <span className="shrink-0 whitespace-nowrap brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                    {stageData.sanity} 理智
                  </span>
                </div>
              </div>

              {/* 掉落物品 */}
              <div className="flex min-w-0 flex-wrap gap-2">
                {Object.entries(stageData.items).length === 0 && (
                  <span className="text-sm text-tertiary">没有记录到掉落物</span>
                )}
                {Object.entries(stageData.items).map(([itemName, count]) => (
                  <span
                    key={itemName}
                    className="max-w-full break-words whitespace-normal control-surface rounded-[var(--app-radius-sm)] px-2 py-1 text-xs text-secondary [overflow-wrap:anywhere]"
                  >
                    {itemName} ×{count}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
        )}
          </div>
        </Card>
      </motion.div>

      {/* 日期范围提示 */}
      {dateRange.start && dateRange.end && (
        <div className="break-words text-center text-sm text-secondary [overflow-wrap:anywhere]">
          统计时间: {dateRange.start} 至 {dateRange.end} (共 {dateRange.days} 天)
        </div>
      )}
    </div>
  )
}
