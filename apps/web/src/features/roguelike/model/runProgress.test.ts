// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { AgentRun } from '@/features/task-execution'
import {
  calculateRoguelikeSuccessRate,
  describeBlackFlowFreshness,
  describeBlackFlowMilestoneStatus,
  describeBlackFlowMovement,
  describeBlackFlowNextAction,
  describeBlackFlowNodeType,
  describeBlackFlowStrategyOutcome,
  describeBlackFlowStrategyProfile,
  describeBlackFlowTerminationReason,
  describeRoguelikeRoundOutcome,
  formatRoguelikeElapsed,
  formatRoguelikeRelativeTime,
  readRoguelikeRunProgress,
  readRoguelikeSummaryProgress,
  selectBlackFlowAction,
  selectRoguelikeProgressView,
  type RoguelikeBlackFlowProgress,
  type RoguelikeCommand,
  type RoguelikeProgressSnapshot,
} from './runProgress'
import { readRoguelikeRunSummary, type RoguelikeRunSummary } from './runSummary'

function snapshot(overrides: Partial<RoguelikeProgressSnapshot> = {}): RoguelikeProgressSnapshot {
  return {
    command: 'roguelike',
    theme: 'Phantom',
    mode: 0,
    phase: 'exploring',
    currentRound: 3,
    roundStartedAt: '2026-11-21T10:00:00.000Z',
    targetRounds: 3,
    roundsStarted: 3,
    roundsEnded: 2,
    roundsSettled: 2,
    roundsPassed: 1,
    settlementSupported: true,
    currentAction: 'StageInfo',
    lastEventKind: 'combat',
    lastEventName: '紧急作战',
    lastEventAt: '2026-11-21T10:05:00.000Z',
    combatCount: 4,
    investment: { rounds: 1, count: 10, total: 300, deposit: 100 },
    recentRounds: [
      {
        index: 2,
        outcome: 'passed',
        settled: true,
        floor: 5,
        score: 1200,
        endedAt: '2026-11-21T10:04:00.000Z',
      },
    ],
    blackflow: null,
    updatedAt: '2026-11-21T10:05:01.000Z',
    degraded: false,
    observed: true,
    ...overrides,
  }
}

function blackflow(overrides: Partial<RoguelikeBlackFlowProgress> = {}): RoguelikeBlackFlowProgress {
  return {
    floor: 2,
    floorAt: '2026-11-21T10:05:00.000Z',
    currentNode: { id: '281475010265088', name: '丛林商店', type: 'shop' },
    currentNodeAt: '2026-11-21T10:05:10.000Z',
    actionPoints: { before: 6, after: 3, at: '2026-11-21T10:05:20.000Z' },
    lastRoute: {
      at: '2026-11-21T10:05:20.000Z',
      floor: 2,
      target: { id: '281475010265092', name: '丛林商店', type: 'shop' },
      landing: { id: '281475010265092', name: '丛林商店', type: 'shop' },
      movement: 'rogue_6_scrap_M_05',
      actionPointsBefore: 6,
      actionPointsAfter: 3,
      exactCost: 2,
      predictedCost: 3,
      arrived: true,
    },
    lastNodeResolution: {
      at: '2026-11-21T10:05:30.000Z',
      floor: 2,
      node: { id: '281475010265092', name: '丛林商店', type: 'shop' },
      eventName: '丛林商店',
      progress: 'completed',
    },
    milestones: [
      {
        id: 'reach_floor_3',
        floor: 3,
        progress: 0,
        status: 'satisfied',
        at: '2026-11-21T10:05:40.000Z',
      },
    ],
    strategy: {
      at: '2026-11-21T10:06:00.000Z',
      profile: 'burn_with_investment',
      outcome: 'burn_completed',
      terminationReason: 'third_floor_reached',
      nextAction: 'restart_current_run',
      succeeded: true,
    },
    updatedAt: '2026-11-21T10:06:00.000Z',
    ...overrides,
  }
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...snapshot(), ...overrides }
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: 'run-1',
    operationId: 'run_task',
    state: 'running',
    links: { self: '/api/agent/runs/run-1' },
    ...overrides,
  }
}

function runWithProgress(value: unknown = snapshot(), overrides: Partial<AgentRun> = {}): AgentRun {
  return run({ progress: { roguelike: value }, ...overrides })
}

function summary(command: RoguelikeCommand = 'roguelike'): RoguelikeRunSummary {
  return {
    command,
    theme: command === 'roguelike' ? 'Phantom' : 'Reclamation',
    status: 'success',
    observed: true,
    message: '执行完成',
    settlement: null,
    investment: null,
    events: [],
    coppers: [],
    milestones: [],
    warnings: [],
    strategy: null,
    combats: 0,
    taskChain: { started: true, completed: true, failed: false, stopped: false },
  }
}

function terminalRunWithProgress(
  value: unknown,
  mode: RoguelikeCommand = 'roguelike',
  overrides: Partial<AgentRun> = {},
): AgentRun {
  return run({
    state: 'succeeded',
    result: { summary: { ...summary(mode), progress: value } },
    ...overrides,
  })
}

