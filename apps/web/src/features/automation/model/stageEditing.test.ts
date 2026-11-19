import { describe, expect, it } from 'vitest'
import type { StageConfig } from '../types'
import {
  buildSmartStages,
  createEmptyStage,
  findTrainingOperators,
  flattenStagesForEditing,
  insertSmartStages,
  isSmartStage,
  removeSmartStages,
  removeStageAt,
  resolveStageList,
  setStageName,
  setStageTimes,
  splitStagesForEditing,
  stepStageTimes,
  toggleStagePinned,
} from './stageEditing'

const stage = (name: string, times = '1', extra: Partial<StageConfig> = {}): StageConfig => ({
  stage: name,
  times,
  ...extra,
})

describe('stageEditing', () => {
  it('resolves a missing list to a fresh blank row while keeping an explicit empty list', () => {
    const first = resolveStageList()
    const second = resolveStageList()

    expect(first).toEqual([{ stage: '', times: '' }])
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(resolveStageList([])).toEqual([])

    const existing = [stage('1-7')]
    expect(resolveStageList(existing)).toBe(existing)
  })

  it('creates independent empty rows', () => {
    expect(createEmptyStage()).not.toBe(createEmptyStage())
  })

  it('classifies every row exactly once into pinned, smart, normal and blank groups', () => {
    const stages = [
      { stage: '  ', times: '' },
      stage('CE-6', '2', { smart: true }),
      '1-7',
      stage('AP-5', '1', { pinned: true }),
      stage('LS-6', '1', { pinned: true, smart: true }),
      { stage: '', times: '' },
      stage('S4-1'),
      stage('SK-5', '1', { pinned: false }),
    ]

    const groups = splitStagesForEditing(stages)

    expect(groups.pinned.map(item => item.stage)).toEqual(['AP-5', 'LS-6'])
    expect(groups.smart.map(item => item.stage)).toEqual(['CE-6'])
    expect(groups.normal.map(item => (typeof item === 'string' ? item : item.stage))).toEqual(['1-7', 'S4-1', 'SK-5'])
    expect(groups.blank).toHaveLength(2)
    const flattened = flattenStagesForEditing(groups)
    expect(flattened).toHaveLength(stages.length)
    expect(flattened.map(item => JSON.stringify(item)).sort())
      .toEqual(stages.map(item => JSON.stringify(item)).sort())
  })

  it('reads the last smart stage with operator names and ignores older or empty entries', () => {
    const stages = [
      stage('CE-6', '2', { smart: true, trainingOperators: ['阿米娅'] }),
      stage('AP-5', '1', { smart: true, trainingOperators: ['陈', '能天使'] }),
      stage('LS-6', '1', { smart: true, trainingOperators: [] }),
      '1-7',
    ]

    expect(findTrainingOperators(stages)).toEqual(['陈', '能天使'])
    expect(findTrainingOperators(['1-7'])).toEqual([])
  })

  it('toggles pin state without mutating the original list', () => {
    const original = ['1-7', stage('CE-6', '2'), stage('AP-5', '1', { pinned: true })]

    expect(toggleStagePinned(original, 0)).toEqual([
      { stage: '1-7', times: '', pinned: true },
      stage('CE-6', '2'),
      stage('AP-5', '1', { pinned: true }),
    ])
    expect(toggleStagePinned(original, 1)[1]).toEqual({ ...stage('CE-6', '2'), pinned: true })
    expect(toggleStagePinned(original, 2)[2]).toEqual(stage('AP-5', '1', { pinned: false }))
    expect(original[0]).toBe('1-7')
    expect(toggleStagePinned(original, 0)).not.toBe(original)
  })

  it('keeps smart stages and missing indexes out of pin edits', () => {
    const smart = [stage('AP-5', '1', { smart: true })]

    expect(toggleStagePinned(smart, 0)).toBe(smart)
    expect(toggleStagePinned(['1-7'], 3)).toEqual(['1-7'])
  })

  it('upgrades string rows to the object shape when editing name or times', () => {
    expect(setStageName(['1-7'], 0, 'CE-6')).toEqual([{ stage: 'CE-6', times: '' }])
    expect(setStageName([stage('CE-6', '2')], 0, '1-7')).toEqual([stage('1-7', '2')])
    expect(setStageTimes(['1-7'], 0, '3')).toEqual([{ stage: '1-7', times: '3' }])
    expect(setStageTimes([stage('CE-6', '2')], 0, '5')).toEqual([stage('CE-6', '5')])

    const stages = ['1-7']
    expect(setStageName(stages, 2, 'CE-6')).toBe(stages)
    expect(setStageTimes(stages, 2, '3')).toBe(stages)
  })

  it('steps times from zero and never below zero', () => {
    expect(stepStageTimes(['1-7'], 0, 1)).toEqual([{ stage: '1-7', times: '1' }])
    expect(stepStageTimes([stage('CE-6', '2')], 0, -1)).toEqual([stage('CE-6', '1')])
    expect(stepStageTimes([stage('CE-6', '0')], 0, -1)).toEqual([stage('CE-6', '0')])
    expect(stepStageTimes([stage('CE-6', '')], 0, 1)).toEqual([stage('CE-6', '1')])

    const smart = [stage('AP-5', '1', { smart: true })]
    expect(stepStageTimes(smart, 0, 1)).toBe(smart)
    expect(stepStageTimes(['1-7'], 4, 1)).toEqual(['1-7'])
  })

  it('removes a row and keeps one blank row when the list empties', () => {
    expect(removeStageAt(['1-7', stage('CE-6', '2')], 0)).toEqual([stage('CE-6', '2')])
    expect(removeStageAt(['1-7'], 0)).toEqual([{ stage: '', times: '' }])
    expect(removeStageAt(['1-7'], 5)).toEqual(['1-7'])
  })

  it('removes smart stages while preserving pinned and normal rows', () => {
    const stages = [
      stage('AP-5', '1', { pinned: true }),
      stage('CE-6', '2', { smart: true }),
      '1-7',
      stage('LS-6', '1'),
      { stage: '', times: '' },
    ]

    expect(removeSmartStages(stages)).toEqual([
      stage('AP-5', '1', { pinned: true }),
      '1-7',
      stage('LS-6', '1'),
    ])
    expect(removeSmartStages([stage('CE-6', '2', { smart: true })])).toEqual([{ stage: '', times: '' }])
    expect(stages).toHaveLength(5)
  })

  it('inserts generated smart stages between pinned and normal rows', () => {
    const generated = [stage('AP-5', '3', { smart: true, trainingOperators: ['阿米娅'] })]

    expect(insertSmartStages([stage('CE-6', '2'), stage('1-7', '1', { pinned: true })], generated)).toEqual([
      stage('1-7', '1', { pinned: true }),
      ...generated,
      stage('CE-6', '2'),
    ])
    expect(insertSmartStages([{ stage: '', times: '' }], generated)).toEqual(generated)
    expect(insertSmartStages([{ stage: '', times: '' }], [])).toEqual([{ stage: '', times: '' }])
  })

  it('maps plan stages to smart stage rows with a copied operator list', () => {
    const operators = ['阿米娅']
    const result = buildSmartStages([
      { stage: 'AP-5', totalTimes: 3 },
      { stage: 'CE-6', totalTimes: 1 },
    ], operators)

    expect(result).toEqual([
      { stage: 'AP-5', times: '3', smart: true, trainingOperators: ['阿米娅'] },
      { stage: 'CE-6', times: '1', smart: true, trainingOperators: ['阿米娅'] },
    ])
    expect(result[0]?.trainingOperators).not.toBe(operators)
  })

  it('recognizes smart rows without narrowing normal objects', () => {
    expect(isSmartStage(stage('AP-5', '1', { smart: true }))).toBe(true)
    expect(isSmartStage(stage('AP-5', '1'))).toBe(false)
    expect(isSmartStage('AP-5')).toBe(false)
  })
})
