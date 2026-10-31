// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { TaskFlowItem } from '@/types/components'
import {
  buildDynamicFightCommand,
  getPointerSortTargetIndex,
  hasPointerSortActivated,
  moveTaskFlowItem,
  placeClosedownLast,
} from './AutomationTasks'

const task = (id: string) => ({ id, name: id }) as TaskFlowItem

describe('AutomationTasks dynamic Fight planning', () => {
  const fightTask = (params: Record<string, unknown>) => ({
    id: 'fight-1',
    name: '理智作战',
    commandId: 'fight',
    enabled: true,
    params,
  }) as TaskFlowItem

  it('routes multi-stage fights through one dynamic task config', () => {
    const command = buildDynamicFightCommand(fightTask({
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: '' }],
      stone: 0,
    }))

    expect(command?.command).toBe('run')
    expect(command?.params).toBe('fight')
    const taskConfig = JSON.parse(String(command?.taskConfig))
    expect(taskConfig.tasks.map((item: { params: { stage: string } }) => item.params.stage))
      .toEqual(['1-7', 'CE-6'])
    expect(taskConfig.tasks[0].params.times).toBe(3)
  })

  it('keeps a single-stage fight on the CLI path when no Core-only field is used', () => {
    expect(buildDynamicFightCommand(fightTask({
      stages: [{ stage: '1-7', times: 3 }],
      stone: 0,
    }))).toBeNull()
  })

  it('uses the dynamic path for a single stage when Core-only fields are present', () => {
    const command = buildDynamicFightCommand(fightTask({
      stages: [{ stage: '1-7', times: 1 }],
      medicineExpireDays: 2,
      server: 'JP',
      series: 8,
      stone: 0,
    }))

    expect(command?.command).toBe('run')
    const taskConfig = JSON.parse(String(command?.taskConfig))
    expect(taskConfig.tasks).toHaveLength(1)
    expect(taskConfig.tasks[0].params).toMatchObject({
      medicine_expire_days: 2,
      server: 'JP',
      series: 8,
    })
  })
})

describe('AutomationTasks ordering', () => {
  it('waits for the full 10px pointer threshold', () => {
    expect(hasPointerSortActivated(0, 0, 6, 7)).toBe(false)
    expect(hasPointerSortActivated(0, 0, 6, 8)).toBe(true)
  })

  it('reorders immutably and preserves every task', () => {
    const original = [task('one'), task('two'), task('three')]
    const reordered = moveTaskFlowItem(original, 0, 2)

    expect(reordered.map(item => item.id)).toEqual(['two', 'three', 'one'])
    expect(original.map(item => item.id)).toEqual(['one', 'two', 'three'])
  })

  it('keeps the same flow when a keyboard move would leave the list', () => {
    const original = [task('one'), task('two')]

    expect(moveTaskFlowItem(original, 0, -1)).toBe(original)
    expect(moveTaskFlowItem(original, 1, 2)).toBe(original)
  })

  it('uses insertion slots after removing the dragged item when moving downward', () => {
    const original = [task('a'), task('b'), task('c')]
    const midpointById = new Map([['a', 50], ['b', 150], ['c', 250]])
    const targetIndex = getPointerSortTargetIndex(
      original,
      'a',
      151,
      taskId => midpointById.get(taskId) ?? null,
    )

    expect(targetIndex).toBe(1)
    expect(moveTaskFlowItem(original, 0, targetIndex).map(item => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('keeps closedown last when a deleted task is inserted back after it', () => {
    const restored = [
      task('startup-1'),
      { ...task('closedown-1'), commandId: 'closedown' },
      task('fight-1'),
    ]

    expect(placeClosedownLast(restored).map(item => item.id)).toEqual([
      'startup-1',
      'fight-1',
      'closedown-1',
    ])
  })
})