describe('readRoguelikeRunProgress', () => {
  it('returns null without a run or a roguelike envelope', () => {
    expect(readRoguelikeRunProgress(null)).toBeNull()
    expect(readRoguelikeRunProgress(run())).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(null))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress('progress'))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress({ command: 'combat' }))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress([snapshot()]))).toBeNull()
  })

  it('parses a valid snapshot', () => {
    expect(readRoguelikeRunProgress(runWithProgress(snapshot()))).toEqual(snapshot())
  })

  it('keeps a missing mode as unknown without rejecting the snapshot', () => {
    const { mode: _mode, ...withoutMode } = raw()
    const parsed = readRoguelikeRunProgress(runWithProgress(withoutMode))

    expect(parsed).not.toBeNull()
    expect(parsed?.mode).toBeNull()
  })

  it('keeps a non-integer mode as unknown without rejecting the snapshot', () => {
    for (const mode of ['1', 1.5, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      const parsed = readRoguelikeRunProgress(runWithProgress(raw({ mode })))

      expect(parsed).not.toBeNull()
      expect(parsed?.mode).toBeNull()
    }
  })

  it('accepts a finite integer mode as-is', () => {
    expect(readRoguelikeRunProgress(runWithProgress(raw({ mode: 1 })))?.mode).toBe(1)
    expect(readRoguelikeRunProgress(runWithProgress(raw({ mode: 30003 })))?.mode).toBe(30003)
    expect(readRoguelikeRunProgress(runWithProgress(raw({ mode: null })))?.mode).toBeNull()
  })

  it('normalizes invalid optional fields to unknown instead of inventing values', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      phase: 'dancing',
      currentRound: '3',
      roundStartedAt: 42,
      targetRounds: Number.NaN,
      settlementSupported: 'yes',
      currentAction: false,
      lastEventKind: 'dance',
      lastEventName: {},
      lastEventAt: [],
      investment: { rounds: 1 },
      recentRounds: 'rounds',
    })))

    expect(parsed).toMatchObject({
      phase: 'unknown',
      currentRound: null,
      roundStartedAt: null,
      targetRounds: null,
      settlementSupported: null,
      currentAction: null,
      lastEventKind: null,
      lastEventName: null,
      lastEventAt: null,
      investment: null,
      recentRounds: [],
    })
  })

  it.each(['roundsStarted', 'roundsEnded', 'roundsSettled', 'roundsPassed', 'combatCount'])(
    'rejects a snapshot whose %s is not a finite number instead of defaulting to zero',
    field => {
      expect(readRoguelikeRunProgress(runWithProgress(raw({ [field]: '2' })))).toBeNull()
      expect(readRoguelikeRunProgress(runWithProgress(raw({ [field]: Number.NaN })))).toBeNull()
      expect(readRoguelikeRunProgress(runWithProgress(raw({ [field]: Number.POSITIVE_INFINITY })))).toBeNull()
    },
  )

  it('rejects a snapshot whose required text or flags are malformed', () => {
    expect(readRoguelikeRunProgress(runWithProgress(raw({ theme: 1 })))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ updatedAt: 1 })))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ degraded: 'no' })))).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ observed: 1 })))).toBeNull()
  })

  it('keeps a missing target as unknown instead of defaulting it', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(snapshot({ targetRounds: null })))

    expect(parsed?.targetRounds).toBeNull()
  })

  it('filters malformed recent rounds and keeps at most five valid entries', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      recentRounds: [
        {
          index: 6,
          outcome: 'passed',
          settled: true,
          floor: 6,
          score: 1500,
          endedAt: '2026-11-21T10:06:00.000Z',
        },
        null,
        {
          index: 5,
          outcome: 'not_passed',
          settled: true,
          floor: 5,
          score: 1200,
          endedAt: '2026-11-21T10:05:00.000Z',
        },
        { index: '4', outcome: 'failed', settled: true, floor: 4, score: 900, endedAt: 7 },
        {
          index: 4,
          outcome: 'not_passed',
          settled: true,
          floor: 4,
          score: 800,
          endedAt: '2026-11-21T10:04:00.000Z',
        },
        { index: 3, outcome: 'not_passed', settled: 'yes', floor: 3, score: 400, endedAt: null },
        { index: 2, outcome: 'passed', settled: false, floor: null, score: null, endedAt: null },
        { index: 1, outcome: 'passed', settled: true, floor: 1, score: 100, endedAt: null },
        { index: 0, outcome: 'unknown', settled: true, floor: 0, score: 0, endedAt: null },
      ],
    })))

    expect(parsed?.recentRounds).toEqual([
      {
        index: 6,
        outcome: 'passed',
        settled: true,
        floor: 6,
        score: 1500,
        endedAt: '2026-11-21T10:06:00.000Z',
      },
      {
        index: 5,
        outcome: 'not_passed',
        settled: true,
        floor: 5,
        score: 1200,
        endedAt: '2026-11-21T10:05:00.000Z',
      },
      { index: null, outcome: 'unknown', settled: true, floor: 4, score: 900, endedAt: null },
      {
        index: 4,
        outcome: 'not_passed',
        settled: true,
        floor: 4,
        score: 800,
        endedAt: '2026-11-21T10:04:00.000Z',
      },
      { index: 2, outcome: 'passed', settled: false, floor: null, score: null, endedAt: null },
    ])
  })
})

