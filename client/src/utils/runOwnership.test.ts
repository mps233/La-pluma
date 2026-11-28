import { describe, expect, it } from 'vitest'

import type { AgentRun } from '../types/run'
import { selectOwnedRun } from './runOwnership'

const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  runId: 'run-1',
  operationId: 'run_task',
  state: 'running',
  metadata: { taskType: 'combat' },
  ...overrides,
})

describe('selectOwnedRun', () => {
  it('returns the run when an operation id matches', () => {
    const value = run({ operationId: 'depot_recognition', metadata: null })
    expect(selectOwnedRun(value, { operationIds: ['depot_recognition'] })).toBe(value)
  })

  it('returns the run when the task type matches', () => {
    const value = run({ metadata: { taskType: 'roguelike' } })
    expect(selectOwnedRun(value, { taskTypes: ['roguelike'] })).toBe(value)
  })

  it('rejects other pages, inactive runs, and missing metadata', () => {
    expect(selectOwnedRun(run({ metadata: { taskType: 'schedule' } }), { taskTypes: ['combat'] })).toBeNull()
    expect(selectOwnedRun(run({ state: 'succeeded' }), { taskTypes: ['combat'] })).toBeNull()
    expect(selectOwnedRun(null, { taskTypes: ['combat'] })).toBeNull()
    expect(selectOwnedRun(run({ metadata: null }), { operationIds: ['run_copilot_set'] })).toBeNull()
  })

  it('treats a waiting manual run as idle when requested', () => {
    const value = run({ state: 'waiting', operationId: 'run_copilot_set_manual' })
    const ownership = { operationIds: ['run_copilot_set_manual'], waitingIsIdle: true }
    expect(selectOwnedRun(value, ownership)).toBeNull()
    expect(selectOwnedRun(value, { ...ownership, waitingIsIdle: false })).toBe(value)
  })

  it('accepts every active state', () => {
    for (const state of ['accepted', 'waiting', 'running', 'stopping'] as const) {
      expect(selectOwnedRun(run({ state }), { taskTypes: ['combat'] })?.state).toBe(state)
    }
  })
})
