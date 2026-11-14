import { describe, expect, it } from 'vitest'
import type { AgentRun } from '@/types/run'
import {
  formatDurationMs,
  formatRunDuration,
  runFinishedWithin,
  runProgressOf,
  runResultSummary,
  runTaskName,
} from './runIsland'

const run = (overrides: Partial<AgentRun>): AgentRun => ({
  runId: 'run-1',
  operationId: 'execute_schedule',
  state: 'running',
  ...overrides,
})

describe('runProgressOf', () => {
  it('prefers the explicit step count', () => {
    expect(runProgressOf(run({ progress: { currentStep: 3, totalSteps: 6 } }))).toBeCloseTo(0.5)
  })

  it('clamps a step count that runs past its total', () => {
    expect(runProgressOf(run({ progress: { currentStep: 9, totalSteps: 6 } }))).toBe(1)
  })

  it('falls back to finished task results when steps are absent', () => {
    expect(runProgressOf(run({
      taskResults: [
        { status: 'success' },
        { status: 'success' },
        { status: 'failed' },
        { status: 'pending' },
      ],
    }))).toBeCloseTo(0.75)
  })

  it('reads zero for a run with no evidence of progress', () => {
    expect(runProgressOf(null)).toBe(0)
    expect(runProgressOf(run({ progress: {} }))).toBe(0)
  })
})

describe('runTaskName', () => {
  it('prefers the current task', () => {
    expect(runTaskName(run({ progress: { currentTask: ' 理智作战 ' } }))).toBe('理智作战')
  })

  it('falls back to the last named result', () => {
    expect(runTaskName(run({
      taskResults: [{ name: '启动游戏', status: 'success' }, { name: '理智作战', status: 'running' }],
    }))).toBe('理智作战')
  })

  it('has a neutral name when the run carries none', () => {
    expect(runTaskName(run({}))).toBe('自动化任务')
  })
})

describe('runResultSummary', () => {
  it('names every non-success outcome instead of counting it as done', () => {
    expect(runResultSummary(run({
      taskResults: [{ status: 'success' }, { status: 'skipped' }, { status: 'running' }],
    }))).toBe('成功 1，跳过 1 / 3 项')
  })

  it('names failures and skips together', () => {
    expect(runResultSummary(run({
      taskResults: [{ status: 'success' }, { status: 'failed' }, { status: 'skipped' }],
    }))).toBe('成功 1，失败 1，跳过 1 / 3 项')
  })

  it('says every result finished when they all succeeded', () => {
    expect(runResultSummary(run({
      taskResults: [{ status: 'success' }, { status: 'success' }],
    }))).toBe('全部 2 项完成')
  })

  it('is empty without results', () => {
    expect(runResultSummary(run({}))).toBe('')
  })
})

describe('formatRunDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatRunDuration('2026-11-14T10:00:00Z', '2026-11-14T10:00:48Z')).toBe('48 秒')
    expect(formatRunDuration('2026-11-14T10:00:00Z', '2026-11-14T10:03:20Z')).toBe('3 分 20 秒')
    expect(formatRunDuration('2026-11-14T10:00:00Z', '2026-11-14T11:05:00Z')).toBe('1 小时 5 分')
  })

  it('drops the seconds once the run passes an hour', () => {
    expect(formatDurationMs(3_725_000)).toBe('1 小时 2 分')
  })

  it('refuses a missing or backwards interval', () => {
    expect(formatRunDuration(null, '2026-11-14T10:00:00Z')).toBeNull()
    expect(formatRunDuration('2026-11-14T10:00:00Z', null)).toBeNull()
    expect(formatRunDuration('2026-11-14T10:05:00Z', '2026-11-14T10:00:00Z')).toBeNull()
    expect(formatRunDuration('not a date', '2026-11-14T10:00:00Z')).toBeNull()
  })
})

describe('runFinishedWithin', () => {
  const now = Date.parse('2026-11-14T10:10:00Z')

  it('keeps a run that ended inside the hold', () => {
    const finished = run({ state: 'succeeded', finishedAt: '2026-11-14T10:09:58Z' })
    expect(runFinishedWithin(finished, now, 6_500)).toBe(true)
  })

  it('drops a run that ended before the hold', () => {
    const finished = run({ state: 'succeeded', finishedAt: '2026-11-14T10:00:00Z' })
    expect(runFinishedWithin(finished, now, 6_500)).toBe(false)
  })

  it('never treats an active or unfinished run as an outcome', () => {
    expect(runFinishedWithin(run({ state: 'running', finishedAt: null }), now, 6_500)).toBe(false)
    expect(runFinishedWithin(run({ state: 'succeeded' }), now, 6_500)).toBe(false)
    expect(runFinishedWithin(null, now, 6_500)).toBe(false)
  })

  it('does not believe a finish stamped in the future', () => {
    const finished = run({ state: 'failed', finishedAt: '2026-11-14T10:12:00Z' })
    expect(runFinishedWithin(finished, now, 6_500)).toBe(false)
  })
})