describe('readRoguelikeSummaryProgress', () => {
  it('returns null without a run or nested progress', () => {
    expect(readRoguelikeSummaryProgress(null)).toBeNull()
    expect(readRoguelikeSummaryProgress(run())).toBeNull()
    expect(readRoguelikeSummaryProgress(run({ result: { summary: summary() } }))).toBeNull()
    expect(readRoguelikeSummaryProgress(run({ error: { details: { summary: summary() } } }))).toBeNull()
    expect(readRoguelikeSummaryProgress(run({ result: 'raw text' }))).toBeNull()
  })

  it('reads the final progress attached to a successful result summary', () => {
    const finalProgress = snapshot({ phase: 'ended', currentRound: null })
    const parsed = readRoguelikeSummaryProgress(
      run({ result: { summary: { ...summary(), progress: finalProgress } } }),
    )

    expect(parsed).toEqual(finalProgress)
  })

  it('falls back to the error details summary of a failed run', () => {
    const finalProgress = snapshot({ command: 'reclamation', phase: 'ended' })
    const parsed = readRoguelikeSummaryProgress(run({
      state: 'failed',
      result: undefined,
      error: {
        code: 'AGENT_RUN_FAILED',
        message: '执行失败',
        details: { summary: { ...summary('reclamation'), progress: finalProgress } },
      },
    }))

    expect(parsed).toEqual(finalProgress)
  })

  it('prefers result progress over error progress', () => {
    const resultProgress = snapshot({ command: 'roguelike' })
    const parsed = readRoguelikeSummaryProgress(run({
      state: 'stopped',
      result: { summary: { ...summary(), progress: resultProgress } },
      error: {
        details: {
          summary: { ...summary('reclamation'), progress: snapshot({ command: 'reclamation' }) },
        },
      },
    }))

    expect(parsed).toEqual(resultProgress)
  })

  it('falls back to error progress when the result progress is malformed', () => {
    const errorProgress = snapshot({ command: 'reclamation' })
    const parsed = readRoguelikeSummaryProgress(run({
      state: 'failed',
      result: { summary: { ...summary(), progress: { command: 'nope' } } },
      error: {
        details: { summary: { ...summary('reclamation'), progress: errorProgress } },
      },
    }))

    expect(parsed).toEqual(errorProgress)
  })

  it('does not let malformed nested progress invalidate the run summary', () => {
    const failedRun = run({
      state: 'failed',
      result: { summary: { ...summary(), progress: { command: 'nope' } } },
    })

    expect(readRoguelikeSummaryProgress(failedRun)).toBeNull()
    expect(readRoguelikeRunSummary(failedRun)?.command).toBe('roguelike')
  })
})

