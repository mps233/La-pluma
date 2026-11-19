import { describe, expect, it } from 'vitest'
import type { AutomationExecutionSummary } from './automationRun'
import {
  filterExecutionActionsForDisplay,
  hasExecutionDetailContent,
} from './executionActionDisplay'

type Action = AutomationExecutionSummary['actions'][number]

interface ActionOverrides {
  action: Action['action']
  status: Action['status']
  task?: string
  message?: string
  [key: string]: unknown
}

const action = (overrides: ActionOverrides): Action => ({
  task: '任务',
  message: '消息',
  ...overrides,
} as Action)

const summary = (overrides: Partial<AutomationExecutionSummary> = {}): AutomationExecutionSummary => ({
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
  durationMs: 1_000,
  summaries: [],
  reports: [],
  actions: [],
  errors: [],
  warnings: [],
  ...overrides,
})

const messagesOf = (actions: Action[]) => filterExecutionActionsForDisplay(actions).map(entry => entry.message)

describe('filterExecutionActionsForDisplay', () => {
  it('returns an empty list for a missing action array', () => {
    expect(filterExecutionActionsForDisplay(undefined)).toEqual([])
  })

  it('keeps failed, skipped, and unconfirmed game actions', () => {
    expect(messagesOf([
      action({ action: 'startup', status: 'failed', message: '启动失败' }),
      action({ action: 'closedown', status: 'skipped', message: '关闭跳过' }),
      action({ action: 'fight', status: 'skipped', message: '作战跳过' }),
      action({ action: 'recruit', status: 'failed', message: '公招失败' }),
      action({ action: 'infrast', status: 'skipped', message: '基建跳过' }),
      action({ action: 'mall', status: 'failed', message: '信用失败' }),
      action({ action: 'operprogress', status: 'success', observed: false, message: '培养未确认' }),
      action({ action: 'switchtheme', status: 'success', observed: false, message: '主题未确认' }),
    ])).toEqual([
      '启动失败',
      '关闭跳过',
      '作战跳过',
      '公招失败',
      '基建跳过',
      '信用失败',
      '培养未确认',
      '主题未确认',
    ])
  })

  it('keeps successful actions that carry concrete results', () => {
    const actions = [
      action({ action: 'award', status: 'success', message: '每日任务已领取' }),
      action({ action: 'depot', status: 'success', message: '仓库识别完成，共 120 项' }),
      action({ action: 'operbox', status: 'success', message: '干员识别完成，共 80 名干员' }),
      action({ action: 'operprogress', status: 'success', observed: true, message: '培养完成' }),
      action({ action: 'switchtheme', status: 'success', message: '主题已设置' }),
      action({ action: 'fight', status: 'success', stage: '1-7', message: '作战完成' }),
      action({ action: 'recruit', status: 'success', startedCount: 2, message: '公招处理完成' }),
      action({ action: 'infrast', status: 'success', rewardCollected: true, message: '基建流程完成' }),
      action({ action: 'mall', status: 'success', visitedCount: 3, message: '信用收支完成' }),
    ]

    expect(filterExecutionActionsForDisplay(actions)).toEqual(actions)
  })

  it('hides routine lifecycle and completion-only successes', () => {
    expect(messagesOf([
      action({ action: 'startup', status: 'success', message: '游戏已启动' }),
      action({ action: 'closedown', status: 'success', message: '游戏客户端已关闭' }),
      action({ action: 'fight', status: 'success', message: '理智作战已完成' }),
      action({ action: 'recruit', status: 'success', message: '自动公招流程已完成' }),
      action({ action: 'infrast', status: 'success', configuredFacilities: ['Mfg', 'Trade'], message: '基建流程已完成' }),
      action({ action: 'mall', status: 'success', message: '信用收支流程已完成' }),
    ])).toEqual([])
  })

  it('treats zero counts and empty arrays as missing details', () => {
    expect(messagesOf([
      action({ action: 'fight', status: 'success', stage: '', times: 0, dropCount: 0, drops: '', sanityDepleted: false }),
      action({ action: 'recruit', status: 'success', startedCount: 0, collectedCount: 0, expeditedCount: 0, refreshCount: 0, highestLevel: 0, preservedTags: [] }),
      action({ action: 'infrast', status: 'success', cluesReceived: 0, cluesSent: 0, observedFacilities: [], skippedRooms: [], roomCandidates: [] }),
      action({ action: 'mall', status: 'success', visitedCount: 0, purchasedCount: 0 }),
    ])).toEqual([])
  })
})

