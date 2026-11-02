import type { ActivitySummary } from '../store/dashboardStore'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 活动卡的副标题。只依据接口已返回的事实生成，避免在活动已加载时
 * 继续展示“等待活动数据”这样的加载占位。
 */
export function formatActivitySubtitle(
  summary: ActivitySummary | undefined,
  now = Date.now(),
): string {
  if (!summary?.available) return '等待活动数据'

  const { endTime, completion } = summary
  if (typeof endTime === 'number' && Number.isFinite(endTime)) {
    const remaining = endTime - now
    if (remaining <= 0) return '活动已结束'
    if (remaining < DAY_MS) return '不足 1 天'
    return `剩余 ${Math.ceil(remaining / DAY_MS)} 天`
  }

  if (
    completion?.known === true
    && typeof completion.totalStages === 'number'
    && completion.totalStages > 0
  ) {
    const completedCount = Array.isArray(completion.completedStages)
      ? completion.completedStages.length
      : 0
    const completed = Math.min(Math.max(completedCount, 0), completion.totalStages)
    return `已通关 ${completed}/${completion.totalStages} 关`
  }

  return '活动进行中'
}