describe('selectRoguelikeProgressView', () => {
  it('returns the active snapshot when its command matches the mode', () => {
    const activeRun = runWithProgress(snapshot())
    const view = selectRoguelikeProgressView({
      mode: 'roguelike',
      run: activeRun,
      lastRun: null,
      hasSnapshot: true,
      taskName: '集成战略',
    })

    expect(view).toEqual({
      status: 'active',
      command: 'roguelike',
      progress: snapshot(),
      run: activeRun,
      summary: null,
      fromLastRun: false,
      taskName: '集成战略',
    })
  })

  it('keeps an active run without usable progress visible without inventing rounds', () => {
    const withoutProgress = run({ state: 'waiting' })
    const malformed = runWithProgress({ command: 'combat' })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: withoutProgress,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'active',
      progress: null,
      run: withoutProgress,
      summary: null,
      taskName: null,
    })
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: malformed,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({ status: 'active', progress: null, run: malformed })
  })

  it('does not treat an active run of the other mode as this mode result', () => {
    const activeRun = runWithProgress(snapshot({ command: 'reclamation' }))

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: activeRun,
      lastRun: null,
      hasSnapshot: true,
    }).status).toBe('idle')
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: activeRun,
      lastRun: null,
      hasSnapshot: false,
    }).status).toBe('loading')
  })

  it('uses a matching lastRun when the active run belongs to the other mode', () => {
    const activeRun = runWithProgress(snapshot({ command: 'reclamation' }))
    const lastRun = terminalRunWithProgress(snapshot({ phase: 'ended' }), 'roguelike')

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: activeRun,
      lastRun,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      progress: snapshot({ phase: 'ended' }),
      run: lastRun,
      summary: summary('roguelike'),
      fromLastRun: true,
    })
  })

  it('reads the final progress from a succeeded result summary', () => {
    const finalProgress = snapshot({ phase: 'ended', currentRound: null, roundsEnded: 3, roundsPassed: 2 })
    const terminalRun = terminalRunWithProgress(finalProgress)

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
      taskName: '集成战略',
    })).toEqual({
      status: 'terminal',
      command: 'roguelike',
      progress: finalProgress,
      run: terminalRun,
      summary: summary('roguelike'),
      fromLastRun: false,
      taskName: '集成战略',
    })
  })

  it('reads final progress from an error details summary', () => {
    const finalProgress = snapshot({ command: 'reclamation', phase: 'ended' })
    const failedRun = run({
      state: 'failed',
      result: undefined,
      error: {
        code: 'AGENT_RUN_FAILED',
        message: '执行失败',
        details: { summary: { ...summary('reclamation'), progress: finalProgress } },
      },
    })

    expect(selectRoguelikeProgressView({
      mode: 'reclamation',
      run: failedRun,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      command: 'reclamation',
      progress: finalProgress,
      run: failedRun,
      summary: summary('reclamation'),
      fromLastRun: false,
    })
  })

  it('falls back to the parsed summary when a terminal run has no final progress', () => {
    const terminalRun = run({ state: 'succeeded', result: { summary: summary('roguelike') } })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      progress: null,
      summary: summary('roguelike'),
      fromLastRun: false,
    })
  })

  it('keeps a terminal result when only the nested progress is malformed', () => {
    const terminalRun = run({
      state: 'succeeded',
      result: { summary: { ...summary('roguelike'), progress: 'broken' } },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      progress: null,
      summary: summary('roguelike'),
    })
  })

  it('uses a matching summary command even when the summary body is not parseable', () => {
    const terminalRun = run({
      state: 'succeeded',
      result: { summary: { progress: snapshot({ phase: 'ended' }) } },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      progress: snapshot({ phase: 'ended' }),
      summary: null,
    })
  })

  it('does not present a terminal run of the other mode as this mode result', () => {
    const terminalRun = terminalRunWithProgress(snapshot({ command: 'reclamation' }), 'reclamation')

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it.each(['succeeded', 'failed', 'stopped', 'interrupted'] as const)(
    'keeps a %s tracked run visible without a summary or progress',
    state => {
      const terminalRun = run({ state })

      expect(selectRoguelikeProgressView({
        mode: 'roguelike',
        run: terminalRun,
        lastRun: null,
        hasSnapshot: true,
        taskName: '集成战略',
      })).toEqual({
        status: 'terminal',
        command: 'roguelike',
        progress: null,
        run: terminalRun,
        summary: null,
        fromLastRun: false,
        taskName: '集成战略',
      })
    },
  )

  it('keeps a terminal tracked run visible when its summary has no usable command', () => {
    const terminalRun = run({
      state: 'succeeded',
      result: { summary: { ...summary('roguelike'), command: 'combat' } },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toMatchObject({
      status: 'terminal',
      progress: null,
      summary: null,
      fromLastRun: false,
    })
  })

  it('does not present a terminal tracked run whose progress belongs to the other mode', () => {
    const terminalRun = run({
      state: 'succeeded',
      result: { summary: { progress: snapshot({ command: 'reclamation' }) } },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it('does not present a terminal tracked run whose summary belongs to the other mode', () => {
    const terminalRun = run({ state: 'succeeded', result: { summary: summary('reclamation') } })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it('drops the summary when it disagrees with a progress that matches the mode', () => {
    const finalProgress = snapshot({ phase: 'ended' })
    const terminalRun = run({
      state: 'failed',
      result: { summary: { ...summary('reclamation'), progress: finalProgress } },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toEqual({
      status: 'terminal',
      command: 'roguelike',
      progress: finalProgress,
      run: terminalRun,
      summary: null,
      fromLastRun: false,
      taskName: null,
    })
  })

  it('drops the progress when it disagrees with a summary that matches the mode', () => {
    const terminalRun = run({
      state: 'succeeded',
      result: {
        summary: { ...summary('roguelike'), progress: snapshot({ command: 'reclamation' }) },
      },
    })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRun,
      lastRun: null,
      hasSnapshot: true,
    })).toEqual({
      status: 'terminal',
      command: 'roguelike',
      progress: null,
      run: terminalRun,
      summary: summary('roguelike'),
      fromLastRun: false,
      taskName: null,
    })
  })

  it('shows a matching lastRun as the terminal result after refresh without inheriting the tracked label', () => {
    const lastRun = terminalRunWithProgress(snapshot({ phase: 'ended' }), 'roguelike')
    const view = selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun,
      hasSnapshot: true,
      taskName: '集成战略',
    })

    expect(view).toEqual({
      status: 'terminal',
      command: 'roguelike',
      progress: snapshot({ phase: 'ended' }),
      run: lastRun,
      summary: summary('roguelike'),
      fromLastRun: true,
      taskName: null,
    })
  })

  it('does not label a matching lastRun with another mode tracked run name', () => {
    const activeRun = runWithProgress(snapshot({ command: 'reclamation' }))
    const lastRun = terminalRunWithProgress(snapshot({ phase: 'ended' }), 'roguelike')
    const view = selectRoguelikeProgressView({
      mode: 'roguelike',
      run: activeRun,
      lastRun,
      hasSnapshot: true,
      taskName: '生息演算',
    })

    expect(view).toMatchObject({
      status: 'terminal',
      fromLastRun: true,
      run: lastRun,
      taskName: null,
    })
  })

  it('ignores a lastRun from another operation', () => {
    const lastRun = terminalRunWithProgress(snapshot(), 'roguelike', { operationId: 'run_copilot_set' })

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun,
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it('ignores a lastRun of the other mode', () => {
    const lastRun = terminalRunWithProgress(snapshot({ command: 'reclamation' }), 'reclamation')

    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun,
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it('ignores a lastRun without a usable summary', () => {
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun: run({ state: 'succeeded' }),
      hasSnapshot: true,
    }).status).toBe('idle')
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun: run({ state: 'succeeded', result: { summary: { ...summary(), command: 'combat' } } }),
      hasSnapshot: true,
    }).status).toBe('idle')
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun: run({
        state: 'succeeded',
        result: { summary: { progress: snapshot({ phase: 'ended' }) } },
      }),
      hasSnapshot: true,
    }).status).toBe('idle')
  })

  it('distinguishes an unobserved snapshot from an idle page', () => {
    expect(selectRoguelikeProgressView({
      mode: 'reclamation',
      run: null,
      lastRun: null,
      hasSnapshot: false,
    })).toEqual({
      status: 'loading',
      command: 'reclamation',
      progress: null,
      run: null,
      summary: null,
      fromLastRun: false,
      taskName: null,
    })
    expect(selectRoguelikeProgressView({
      mode: 'roguelike',
      run: null,
      lastRun: null,
      hasSnapshot: true,
    }).status).toBe('idle')
  })
})

