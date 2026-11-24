import type { MasteryQueueItem, MasteryQueueStatus } from '../types/components'

export const MASTERY_ACTIVITY_ID = 'la-pluma-mastery'

interface MasteryProgress {
  value: number
  percent: number
  done: number
  total: number
}

type MasteryTone = 'running' | 'success' | 'warning' | 'paused' | 'neutral'

const ACTIVE_PHASES = new Set(['starting', 'running', 'training', 'verifying'])

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Overall confirmed-level progress for the whole campaign. A level counts only after the
 * server has observed AlreadySatisfied; a started-but-unconfirmed training does not.
 */
export function masteryProgressOf(status: MasteryQueueStatus | null): MasteryProgress {
  if (!status) return { value: 0, percent: 0, done: 0, total: 0 }

  let done = 0
  let total = 0
  for (const item of status.items) {
    if (!item.enabled || item.phase === 'skipped') continue
    const declared = clamp(item.declaredLevel, 0, item.targetLevel)
    const target = clamp(item.targetLevel, 1, 3)
    if (target <= declared) continue
    total += target - declared
    done += clamp(item.confirmedLevel - declared, 0, target - declared)
  }

  return {
    value: total > 0 ? done / total : 0,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    done,
    total
  }
}

export function masteryActiveItem(status: MasteryQueueStatus | null): MasteryQueueItem | null {
  if (!status) return null
  const active = status.activeItem
  if (active && active.phase !== 'completed' && active.phase !== 'skipped') return active
  return status.items.find(item =>
    item.enabled && (ACTIVE_PHASES.has(item.phase) || item.phase === 'queued' || item.phase === 'blocked')
  ) || null
}

export function masteryTone(status: MasteryQueueStatus | null): MasteryTone {
  const campaign = status?.campaign.status
  if (campaign === 'completed') return 'success'
  if (campaign === 'blocked' || campaign === 'interrupted') return 'warning'
  if (campaign === 'paused') return 'paused'
  if (campaign === 'running') return 'running'
  return 'neutral'
}

export function masteryTitle(status: MasteryQueueStatus | null): string {
  const item = masteryActiveItem(status)
  if (item) return `${item.operatorName} · ${item.skillName}`
  return '技能专精'
}

export function masteryStateText(status: MasteryQueueStatus | null): string {
  if (!status) return ''
  const campaign = status.campaign.status
  if (campaign === 'paused') return '已暂停'
  if (campaign === 'interrupted') return '待复核'
  if (campaign === 'blocked') return '受阻'
  if (campaign === 'completed') return '已完成'

  const item = masteryActiveItem(status)
  if (!item) return '等待目标'
  switch (item.phase) {
    case 'training':
      return `M${item.startedLevel ?? item.confirmedLevel + 1} 训练中`
    case 'starting':
      return `正在启动 M${item.confirmedLevel + 1}`
    case 'running':
      return `正在推进 M${item.confirmedLevel + 1}`
    case 'verifying':
      return `正在复核 M${item.confirmedLevel + 1}`
    case 'blocked':
      return item.blocked?.message || '目标受阻'
    case 'queued':
      return `等待执行 M${item.confirmedLevel + 1}`
    case 'completed':
      return '已完成'
    default:
      return '等待执行'
  }
}


export function masteryCampaignCounts(status: MasteryQueueStatus | null): string {
  if (!status) return ''
  const { queued, training, blocked, completed } = status.counts
  return `等待 ${queued} · 训练 ${training} · 受阻 ${blocked} · 完成 ${completed}`
}
