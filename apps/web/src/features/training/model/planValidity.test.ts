import { describe, expect, it } from 'vitest'
import {
  canApplyTrainingPlan,
  canGenerateTrainingPlan,
  captureTrainingPlanBasis,
  isTrainingPlanBasisCurrent,
} from './planValidity'

describe('training plan validity', () => {
  it('captures a stable basis from the queue revision, settings revision, and context', () => {
    expect(captureTrainingPlanBasis('queue-1', 3)).toEqual({
      queueRevision: 'queue-1',
      settingsRevision: 3,
      gameDate: null,
      clientType: null,
    })
    expect(captureTrainingPlanBasis(undefined, 0)).toEqual({
      queueRevision: null,
      settingsRevision: 0,
      gameDate: null,
      clientType: null,
    })
    expect(captureTrainingPlanBasis('queue-1', 3, {
      gameDate: '2026-11-22',
      clientType: 'Official',
    })).toEqual({
      queueRevision: 'queue-1',
      settingsRevision: 3,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })
  })

  it('keeps a plan current only while all four basis items match', () => {
    const basis = captureTrainingPlanBasis('queue-1', 2, {
      gameDate: '2026-11-22',
      clientType: 'Official',
    })

    expect(isTrainingPlanBasisCurrent(basis, {
      queueRevision: 'queue-1',
      settingsRevision: 2,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })).toBe(true)
    expect(isTrainingPlanBasisCurrent(basis, {
      queueRevision: 'queue-2',
      settingsRevision: 2,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })).toBe(false)
    expect(isTrainingPlanBasisCurrent(basis, {
      queueRevision: 'queue-1',
      settingsRevision: 3,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })).toBe(false)
    expect(isTrainingPlanBasisCurrent(basis, {
      queueRevision: 'queue-1',
      settingsRevision: 2,
      gameDate: '2026-11-23',
      clientType: 'Official',
    })).toBe(false)
    expect(isTrainingPlanBasisCurrent(basis, {
      queueRevision: 'queue-1',
      settingsRevision: 2,
      gameDate: '2026-11-22',
      clientType: 'Bilibili',
    })).toBe(false)
  })

  it('keeps the legacy revision-only comparison when both sides lack context', () => {
    const basis = captureTrainingPlanBasis('queue-1', 2)

    expect(isTrainingPlanBasisCurrent(basis, { queueRevision: 'queue-1', settingsRevision: 2 }))
      .toBe(true)
    expect(isTrainingPlanBasisCurrent(basis, { queueRevision: 'queue-2', settingsRevision: 2 }))
      .toBe(false)
  })

  it('does not invalidate when only one side knows the game context', () => {
    const withContext = captureTrainingPlanBasis('queue-1', 2, {
      gameDate: '2026-11-22',
      clientType: 'Official',
    })
    const withoutContext = captureTrainingPlanBasis('queue-1', 2)

    expect(isTrainingPlanBasisCurrent(withContext, {
      queueRevision: 'queue-1',
      settingsRevision: 2,
    })).toBe(true)
    expect(isTrainingPlanBasisCurrent(withoutContext, {
      queueRevision: 'queue-1',
      settingsRevision: 2,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })).toBe(true)
  })

  it('does not generate without a queue or while the queue refresh failed', () => {
    expect(canGenerateTrainingPlan({ hasQueue: true, busy: false, refreshFailed: false }))
      .toBe(true)
    expect(canGenerateTrainingPlan({ hasQueue: false, busy: false, refreshFailed: false }))
      .toBe(false)
    expect(canGenerateTrainingPlan({ hasQueue: true, busy: true, refreshFailed: false }))
      .toBe(false)
    expect(canGenerateTrainingPlan({ hasQueue: true, busy: false, refreshFailed: true }))
      .toBe(false)
  })

  it('does not apply a plan once its basis changed or the queue refresh failed', () => {
    expect(canApplyTrainingPlan({
      hasPlan: true,
      busy: false,
      refreshFailed: false,
      basisCurrent: true,
    })).toBe(true)
    expect(canApplyTrainingPlan({
      hasPlan: true,
      busy: false,
      refreshFailed: false,
      basisCurrent: false,
    })).toBe(false)
    expect(canApplyTrainingPlan({
      hasPlan: true,
      busy: false,
      refreshFailed: true,
      basisCurrent: true,
    })).toBe(false)
    expect(canApplyTrainingPlan({
      hasPlan: false,
      busy: false,
      refreshFailed: false,
      basisCurrent: true,
    })).toBe(false)
  })
})
