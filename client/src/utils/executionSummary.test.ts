import { describe, expect, it } from 'vitest'
import { formatExecutionActionSummary, formatExecutionSummary, getExecutionLastTask } from './executionSummary'

describe('execution summary formatting', () => {
  it('formats the structured scheduler result as renderable text', () => {
    expect(formatExecutionSummary({
      successCount: 0,
      failedCount: 0,
      skippedCount: 1,
      durationMs: 23212,
    })).toBe('成功 0 · 跳过 1 · 23 秒')
  })

  it('preserves legacy text results', () => {
    expect(formatExecutionSummary('任务流程执行完成')).toBe('任务流程执行完成')
  })

  it('finds the most recent task from structured actions', () => {
    expect(getExecutionLastTask({
      actions: [
        { task: '启动游戏', status: 'success' },
        { task: '领取奖励', status: 'skipped' },
      ],
    })).toBe('领取奖励')
  })

  it('compacts Award actions into one readable line', () => {
    expect(formatExecutionActionSummary([
      { action: 'award', status: 'success' },
      { action: 'award', status: 'skipped' },
      { action: 'award', status: 'skipped' },
    ])).toBe('奖励检查完成 · 领取 1 项 · 跳过 2 项')
  })

  it('keeps failed actions visible in the compact summary', () => {
    expect(formatExecutionActionSummary([
      { action: 'startup', status: 'success' },
      { action: 'closedown', status: 'failed' },
    ])).toBe('流程执行完成 · 成功 1 项 · 失败 1 项')
  })

  it('formats recruit metrics without exposing the full tag list', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'recruit',
        status: 'success',
        startedCount: 1,
        refreshCount: 3,
        highestLevel: 4,
        finalTags: ['近卫干员', '输出'],
      },
    ])).toBe('公招完成 · 招募 1 次 · 刷新 3 次 · 最高 4 星')
  })

  it('formats only observed infrastructure operations', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'infrast',
        status: 'success',
        configuredFacilities: ['Mfg', 'Trade'],
        rewardCollected: true,
        rotationApplied: true,
        droneUsed: false,
        cluesReceived: 1,
      },
    ])).toBe('基建完成 · 收取产物 · 完成换班 · 收线索 1 次')
  })

  it('does not describe an empty infrastructure selection as completed', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'infrast',
        status: 'skipped',
        configuredFacilities: [],
      },
    ])).toBe('基建任务 · 已跳过')
  })

  it('formats observed Mall operations and limits', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'mall',
        status: 'success',
        visitedCount: 2,
        creditCollected: true,
        purchasedCount: 1,
        visitLimited: true,
      },
    ])).toBe('信用收支完成 · 访问 2 位好友 · 领取信用 · 购买 1 件 · 访问已达上限')
  })

  it('keeps insufficient credit readable without marking Mall as failed', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'mall',
        status: 'success',
        noMoney: true,
      },
    ])).toBe('信用收支完成 · 信用不足')
  })

  it('labels a disabled Mall configuration as skipped', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'mall',
        status: 'skipped',
      },
    ])).toBe('信用收支 · 已跳过')
  })

  it('formats a completed single-stage fight', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'fight',
        status: 'success',
        stage: '1-7',
        times: 3,
        dropCount: 2,
      },
    ])).toBe('作战完成 · 1-7 3 次 · 掉落 2 种')
  })

  it('formats mixed multi-stage fight outcomes without hiding failures', () => {
    expect(formatExecutionActionSummary([
      { action: 'fight', status: 'success', stage: '1-7', times: 2, dropCount: 1 },
      { action: 'fight', status: 'skipped', stage: 'PR-A-1', times: 0 },
      { action: 'fight', status: 'failed', stage: 'CE-6', times: 0 },
    ])).toBe('作战部分完成 · 3 个关卡 · 共 2 次 · 掉落 1 种 · 跳过 1 个 · 失败 1 个')
  })

  it('shows depleted sanity for a fight that never started', () => {
    expect(formatExecutionActionSummary([
      {
        action: 'fight',
        status: 'skipped',
        stage: '1-7',
        times: 0,
        sanityDepleted: true,
      },
    ])).toBe('作战任务 · 跳过 1 个 · 理智耗尽')
  })
})
