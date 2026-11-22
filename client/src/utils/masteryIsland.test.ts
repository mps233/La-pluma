import { describe, expect, it } from 'vitest'
import {
  MASTERY_ACTIVITY_ID,
  masteryActiveItem,
  masteryCampaignCounts,
  masteryProgressOf,
  masteryStateText,
  masteryTitle,
  masteryTone,
} from './masteryIsland'
import type { MasteryQueueItem, MasteryQueueStatus } from '@/types/components'

const item = (patch: Partial<MasteryQueueItem> = {}): MasteryQueueItem => ({
  id: 'char_test:1',
  operatorId: 'char_test',
  operatorName: '测试干员',
  role: 'Caster',
  skillIndex: 1,
  skillId: 'skchr_test_1',
  skillName: '测试技能一',
  targetLevel: 3,
  declaredLevel: 0,
  confirmedLevel: 0,
  levelVerified: false,
  startedLevel: null,
  phase: 'queued',
  enabled: true,
  order: 1,
  verifyCount: 0,
  attempts: 0,
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastOutcome: null,
  trainingStartedAt: null,
  nextProbeAt: null,
  probeBackoffIndex: 0,
  blocked: null,
  activeRunId: null,
  lastRunId: null,
  recovery: null,
  addedAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  completedAt: null,
  skippedAt: null,
  ...patch,
})

const status = (patch: Partial<MasteryQueueStatus> = {}): MasteryQueueStatus => ({
  campaign: {
    status: 'idle',
    activeItemId: null,
    activeStepRunId: null,
    settings: {
      probeIntervalMinutes: 60,
      onItemBlocked: 'skip',
      autoStartGame: true,
      notifyOnComplete: true,
      notifyOnBlocked: true,
    },
    clientProfileId: null,
    clientType: null,
    startedAt: null,
    pausedReason: null,
    updatedAt: '2026-11-21T00:00:00.000Z',
  },
  items: [],
  counts: { total: 0, queued: 0, training: 0, blocked: 0, completed: 0 },
  activeItem: null,
  nextActionableItem: null,
  ...patch,
})

describe('mastery island projection', () => {
  it('counts only confirmed levels, not a started training', () => {
    const progress = masteryProgressOf(status({
      items: [
        item({ confirmedLevel: 1, targetLevel: 3 }),
        item({ id: 'char_test:2', skillIndex: 2, confirmedLevel: 0, targetLevel: 2, startedLevel: 1, phase: 'training' })
      ]
    }))
    expect(progress).toMatchObject({ done: 1, total: 5, percent: 20 })
  })

  it('does not count skipped or disabled items', () => {
    const progress = masteryProgressOf(status({
      items: [
        item({ targetLevel: 3, enabled: false }),
        item({ id: 'char_test:2', skillIndex: 2, targetLevel: 2, phase: 'skipped' }),
        item({ id: 'char_test:3', skillIndex: 3, targetLevel: 1, confirmedLevel: 1, phase: 'completed' })
      ]
    }))
    expect(progress).toMatchObject({ done: 1, total: 1, percent: 100 })
  })

  it('reports the active operator and training state', () => {
    const active = item({ confirmedLevel: 1, targetLevel: 3, startedLevel: 2, phase: 'training' })
    const projection = status({
      campaign: { ...status().campaign, status: 'running', activeItemId: active.id },
      items: [active],
      activeItem: active
    })
    expect(masteryActiveItem(projection)?.id).toBe(active.id)
    expect(masteryTitle(projection)).toBe('测试干员 · 测试技能一')
    expect(masteryStateText(projection)).toBe('M2 训练中')
  })

  it('maps campaign states to tone and text', () => {
    expect(masteryTone(status({ campaign: { ...status().campaign, status: 'completed' } }))).toBe('success')
    expect(masteryTone(status({ campaign: { ...status().campaign, status: 'blocked' } }))).toBe('warning')
    expect(masteryTone(status({ campaign: { ...status().campaign, status: 'paused' } }))).toBe('paused')
    expect(masteryStateText(status({ campaign: { ...status().campaign, status: 'paused' } }))).toBe('已暂停')
    expect(masteryCampaignCounts(status({
      counts: { total: 4, queued: 2, training: 1, blocked: 1, completed: 0 }
    }))).toBe('等待 2 · 训练 1 · 受阻 1 · 完成 0')
  })

  it('keeps one stable activity id', () => {
    expect(MASTERY_ACTIVITY_ID).toBe('la-pluma-mastery')
  })
})