describe('formatRoguelikeElapsed', () => {
  it('formats minutes and hours with second precision', () => {
    expect(formatRoguelikeElapsed(0)).toBe('00:00')
    expect(formatRoguelikeElapsed(999)).toBe('00:00')
    expect(formatRoguelikeElapsed(59_000)).toBe('00:59')
    expect(formatRoguelikeElapsed(60_000)).toBe('01:00')
    expect(formatRoguelikeElapsed(3_599_000)).toBe('59:59')
    expect(formatRoguelikeElapsed(3_600_000)).toBe('1:00:00')
    expect(formatRoguelikeElapsed(3_661_000)).toBe('1:01:01')
    expect(formatRoguelikeElapsed(36_000_000)).toBe('10:00:00')
  })

  it('returns null for missing or invalid durations', () => {
    expect(formatRoguelikeElapsed(null)).toBeNull()
    expect(formatRoguelikeElapsed(-1)).toBeNull()
    expect(formatRoguelikeElapsed(Number.NaN)).toBeNull()
    expect(formatRoguelikeElapsed(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('formatRoguelikeRelativeTime', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z')

  it('formats elapsed time in the largest whole unit', () => {
    expect(formatRoguelikeRelativeTime(now, now)).toBe('刚刚')
    expect(formatRoguelikeRelativeTime(now - 4_999, now)).toBe('刚刚')
    expect(formatRoguelikeRelativeTime(now - 5_000, now)).toBe('5 秒前')
    expect(formatRoguelikeRelativeTime(now - 59_000, now)).toBe('59 秒前')
    expect(formatRoguelikeRelativeTime(now - 60_000, now)).toBe('1 分钟前')
    expect(formatRoguelikeRelativeTime(now - 3_599_000, now)).toBe('59 分钟前')
    expect(formatRoguelikeRelativeTime(now - 3_600_000, now)).toBe('1 小时前')
    expect(formatRoguelikeRelativeTime(now - 86_400_000, now)).toBe('24 小时前')
  })

  it('returns null for future or invalid timestamps', () => {
    expect(formatRoguelikeRelativeTime(now + 1, now)).toBeNull()
    expect(formatRoguelikeRelativeTime(null, now)).toBeNull()
    expect(formatRoguelikeRelativeTime(Number.NaN, now)).toBeNull()
    expect(formatRoguelikeRelativeTime(now, Number.NaN)).toBeNull()
    expect(formatRoguelikeRelativeTime(now, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('calculateRoguelikeSuccessRate', () => {
  it('rounds the rate to a whole percentage', () => {
    expect(calculateRoguelikeSuccessRate(0, 10)).toBe(0)
    expect(calculateRoguelikeSuccessRate(3, 8)).toBe(38)
    expect(calculateRoguelikeSuccessRate(2, 3)).toBe(67)
    expect(calculateRoguelikeSuccessRate(10, 10)).toBe(100)
  })

  it('returns null when the denominator is not positive', () => {
    expect(calculateRoguelikeSuccessRate(0, 0)).toBeNull()
    expect(calculateRoguelikeSuccessRate(3, 0)).toBeNull()
    expect(calculateRoguelikeSuccessRate(3, -1)).toBeNull()
  })

  it('returns null for non-finite inputs', () => {
    expect(calculateRoguelikeSuccessRate(Number.NaN, 10)).toBeNull()
    expect(calculateRoguelikeSuccessRate(3, Number.NaN)).toBeNull()
    expect(calculateRoguelikeSuccessRate(3, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('describeRoguelikeRoundOutcome', () => {
  it('labels every round outcome', () => {
    expect(describeRoguelikeRoundOutcome('passed')).toBe('通关')
    expect(describeRoguelikeRoundOutcome('not_passed')).toBe('未通关')
    expect(describeRoguelikeRoundOutcome('unknown')).toBe('未确认')
  })
})

describe('blackflow snapshot parsing', () => {
  it('keeps blackflow null when the field is absent, null or malformed', () => {
    const { blackflow: _blackflow, ...withoutBlackflow } = raw()

    expect(readRoguelikeRunProgress(runWithProgress(withoutBlackflow))?.blackflow).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ blackflow: null })))?.blackflow).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ blackflow: 'blackflow' })))?.blackflow).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ blackflow: [] })))?.blackflow).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({ blackflow: {} })))?.blackflow).toBeNull()
    expect(readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        floor: null,
        floorAt: 1,
        currentNode: { id: 'invalid' },
        actionPoints: {},
        lastRoute: {},
        lastNodeResolution: {},
        milestones: [null, { id: 1, status: 2 }],
        strategy: {},
        updatedAt: 3,
      },
    })))?.blackflow).toBeNull()
  })

  it('parses a complete blackflow block', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({ blackflow: blackflow() })))

    expect(parsed?.blackflow).toEqual(blackflow())
  })

  it('keeps partial blackflow data and normalizes invalid fields individually', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        floor: 2,
        floorAt: 42,
        currentNode: { id: 281475010265088, name: 7, type: 'shop' },
        currentNodeAt: null,
        actionPoints: { before: '6', after: 3, at: 123 },
        lastRoute: {
          at: '2026-11-21T10:05:20.000Z',
          floor: 2,
          target: { id: 281475010265092, name: {}, type: [] },
          landing: { id: -1, name: '丛林商店', type: 'shop' },
          movement: 7,
          actionPointsBefore: 6,
          actionPointsAfter: '3',
          exactCost: 2,
          predictedCost: Number.NaN,
          arrived: 'yes',
        },
        lastNodeResolution: {
          at: '2026-11-21T10:05:30.000Z',
          floor: '2',
          node: { id: null, name: '丛林商店', type: 'shop' },
          eventName: 5,
          progress: 'done',
        },
        milestones: 'milestones',
        strategy: { profile: 1, outcome: 'burn_completed', succeeded: 'yes' },
        updatedAt: 99,
      },
    })))

    expect(parsed?.blackflow).toEqual({
      floor: 2,
      floorAt: null,
      currentNode: { id: '281475010265088', name: null, type: 'shop' },
      currentNodeAt: null,
      actionPoints: { before: null, after: 3, at: null },
      lastRoute: {
        at: '2026-11-21T10:05:20.000Z',
        floor: 2,
        target: { id: '281475010265092', name: null, type: null },
        landing: null,
        movement: null,
        actionPointsBefore: 6,
        actionPointsAfter: null,
        exactCost: 2,
        predictedCost: null,
        arrived: false,
      },
      lastNodeResolution: {
        at: '2026-11-21T10:05:30.000Z',
        floor: null,
        node: null,
        eventName: null,
        progress: null,
      },
      milestones: [],
      strategy: {
        at: null,
        profile: null,
        outcome: 'burn_completed',
        terminationReason: null,
        nextAction: null,
        succeeded: null,
      },
      updatedAt: null,
    })
  })

  it('drops empty nested objects from a kept blackflow block', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        floor: 2,
        floorAt: null,
        currentNode: null,
        currentNodeAt: null,
        actionPoints: {},
        lastRoute: {
          at: null,
          floor: null,
          target: null,
          landing: null,
          movement: null,
          actionPointsBefore: null,
          actionPointsAfter: null,
          exactCost: null,
          predictedCost: null,
          arrived: false,
        },
        lastNodeResolution: {},
        milestones: [],
        strategy: {},
        updatedAt: '2026-11-21T10:06:00.000Z',
      },
    })))

    expect(parsed?.blackflow).toEqual({
      floor: 2,
      floorAt: null,
      currentNode: null,
      currentNodeAt: null,
      actionPoints: null,
      lastRoute: null,
      lastNodeResolution: null,
      milestones: [],
      strategy: null,
      updatedAt: '2026-11-21T10:06:00.000Z',
    })
  })

  it('keeps a partial block without inventing an untimestamped empty one', () => {
    const timestamped = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: { updatedAt: '2026-11-21T10:06:00.000Z' },
    })))
    const partial = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: { floor: 1, milestones: [] },
    })))

    expect(timestamped?.blackflow).toEqual({
      floor: null,
      floorAt: null,
      currentNode: null,
      currentNodeAt: null,
      actionPoints: null,
      lastRoute: null,
      lastNodeResolution: null,
      milestones: [],
      strategy: null,
      updatedAt: '2026-11-21T10:06:00.000Z',
    })
    expect(partial?.blackflow?.floor).toBe(1)
    expect(partial?.blackflow?.updatedAt).toBeNull()
  })
})

