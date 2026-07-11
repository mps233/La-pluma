import { motion } from 'framer-motion'
import Icons from './Icons'
import { getItemIconUrl } from '../services/api'
import type { DropRecordsProps } from '@/types/components'
import { Button, Card, EmptyState } from './common'

export default function DropRecords({ dropStatistics, dropDays, setDropDays, onRefresh }: DropRecordsProps) {
  if (!dropStatistics) {
    return (
      <Card animated className="surface-soft">
        <EmptyState
          className="py-12"
          icon={<Icons.TrendingUp className="h-8 w-8" />}
          title="暂无掉落记录"
          description="执行作战任务后会自动记录掉落数据"
        />
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
      {/* 顶部统计卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="app-grid-card grid-cols-2 md:grid-cols-4"
      >
        {metricCards.map((metric) => (
          <div key={metric.label} className="surface-soft rounded-2xl border border-[var(--app-border)] p-4">
            <div className="mb-2 flex items-center justify-between text-secondary">
              <p className="text-xs">{metric.label}</p>
              <span className="brand-text">{metric.icon}</span>
            </div>
            <p className="text-2xl font-bold text-primary">{metric.value}</p>
          </div>
        ))}
      </motion.div>

      {/* 天数选择器 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-2">
          <span className="text-sm text-secondary">统计周期:</span>
          <div className="flex items-center space-x-1">
            {[3, 7, 14, 30].map((days) => (
              <button
                key={days}
                onClick={() => setDropDays(days)}
                className={`rounded-lg px-3 py-1 text-sm font-medium transition-all ${
                  dropDays === days
                    ? 'brand-action'
                    : 'control-surface text-secondary'
                }`}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>
        
        <Button variant="secondary" size="sm" onClick={onRefresh} icon={<Icons.RefreshCw className="h-4 w-4" />}>
          刷新
        </Button>
      </motion.div>

      {/* 材料掉落统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="app-card surface-panel"
      >
        <h3 className="mb-4 flex items-center space-x-2 text-lg font-bold text-primary">
          <Icons.Package />
          <span>材料掉落统计</span>
          <span className="text-sm font-normal text-secondary">
            (共 {sortedItems.length} 种)
          </span>
        </h3>

        <div className="app-grid-card grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {sortedItems.slice(0, 20).map(([itemName, itemData], idx) => (
            <motion.div
              key={itemName}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.02 }}
              className="group flex items-center gap-3 rounded-2xl border border-[var(--app-border)] p-3 surface-soft transition-all hover:border-[var(--app-accent)] hover:shadow-lg"
            >
              {/* 物品图标 */}
              {itemData.iconId && (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl surface-soft">
                  <img
                    src={getItemIconUrl(itemData.iconId)}
                    alt={itemName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
              )}
              
              {/* 物品信息 */}
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-bold text-primary" title={itemName}>
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

        {sortedItems.length > 20 && (
          <p className="mt-4 text-center text-sm text-secondary">
            仅显示前 20 种材料
          </p>
        )}
      </motion.div>

      {/* 关卡统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="app-card surface-panel"
      >
        <h3 className="mb-4 flex items-center space-x-2 text-lg font-bold text-primary">
          <Icons.Target />
          <span>关卡统计</span>
          <span className="text-sm font-normal text-secondary">
            (共 {sortedStages.length} 个关卡)
          </span>
        </h3>

        <div className="space-y-3">
          {sortedStages.map(([stageName, stageData], idx) => (
            <motion.div
              key={stageName}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="rounded-2xl border border-[var(--app-border)] p-4 surface-soft"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-primary">
                    {stageName}
                  </span>
                  <span className="brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                    {stageData.battles} 次
                  </span>
                  <span className="brand-chip rounded-full px-2 py-0.5 text-xs font-medium">
                    {stageData.sanity} 理智
                  </span>
                </div>
              </div>

              {/* 掉落物品 */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(stageData.items).map(([itemName, count]) => (
                  <span
                    key={itemName}
                    className="rounded-lg border border-[var(--app-border)] px-2 py-1 text-xs text-secondary control-surface"
                  >
                    {itemName} ×{count}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* 日期范围提示 */}
      {dateRange.start && dateRange.end && (
        <div className="text-center text-sm text-secondary">
          统计时间: {dateRange.start} 至 {dateRange.end} (共 {dateRange.days} 天)
        </div>
      )}
    </div>
  )
}
