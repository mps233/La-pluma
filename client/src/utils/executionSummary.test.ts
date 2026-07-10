import { describe, expect, it } from 'vitest'
import { formatExecutionSummary, getExecutionLastTask } from './executionSummary'

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
})
