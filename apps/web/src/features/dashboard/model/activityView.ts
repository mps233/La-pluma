import type { ActivitySummary } from './snapshot'

export type DashboardActivityPhase = 'loading' | 'active' | 'none' | 'unavailable' | 'stale'

export interface DashboardActivityItem {
  title: string
  detail: string
  rerun: boolean
}

export interface DashboardActivityView {
  phase: DashboardActivityPhase
  title: string
  duration: string
  detail: string
  meta: string
  activities?: DashboardActivityItem[]
}

export interface DashboardActivityViewInput {
  summary: ActivitySummary
  hasSnapshot: boolean
  isRefreshing: boolean
  lastRefreshFailed: boolean
  lastRefreshError: string | null
  lastUpdate: number | null
  formatTimestamp?: (timestamp: number) => string
}

const CLIENT_LABELS: Readonly<Record<string, string>> = {
  Official: '官服',
  Bilibili: 'B服',
  YoStarEN: '美服',
  YoStarJP: '日服',
  YoStarKR: '韩服',
  Txwy: '繁中服',
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  maa: 'MAA 活动表',
  penguin: '企鹅物流',
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const formatDefaultTimestamp = (timestamp: number): string => TIMESTAMP_FORMATTER.format(timestamp)

const formatWindow = (
  startTime: number | undefined,
  endTime: number | undefined,
  formatTimestamp: (timestamp: number) => string,
): string => {
  if (startTime !== undefined && endTime !== undefined) {
    return `${formatTimestamp(startTime)} ~ ${formatTimestamp(endTime)}`
  }
  if (startTime !== undefined) return `开始 ${formatTimestamp(startTime)}`
  if (endTime !== undefined) return `结束 ${formatTimestamp(endTime)}`
  return ''
}

const formatStageCount = (stageCount: number): string => (
  stageCount ? `${stageCount} 个关卡` : ''
)

const formatActivityTraits = (rerun: boolean, stageCount: number): string => joinParts(
  rerun ? '复刻' : '',
  formatStageCount(stageCount),
)

const formatActivityDetail = (
  rerun: boolean,
  startTime: number | undefined,
  endTime: number | undefined,
  stageCount: number,
  formatTimestamp: (timestamp: number) => string,
): string => joinParts(
  rerun ? '复刻' : '',
  formatWindow(startTime, endTime, formatTimestamp),
  formatStageCount(stageCount),
)

const buildActivityItems = (
  summary: ActivitySummary,
  formatTimestamp: (timestamp: number) => string,
): DashboardActivityItem[] => (summary.activities ?? []).map(activity => ({
  title: activity.name || activity.code || '当前活动',
  detail: formatActivityDetail(
    activity.rerun,
    activity.startTime ?? undefined,
    activity.endTime ?? undefined,
    activity.stages.length,
    formatTimestamp,
  ),
  rerun: activity.rerun,
}))

const joinParts = (...values: Array<string | null | undefined>): string => (
  values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ')
)

const readOrigin = (summary: ActivitySummary): string => {
  const clientLabel = summary.clientType
    ? CLIENT_LABELS[summary.clientType] ?? summary.clientType
    : ''
  const sourceLabel = summary.source
    ? SOURCE_LABELS[summary.source] ?? summary.source
    : ''
  return joinParts(clientLabel, sourceLabel)
}

/**
 * 把快照与刷新状态投影为卡片视图。
 *
 * `lastRefreshFailed` 只影响“数据是否仍然可信”：没有旧快照时是首轮失败，
 * 有快照时把 none/active 降为 stale；`unavailable` 与服务端 `stale` 保留
 * 各自的原因。
 */
export function buildDashboardActivityView(
  input: DashboardActivityViewInput,
): DashboardActivityView {
  const { summary, hasSnapshot, isRefreshing, lastRefreshFailed, lastRefreshError, lastUpdate } = input
  const formatTimestamp = input.formatTimestamp ?? formatDefaultTimestamp
  const activityItems = buildActivityItems(summary, formatTimestamp)
  const activityTraits = formatActivityTraits(
    summary.rerun ?? false,
    summary.stages?.length ?? 0,
  )
  const activityDuration = formatWindow(summary.startTime, summary.endTime, formatTimestamp)
  const multiActivityItems = activityItems.length > 1 ? activityItems : undefined
  const origin = readOrigin(summary)
  const updatedAt = summary.dataUpdatedAt !== undefined ? formatTimestamp(summary.dataUpdatedAt) : ''
  const lastSuccessAt = summary.lastSuccessAt ?? lastUpdate
  const lastSuccessText = lastSuccessAt !== null ? `上次成功 ${formatTimestamp(lastSuccessAt)}` : ''
  const lastUpdateText = lastUpdate !== null ? `上次成功 ${formatTimestamp(lastUpdate)}` : ''

  if (!hasSnapshot) {
    if (isRefreshing) {
      return {
        phase: 'loading',
        title: '正在获取活动信息',
        duration: '',
        detail: '',
        meta: '',
      }
    }
    if (lastRefreshFailed) {
      return {
        phase: 'unavailable',
        title: '活动数据加载失败',
        duration: '',
        detail: lastRefreshError || '无法获取活动信息',
        meta: '',
      }
    }
    return {
      phase: 'unavailable',
      title: '无法获取活动信息',
      duration: '',
      detail: lastRefreshError || '尚未获取活动信息',
      meta: '',
    }
  }

  if (summary.status === undefined) {
    if (lastRefreshFailed) {
      return {
        phase: 'stale',
        title: '活动信息可能已过期',
        duration: activityDuration,
        detail: lastRefreshError || '最近一次刷新失败',
        meta: joinParts(origin, lastUpdateText),
      }
    }
    return {
      phase: 'loading',
      title: '正在获取活动信息',
      duration: '',
      detail: '',
      meta: '',
    }
  }

  if (summary.status === 'unavailable') {
    return {
      phase: 'unavailable',
      title: '无法获取活动信息',
      duration: '',
      detail: summary.failure?.message || summary.message || '未知原因',
      meta: lastUpdateText,
    }
  }

  if (summary.status === 'stale' || lastRefreshFailed) {
    const title = summary.status !== 'none' && (summary.name || summary.code)
      ? (summary.name || summary.code) as string
      : '活动信息可能已过期'
    const detail = lastRefreshFailed
      ? (lastRefreshError || '最近一次刷新失败')
      : (summary.failure?.message || summary.message || '最近一次刷新失败')
    return {
      phase: 'stale',
      title,
      duration: activityDuration,
      detail,
      meta: joinParts(origin, lastRefreshFailed ? lastUpdateText : lastSuccessText, activityTraits),
      activities: multiActivityItems,
    }
  }

  if (summary.status === 'none') {
    return {
      phase: 'none',
      title: '暂无当前刷关活动',
      duration: '',
      detail: joinParts(origin, updatedAt ? `更新于 ${updatedAt}` : ''),
      meta: '',
    }
  }

  return {
    phase: 'active',
    title: summary.name || summary.code || '当前活动',
    duration: activityDuration,
    detail: joinParts(origin, updatedAt ? `更新于 ${updatedAt}` : '', activityTraits),
    meta: '',
    activities: multiActivityItems,
  }
}
