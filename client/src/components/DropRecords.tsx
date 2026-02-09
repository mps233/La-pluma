import { motion } from 'framer-motion'
import Icons from './Icons'
import type { DropRecordsProps } from '@/types/components'

export default function DropRecords({ dropStatistics, dropDays, setDropDays, onRefresh }: DropRecordsProps) {
  if (!dropStatistics) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="border rounded-3xl p-6 border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
      >
        <div className="text-center py-12">
          <Icons.TrendingUp className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400">暂无掉落记录</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            执行作战任务后会自动记录掉落数据
          </p>
        </div>
      </motion.div>
    )
  }

  const { total, items, stages, dateRange } = dropStatistics

  // 按掉落数量排序物品
  const sortedItems = Object.entries(items).sort((a, b) => b[1].count - a[1].count)
  
  // 按战斗次数排序关卡
  const sortedStages = Object.entries(stages).sort((a, b) => b[1].battles - a[1].battles)

  return (
    <div className="space-y-6">
      {/* 顶部统计卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <div className="p-4 bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-2xl border border-cyan-200 dark:border-cyan-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-cyan-600 dark:text-cyan-400">总理智消耗</p>
            <Icons.Zap className="w-4 h-4 text-cyan-500" />
          </div>
          <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-300">
            {total.sanity.toLocaleString()}
          </p>
        </div>

        <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-2xl border border-purple-200 dark:border-purple-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-purple-600 dark:text-purple-400">战斗次数</p>
            {/* @ts-ignore - Icons component className */}
            <Icons.Target className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-300">
            {total.battles.toLocaleString()}
          </p>
        </div>

        <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200 dark:border-green-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-green-600 dark:text-green-400">理智药</p>
            {/* @ts-ignore - Icons component className */}
            <Icons.Package className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-2xl font-bold text-green-900 dark:text-green-300">
            {total.medicine}
          </p>
        </div>

        <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-2xl border border-amber-200 dark:border-amber-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">源石</p>
            <Icons.Star className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-300">
            {total.stone}
          </p>
        </div>
      </motion.div>

      {/* 天数选择器 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">统计周期:</span>
          <div className="flex items-center space-x-1">
            {[3, 7, 14, 30].map((days) => (
              <button
                key={days}
                onClick={() => setDropDays(days)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                  dropDays === days
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>
        
        <button
          onClick={onRefresh}
          className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
        >
          <Icons.RefreshCw className="w-4 h-4" />
          <span>刷新</span>
        </button>
      </motion.div>

      {/* 材料掉落统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="border rounded-3xl p-6 border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
          {/* @ts-ignore - Icons component className */}
          <Icons.Package className="w-5 h-5 text-cyan-500" />
          <span>材料掉落统计</span>
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
            (共 {sortedItems.length} 种)
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sortedItems.slice(0, 20).map(([itemName, itemData], idx) => (
            <motion.div
              key={itemName}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.02 }}
              className="group flex items-center gap-3 p-3 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-2xl border border-violet-200 dark:border-violet-500/20 hover:border-violet-400 dark:hover:border-violet-500/40 hover:shadow-lg transition-all"
            >
              {/* 物品图标 */}
              {itemData.iconId && (
                <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 flex items-center justify-center">
                  <img
                    src={`/api/maa/item-icon/${itemData.iconId}`}
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
                <div className="text-sm font-bold text-gray-900 dark:text-white truncate" title={itemName}>
                  {itemName}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full font-semibold text-xs whitespace-nowrap">
                    ×{itemData.count.toLocaleString()}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {sortedItems.length > 20 && (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            仅显示前 20 种材料
          </p>
        )}
      </motion.div>

      {/* 关卡统计 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="border rounded-3xl p-6 border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
          {/* @ts-ignore - Icons component className */}
          <Icons.Target className="w-5 h-5 text-cyan-500" />
          <span>关卡统计</span>
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
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
              className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-2xl border border-cyan-200 dark:border-cyan-500/20"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-cyan-900 dark:text-cyan-300">
                    {stageName}
                  </span>
                  <span className="px-2 py-0.5 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full text-xs font-medium">
                    {stageData.battles} 次
                  </span>
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
                    {stageData.sanity} 理智
                  </span>
                </div>
              </div>

              {/* 掉落物品 */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(stageData.items).map(([itemName, count]) => (
                  <span
                    key={itemName}
                    className="px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs border border-gray-200 dark:border-gray-700"
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
        <div className="text-center text-sm text-gray-500 dark:text-gray-400">
          统计时间: {dateRange.start} 至 {dateRange.end} (共 {dateRange.days} 天)
        </div>
      )}
    </div>
  )
}