const detailedSuccessCases: Array<[string, ActionOverrides]> = [
  ['fight stage', { action: 'fight', status: 'success', stage: '1-7' }],
  ['fight times', { action: 'fight', status: 'success', times: 1 }],
  ['fight drop count', { action: 'fight', status: 'success', dropCount: 1 }],
  ['fight depleted sanity', { action: 'fight', status: 'success', sanityDepleted: true }],
  ['recruit started count', { action: 'recruit', status: 'success', startedCount: 1 }],
  ['recruit collected count', { action: 'recruit', status: 'success', collectedCount: 1 }],
  ['recruit expedited count', { action: 'recruit', status: 'success', expeditedCount: 1 }],
  ['recruit refresh count', { action: 'recruit', status: 'success', refreshCount: 1 }],
  ['recruit highest level', { action: 'recruit', status: 'success', highestLevel: 1 }],
  ['recruit preserved tags', { action: 'recruit', status: 'success', preservedTags: ['资深干员'] }],
  ['infrast reward collected', { action: 'infrast', status: 'success', rewardCollected: true }],
  ['infrast rotation applied', { action: 'infrast', status: 'success', rotationApplied: true }],
  ['infrast drone used', { action: 'infrast', status: 'success', droneUsed: true }],
  ['infrast received clues', { action: 'infrast', status: 'success', cluesReceived: 1 }],
  ['infrast sent clues', { action: 'infrast', status: 'success', cluesSent: 1 }],
  ['infrast clue exchange', { action: 'infrast', status: 'success', clueExchange: true }],
  ['infrast continued training', { action: 'infrast', status: 'success', trainingContinued: true }],
  ['infrast completed training', { action: 'infrast', status: 'success', trainingCompleted: true }],
  ['infrast processing training', { action: 'infrast', status: 'success', trainingProcessing: true }],
  ['infrast observed facilities', { action: 'infrast', status: 'success', observedFacilities: ['Mfg'] }],
  ['infrast skipped rooms', { action: 'infrast', status: 'success', skippedRooms: [{ reason: 'trainee' }] }],
  ['infrast room candidates', { action: 'infrast', status: 'success', roomCandidates: [{ names: ['A'], candidates: ['B'] }] }],
  ['mall visited count', { action: 'mall', status: 'success', visitedCount: 1 }],
  ['mall purchased count', { action: 'mall', status: 'success', purchasedCount: 1 }],
  ['mall collected credit', { action: 'mall', status: 'success', creditCollected: true }],
  ['mall insufficient credit', { action: 'mall', status: 'success', noMoney: true }],
  ['mall visit limited', { action: 'mall', status: 'success', visitLimited: true }],
  ['mall no friends', { action: 'mall', status: 'success', noFriends: true }],
]

describe('filterExecutionActionsForDisplay detail fields', () => {
  it.each(detailedSuccessCases)('keeps %s', (_label, overrides) => {
    expect(filterExecutionActionsForDisplay([action(overrides)])).toHaveLength(1)
  })
})

describe('hasExecutionDetailContent', () => {
  const award = action({ action: 'award', status: 'success', message: '每日任务已领取' })

  it('reports visible actions and every auxiliary detail source', () => {
    expect(hasExecutionDetailContent(summary(), [award])).toBe(true)
    expect(hasExecutionDetailContent(summary({ summaries: [{ task: '理智作战', stage: '1-7' }] }), [])).toBe(true)
    expect(hasExecutionDetailContent(summary({ summaries: [{ task: '理智作战', drops: '源岩 2' }] }), [])).toBe(true)
    expect(hasExecutionDetailContent(summary({
      reports: [{ provider: 'penguin', status: 'success', message: '已上传' }],
    }), [])).toBe(true)
    expect(hasExecutionDetailContent(summary({ warnings: ['当前活动已结束'] }), [])).toBe(true)
    expect(hasExecutionDetailContent(summary({ errors: [{ task: '理智作战', error: '关卡不可用' }] }), [])).toBe(true)
  })

  it('reports no content for empty summaries or a summary without stage and drops', () => {
    expect(hasExecutionDetailContent(summary(), [])).toBe(false)
    expect(hasExecutionDetailContent(summary({ summaries: [{ task: '理智作战', times: '3' }] }), [])).toBe(false)
  })

  it('ignores errors that duplicate a failed action', () => {
    const failedFight = action({ action: 'fight', status: 'failed', task: '理智作战', message: '关卡不可用' })
    const duplicated = summary({
      actions: [failedFight],
      errors: [{ task: '理智作战', error: '关卡不可用' }],
    })
    expect(hasExecutionDetailContent(duplicated, [])).toBe(false)

    const distinct = summary({
      actions: [failedFight],
      errors: [{ task: '理智作战', error: '重试失败' }, { task: '自动公招', error: '许可不足' }],
    })
    expect(hasExecutionDetailContent(distinct, [])).toBe(true)
  })
})