describe('blackflow node ids', () => {
  const cases: ReadonlyArray<readonly [unknown, string | null]> = [
    ['281475010265088', '281475010265088'],
    [281475010265088, '281475010265088'],
    [0, '0'],
    [18446744073709552000, null],
    [-1, null],
    [1.5, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['', null],
    ['abc', null],
    ['-1', null],
    ['1.5', null],
    ['18446744073709552000', null],
    ['9007199254740992', null],
    [null, null],
    [undefined, null],
    [{}, null],
  ]

  it.each(cases)('normalizes currentNode id %p to %p', (id, expected) => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        currentNode: { id, name: '丛林商店', type: 'shop' },
        updatedAt: '2026-11-21T10:06:00.000Z',
      },
    })))

    expect(parsed?.blackflow?.currentNode?.id ?? null).toBe(expected)
  })

  it('normalizes numeric node ids in route targets, landings and resolutions', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        lastRoute: {
          at: '2026-11-21T10:05:20.000Z',
          target: { id: 281475010265092, name: '丛林商店', type: 'shop' },
          landing: { id: '281475010265093', name: null, type: 'empty' },
          movement: 'walk',
        },
        lastNodeResolution: {
          at: '2026-11-21T10:05:30.000Z',
          node: { id: 281475010265094, name: '丛林事件', type: 'incident' },
          eventName: '丛林事件',
          progress: 'active',
        },
        updatedAt: '2026-11-21T10:05:30.000Z',
      },
    })))

    expect(parsed?.blackflow?.lastRoute?.target?.id).toBe('281475010265092')
    expect(parsed?.blackflow?.lastRoute?.landing?.id).toBe('281475010265093')
    expect(parsed?.blackflow?.lastNodeResolution?.node?.id).toBe('281475010265094')
  })
})

describe('blackflow milestones', () => {
  it('keeps at most five milestones in order', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        milestones: Array.from({ length: 6 }, (_, index) => ({
          id: `m-${index}`,
          floor: index + 1,
          progress: 0,
          status: 'available',
          at: `2026-11-21T10:0${index}:00.000Z`,
        })),
        updatedAt: '2026-11-21T10:06:00.000Z',
      },
    })))

    expect(parsed?.blackflow?.milestones).toHaveLength(5)
    expect(parsed?.blackflow?.milestones.map(milestone => milestone.id))
      .toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4'])
  })

  it('drops malformed entries and normalizes invalid optional fields', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        milestones: [
          null,
          'milestone',
          { id: 'missing-status' },
          { id: 7, status: 'available' },
          { id: 'numeric-status', status: 5 },
          { id: 'valid-partial', status: 'satisfied', floor: '3', progress: Number.NaN, at: 5 },
          {
            id: 'valid-full',
            status: 'missed',
            floor: 2,
            progress: 1,
            at: '2026-11-21T10:05:40.000Z',
          },
        ],
        updatedAt: '2026-11-21T10:06:00.000Z',
      },
    })))

    expect(parsed?.blackflow?.milestones).toEqual([
      { id: 'valid-partial', floor: null, progress: null, status: 'satisfied', at: null },
      {
        id: 'valid-full',
        floor: 2,
        progress: 1,
        status: 'missed',
        at: '2026-11-21T10:05:40.000Z',
      },
    ])
  })

  it('deduplicates milestones by id and keeps the first occurrence', () => {
    const parsed = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: {
        milestones: [
          { id: 'dup', status: 'available', floor: 1 },
          { id: 'other', status: 'satisfied', floor: 2 },
          { id: 'dup', status: 'missed', floor: 3 },
        ],
        updatedAt: '2026-11-21T10:06:00.000Z',
      },
    })))

    expect(parsed?.blackflow?.milestones.map(milestone => milestone.id)).toEqual(['dup', 'other'])
    expect(parsed?.blackflow?.milestones[0]?.status).toBe('available')
  })
})

describe('describeBlackFlowFreshness', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z')
  const at = (elapsedMs: number): string => new Date(now - elapsedMs).toISOString()

  it('classifies timestamps by the 60/180/300 second bands', () => {
    expect(describeBlackFlowFreshness(at(0), now, false)).toBe('current')
    expect(describeBlackFlowFreshness(at(59_999), now, false)).toBe('current')
    expect(describeBlackFlowFreshness(at(60_000), now, false)).toBe('current')
    expect(describeBlackFlowFreshness(at(60_001), now, false)).toBe('recent')
    expect(describeBlackFlowFreshness(at(179_999), now, false)).toBe('recent')
    expect(describeBlackFlowFreshness(at(180_000), now, false)).toBe('recent')
    expect(describeBlackFlowFreshness(at(180_001), now, false)).toBe('stale')
    expect(describeBlackFlowFreshness(at(299_999), now, false)).toBe('stale')
    expect(describeBlackFlowFreshness(at(300_000), now, false)).toBe('stale')
    expect(describeBlackFlowFreshness(at(300_001), now, false)).toBe('unknown')
  })

  it('returns unknown for missing, invalid or future timestamps', () => {
    expect(describeBlackFlowFreshness(null, now, false)).toBe('unknown')
    expect(describeBlackFlowFreshness('', now, false)).toBe('unknown')
    expect(describeBlackFlowFreshness('not-a-time', now, false)).toBe('unknown')
    expect(describeBlackFlowFreshness(at(-1), now, false)).toBe('unknown')
    expect(describeBlackFlowFreshness(at(0), Number.NaN, false)).toBe('unknown')
    expect(describeBlackFlowFreshness(at(0), Number.POSITIVE_INFINITY, false)).toBe('unknown')
  })

  it('always reports terminal regardless of the timestamp', () => {
    expect(describeBlackFlowFreshness(at(0), now, true)).toBe('terminal')
    expect(describeBlackFlowFreshness(null, now, true)).toBe('terminal')
    expect(describeBlackFlowFreshness('not-a-time', now, true)).toBe('terminal')
    expect(describeBlackFlowFreshness(at(-1), now, true)).toBe('terminal')
  })
})

describe('selectBlackFlowAction', () => {
  const route = blackflow().lastRoute
  const resolution = blackflow().lastNodeResolution
  if (!route || !resolution) throw new Error('blackflow fixture is incomplete')

  it('returns null without a blackflow block or any action', () => {
    expect(selectBlackFlowAction(null)).toBeNull()
    expect(selectBlackFlowAction(blackflow({ lastRoute: null, lastNodeResolution: null }))).toBeNull()
  })

  it('returns the only available action', () => {
    expect(selectBlackFlowAction(blackflow({ lastRoute: route, lastNodeResolution: null })))
      .toEqual({ kind: 'route', route })
    expect(selectBlackFlowAction(blackflow({ lastRoute: null, lastNodeResolution: resolution })))
      .toEqual({ kind: 'node', resolution })
  })

  it('prefers the more recently timestamped action', () => {
    const newerRoute = blackflow({
      lastRoute: { ...route, at: '2026-11-21T10:05:40.000Z' },
      lastNodeResolution: { ...resolution, at: '2026-11-21T10:05:30.000Z' },
    })
    const newerResolution = blackflow({
      lastRoute: { ...route, at: '2026-11-21T10:05:20.000Z' },
      lastNodeResolution: { ...resolution, at: '2026-11-21T10:05:30.000Z' },
    })

    expect(selectBlackFlowAction(newerRoute)?.kind).toBe('route')
    expect(selectBlackFlowAction(newerResolution)?.kind).toBe('node')
  })

  it('falls back to the route when timestamps are missing, invalid or equal', () => {
    const missingTimes = blackflow({
      lastRoute: { ...route, at: null },
      lastNodeResolution: { ...resolution, at: null },
    })
    const invalidRouteTime = blackflow({
      lastRoute: { ...route, at: 'not-a-time' },
      lastNodeResolution: { ...resolution, at: '2026-11-21T10:05:30.000Z' },
    })
    const missingNodeTime = blackflow({
      lastRoute: { ...route, at: '2026-11-21T10:05:20.000Z' },
      lastNodeResolution: { ...resolution, at: null },
    })
    const equalTimes = blackflow({
      lastRoute: { ...route, at: '2026-11-21T10:05:30.000Z' },
      lastNodeResolution: { ...resolution, at: '2026-11-21T10:05:30.000Z' },
    })

    expect(selectBlackFlowAction(missingTimes)?.kind).toBe('route')
    expect(selectBlackFlowAction(invalidRouteTime)?.kind).toBe('route')
    expect(selectBlackFlowAction(missingNodeTime)?.kind).toBe('route')
    expect(selectBlackFlowAction(equalTimes)?.kind).toBe('route')
  })
})

describe('blackflow labels', () => {
  it.each([
    ['battle_elite', '精英作战'],
    ['battle_normal', '作战'],
    ['battle_savage', '紧急作战'],
    ['battle_boss', 'Boss'],
    ['duel', '决斗'],
    ['door', '通道'],
    ['employ', '招募'],
    ['expedition', '探险'],
    ['incident', '事件'],
    ['shop', '商店'],
    ['scrap_shop', '废品商店'],
    ['rest', '休整'],
    ['sacrifice', '献祭'],
    ['wish', '许愿'],
    ['final', '终点'],
    ['empty', '空节点'],
    ['evacuate', '撤离'],
    ['hide_battle', '隐藏作战'],
    ['hide_invisible', '隐藏作战'],
  ])('maps node type %s to %s', (value, label) => {
    expect(describeBlackFlowNodeType(value)).toBe(label)
  })

  it('hides unknown or undisplayed node types instead of leaking raw values', () => {
    for (const value of ['light', 'portal', 'unclassified', 'mystery', '', null]) {
      expect(describeBlackFlowNodeType(value)).toBeNull()
    }
  })

  it('maps walk and scrap movements without exposing their internal ids', () => {
    expect(describeBlackFlowMovement('walk')).toBe('步行')
    for (const movement of ['rogue_6_scrap_M_01', 'rogue_6_scrap_M_05', 'rogue_6_scrap_M_16']) {
      expect(describeBlackFlowMovement(movement)).toBe('加工品移动')
    }
    for (const movement of ['rogue_6_scrap_M_00', 'rogue_6_scrap_M_17', 'rogue_6_scrap_M_05 ', 'walk_fast', null]) {
      expect(describeBlackFlowMovement(movement)).toBeNull()
    }
  })

  it.each([
    ['available', '可达成'],
    ['satisfied', '已达成'],
    ['missed', '已错过'],
    ['impossible', '无法达成'],
    ['inactive', '未激活'],
  ])('maps milestone status %s to %s', (value, label) => {
    expect(describeBlackFlowMilestoneStatus(value)).toBe(label)
  })

  it('maps known strategy values and hides unknown ones', () => {
    expect(describeBlackFlowStrategyProfile('burn_with_investment')).toBe('投资后速通到第三层')
    expect(describeBlackFlowStrategyProfile('burn')).toBe('速通到第三层')
    expect(describeBlackFlowStrategyProfile('investment')).toBe('第一层投资后速通')
    expect(describeBlackFlowStrategyProfile('baby_animal')).toBe('培育襁褓动物')
    expect(describeBlackFlowStrategyProfile('mystery_profile')).toBeNull()
    expect(describeBlackFlowStrategyOutcome('burn_completed')).toBe('速通完成')
    expect(describeBlackFlowStrategyOutcome('mystery_outcome')).toBeNull()
    expect(describeBlackFlowTerminationReason('third_floor_reached')).toBe('抵达第三层')
    expect(describeBlackFlowTerminationReason('mystery_reason')).toBeNull()
    expect(describeBlackFlowNextAction('restart_current_run')).toBe('重新开始本局')
    expect(describeBlackFlowNextAction('stop_run')).toBe('停止运行')
    expect(describeBlackFlowNextAction('mystery_action')).toBeNull()
  })

  it('returns null instead of the raw enum for any unknown label', () => {
    const lookups = [
      () => describeBlackFlowNodeType('mystery'),
      () => describeBlackFlowMovement('mystery'),
      () => describeBlackFlowMilestoneStatus('mystery'),
      () => describeBlackFlowStrategyProfile('mystery'),
      () => describeBlackFlowStrategyOutcome('mystery'),
      () => describeBlackFlowTerminationReason('mystery'),
      () => describeBlackFlowNextAction('mystery'),
    ]

    for (const lookup of lookups) {
      expect(lookup()).toBeNull()
    }
  })
})

describe('blackflow isolation', () => {
  it('does not change rounds, settlement, investment or success-rate inputs', () => {
    const base = snapshot()
    const withBlackflow = readRoguelikeRunProgress(runWithProgress(raw({
      blackflow: blackflow({ floor: 9, updatedAt: '2026-11-21T10:09:00.000Z' }),
    })))
    const withoutBlackflow = readRoguelikeRunProgress(runWithProgress(raw({ blackflow: null })))

    expect(withBlackflow).toMatchObject({
      currentRound: 3,
      roundsStarted: 3,
      roundsEnded: 2,
      roundsSettled: 2,
      roundsPassed: 1,
      investment: { rounds: 1, count: 10, total: 300, deposit: 100 },
      recentRounds: base.recentRounds,
    })
    expect(withBlackflow).not.toBeNull()
    expect(withoutBlackflow).not.toBeNull()
    expect(calculateRoguelikeSuccessRate(withBlackflow!.roundsPassed, withBlackflow!.roundsEnded)).toBe(50)
    expect({ ...withBlackflow!, blackflow: null }).toEqual(withoutBlackflow)
  })

  it('carries blackflow through active and terminal view selection', () => {
    const active = selectRoguelikeProgressView({
      mode: 'roguelike',
      run: runWithProgress(raw({ blackflow: blackflow() })),
      lastRun: null,
      hasSnapshot: true,
    })
    const terminal = selectRoguelikeProgressView({
      mode: 'roguelike',
      run: terminalRunWithProgress(raw({ blackflow: blackflow() })),
      lastRun: null,
      hasSnapshot: true,
    })

    expect(active.progress?.blackflow).toEqual(blackflow())
    expect(terminal.progress?.blackflow).toEqual(blackflow())
  })

  it('reads blackflow from the final summary progress', () => {
    const finalProgress = raw({ phase: 'ended', currentRound: null, blackflow: blackflow() })
    const parsed = readRoguelikeSummaryProgress(run({
      result: { summary: { ...summary(), progress: finalProgress } },
    }))

    expect(parsed?.blackflow).toEqual(blackflow())
  })
})
