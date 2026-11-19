import { describe, expect, it } from 'vitest'
import type { AutomationAvailableTask, TaskCommandId, TaskParams } from '../types'
import {
  addTaskToFlow,
  findTaskFlowValidationFailure,
  insertTaskFlowItem,
  orderStagesForEditing,
  removeTaskFlowItem,
  resolveTaskCommandId,
  toggleTaskFlowItemEnabled,
  updateTaskFlowParams,
  type TaskFlowEntry,
} from './taskFlowCommands'

const definition = (
  id: TaskCommandId,
  defaultParams: TaskParams = {},
): AutomationAvailableTask => ({
  id,
  name: `${id}任务`,
  icon: null,
  description: `${id}说明`,
  defaultParams,
  paramFields: [{ key: 'accountName', label: '说明', type: 'text' }],
  taskType: id === 'infrast' ? 'Infrast' : undefined,
})

const flowItem = (
  id: string,
  commandId: TaskCommandId,
  overrides: Partial<TaskFlowEntry> = {},
): TaskFlowEntry => ({
  id,
  commandId,
  name: id,
  description: '',
  defaultParams: {},
  params: {},
  enabled: true,
  ...overrides,
})

describe('automation task command identity', () => {
  it('prefers commandId and falls back to the id prefix for legacy drafts', () => {
    expect(resolveTaskCommandId({ id: 'fight-1700000000000', commandId: 'fight' })).toBe('fight')
    expect(resolveTaskCommandId({ id: 'fight-1700000000000' })).toBe('fight')
    expect(resolveTaskCommandId({ id: 'closedown-legacy', commandId: 'closedown' })).toBe('closedown')
    expect(resolveTaskCommandId({ id: '' })).toBe('')
  })
})

describe('automation task flow adding', () => {
  it('copies default params into a fresh persisted task without UI fields', () => {
    const fight = definition('fight', {
      stages: [{ stage: '1-7', times: '1' }],
      drops: '',
      series: '1',
    })
    const { task, flow } = addTaskToFlow([], fight, 1_700_000_000_000)

    expect(task.id).toBe('fight-1700000000000')
    expect(task.commandId).toBe('fight')
    expect(task.name).toBe('fight任务')
    expect(task.enabled).toBe(true)
    expect(task.params).toEqual(fight.defaultParams)
    expect(task.params).not.toBe(fight.defaultParams)
    expect('icon' in task).toBe(false)
    expect('paramFields' in task).toBe(false)
    expect(task.defaultParams).toEqual(fight.defaultParams)
    expect(flow).toEqual([task])
  })

  it('keeps closedown last when adding a regular task', () => {
    const flow = [
      flowItem('startup-1', 'startup'),
      flowItem('closedown-1', 'closedown'),
      flowItem('recruit-1', 'recruit'),
    ]
    const added = addTaskToFlow(flow, definition('fight'), 2)

    expect(added.flow.map(item => item.id)).toEqual([
      'startup-1',
      'recruit-1',
      'fight-2',
      'closedown-1',
    ])
    expect(flow).toHaveLength(3)
  })

  it('appends closedown last and inherits the startup client type', () => {
    const flow = [
      flowItem('startup-1', 'startup', { params: { clientType: 'Bilibili' } }),
      flowItem('fight-1', 'fight'),
      flowItem('closedown-1', 'closedown', { params: { clientType: 'Official' } }),
    ]
    const added = addTaskToFlow(flow, definition('closedown', { clientType: 'YoStarEN' }), 3)

    expect(added.flow[added.flow.length - 1]?.id).toBe('closedown-3')
    expect(added.task.params.clientType).toBe('Bilibili')
    expect(added.flow.map(item => item.id)).toEqual([
      'startup-1',
      'fight-1',
      'closedown-1',
      'closedown-3',
    ])
  })

  it('falls back to Official when startup has no client type and keeps defaults without startup', () => {
    const withStartup = addTaskToFlow(
      [flowItem('startup-1', 'startup')],
      definition('closedown', { clientType: 'YoStarEN' }),
      4,
    )
    const withoutStartup = addTaskToFlow([], definition('closedown', { clientType: 'YoStarEN' }), 5)

    expect(withStartup.task.params.clientType).toBe('Official')
    expect(withoutStartup.task.params.clientType).toBe('YoStarEN')
  })
})

describe('automation task flow deleting and restoring', () => {
  it('restores a deleted task at its original index and keeps closedown last', () => {
    const stored = flowItem('recruit-1', 'recruit')
    const restored = insertTaskFlowItem([
      flowItem('startup-1', 'startup'),
      flowItem('closedown-1', 'closedown'),
    ], stored, 1)

    expect(restored.map(item => item.id)).toEqual(['startup-1', 'recruit-1', 'closedown-1'])
    expect(restored[1]).toBe(stored)
  })

  it('clamps an out-of-range restore index into the flow', () => {
    const flow = [flowItem('startup-1', 'startup'), flowItem('closedown-1', 'closedown')]
    const stored = flowItem('fight-1', 'fight')

    expect(insertTaskFlowItem(flow, stored, 9).map(item => item.id))
      .toEqual(['startup-1', 'fight-1', 'closedown-1'])
    expect(insertTaskFlowItem(flow, stored, -1).map(item => item.id))
      .toEqual(['fight-1', 'startup-1', 'closedown-1'])
  })

  it('removes a task immutably and ignores an unknown index', () => {
    const flow = [flowItem('startup-1', 'startup'), flowItem('fight-1', 'fight')]

    expect(removeTaskFlowItem(flow, 0).map(item => item.id)).toEqual(['fight-1'])
    expect(removeTaskFlowItem(flow, 9)).toEqual(flow)
    expect(removeTaskFlowItem(flow, 9)).not.toBe(flow)
    expect(flow).toHaveLength(2)
  })

  it('toggles enabled immutably and returns the same flow for an unknown index', () => {
    const flow = [flowItem('startup-1', 'startup'), flowItem('fight-1', 'fight')]
    const toggled = toggleTaskFlowItemEnabled(flow, 1)

    expect(toggled.map(item => item.enabled)).toEqual([true, false])
    expect(flow.map(item => item.enabled)).toEqual([true, true])
    expect(toggleTaskFlowItemEnabled(flow, 9)).toBe(flow)
  })
})

describe('automation stage ordering', () => {
  it('groups pinned, smart, normal and blank rows while keeping input order', () => {
    const ordered = orderStagesForEditing([
      { stage: 'CE-6', times: '1' },
      { stage: 'AP-5', times: '3', smart: true },
      '',
      { stage: '1-7', times: '2', pinned: true },
      'LS-6',
      { stage: '', times: '', pinned: true },
    ])

    expect(ordered).toEqual([
      { stage: '1-7', times: '2', pinned: true },
      { stage: 'AP-5', times: '3', smart: true },
      { stage: 'CE-6', times: '1' },
      'LS-6',
      '',
      { stage: '', times: '', pinned: true },
    ])
  })

  it('classifies every row exactly once, including a row with both flags', () => {
    const stages = [
      '1-7',
      { stage: 'AP-5', smart: true, pinned: true },
      { stage: 'CE-6' },
      { stage: '', times: '0' },
    ]
    const ordered = orderStagesForEditing(stages)
    const fingerprint = (stage: string | { stage: string }) => JSON.stringify(stage)

    expect(ordered).toHaveLength(stages.length)
    expect(ordered.map(fingerprint).sort()).toEqual(stages.map(fingerprint).sort())
    expect(ordered[0]).toEqual({ stage: 'AP-5', smart: true, pinned: true })
  })
})

describe('automation task parameter updates', () => {
  const flow = (): TaskFlowEntry[] => [
    flowItem('startup-1', 'startup', { params: { clientType: 'Official' } }),
    flowItem('fight-1', 'fight', {
      params: {
        stages: ['CE-6', { stage: '', times: '' }, { stage: '1-7', pinned: true }],
        drops: '',
      },
    }),
    flowItem('closedown-1', 'closedown', { params: { clientType: 'Official' } }),
  ]

  it('orders stages on the edited task only and keeps other tasks untouched', () => {
    const updated = updateTaskFlowParams(flow(), 1, 'stages', [
      'CE-6',
      { stage: '1-7', times: '2', pinned: true },
      { stage: '', times: '' },
    ])

    expect(updated[1]?.params.stages).toEqual([
      { stage: '1-7', times: '2', pinned: true },
      'CE-6',
      { stage: '', times: '' },
    ])
    expect(updated[0]).toEqual(flow()[0])
    expect(updated[2]).toEqual(flow()[2])
  })

  it('leaves non-stage arrays untouched', () => {
    const updated = updateTaskFlowParams(flow(), 1, 'facility', ['Mfg', 'Trade'])

    expect(updated[1]?.params.facility).toEqual(['Mfg', 'Trade'])
  })

  it('synchronizes client type between startup and closedown in both directions', () => {
    const fromStartup = updateTaskFlowParams(flow(), 0, 'clientType', 'Bilibili')
    const fromClosedown = updateTaskFlowParams(flow(), 2, 'clientType', 'YoStarJP')

    expect(fromStartup[0]?.params.clientType).toBe('Bilibili')
    expect(fromStartup[2]?.params.clientType).toBe('Bilibili')
    expect(fromStartup[1]?.params.clientType).toBeUndefined()
    expect(fromClosedown[0]?.params.clientType).toBe('YoStarJP')
    expect(fromClosedown[2]?.params.clientType).toBe('YoStarJP')
  })

  it('does not synchronize without an explicit command id and ignores an unknown index', () => {
    const legacy = [
      flowItem('startup-1', 'startup'),
      flowItem('closedown-1', 'closedown', { commandId: undefined }),
    ]
    const updated = updateTaskFlowParams(legacy, 0, 'clientType', 'Bilibili')
    const snapshot = flow()

    expect(updated[1]?.params.clientType).toBeUndefined()
    expect(updateTaskFlowParams(snapshot, 9, 'drops', 'x')).toBe(snapshot)
  })
})

describe('automation execution validation', () => {
  it('accepts a valid flow and an unset drop target', () => {
    expect(findTaskFlowValidationFailure([
      flowItem('startup-1', 'startup'),
      flowItem('fight-1', 'fight', { params: { drops: '' } }),
      flowItem('fight-2', 'fight', { params: { drops: { 30011: 10 } } }),
      flowItem('closedown-1', 'closedown'),
    ])).toBeNull()
  })

  it('requires a schedule file for enabled custom shift mode', () => {
    const failure = findTaskFlowValidationFailure([
      flowItem('startup-1', 'startup'),
      flowItem('infrast-1', 'infrast', {
        taskType: 'Infrast',
        params: { mode: '10000', filename: '  ' },
      }),
    ])

    expect(failure).toEqual({ taskId: 'infrast-1', message: '自定义换班需要填写排班文件路径' })
  })

  it('ignores disabled tasks and filled schedule files', () => {
    expect(findTaskFlowValidationFailure([
      flowItem('infrast-1', 'infrast', {
        taskType: 'Infrast',
        params: { mode: '10000', filename: '' },
        enabled: false,
      }),
      flowItem('infrast-2', 'infrast', {
        taskType: 'Infrast',
        params: { mode: '10000', filename: 'schedules/base.json' },
      }),
    ])).toBeNull()
  })

  it('rejects an invalid drop target on enabled fight tasks, including legacy ids', () => {
    expect(findTaskFlowValidationFailure([
      flowItem('fight-1', 'fight', { params: { drops: '30011' } }),
    ])).toEqual({
      taskId: 'fight-1',
      message: '掉落目标格式应为物品 ID=数量，多个目标用逗号分隔',
    })

    const legacyFight = flowItem('fight-legacy', 'fight', { commandId: undefined, params: { drops: '0=0' } })
    expect(findTaskFlowValidationFailure([legacyFight])?.taskId).toBe('fight-legacy')
    expect(findTaskFlowValidationFailure([
      { ...legacyFight, enabled: false },
    ])).toBeNull()
  })


  it('rejects out-of-range fight series and expiry days before submission', () => {
    expect(findTaskFlowValidationFailure([
      flowItem('fight-1', 'fight', { params: { series: '11' } }),
    ])).toEqual({
      taskId: 'fight-1',
      message: '连战倍率应为 -1 至 10 的整数',
    })
    expect(findTaskFlowValidationFailure([
      flowItem('fight-1', 'fight', { params: { medicineExpireDays: '-1' } }),
    ])).toEqual({
      taskId: 'fight-1',
      message: '临期药天数应为不小于 0 的整数',
    })
    expect(findTaskFlowValidationFailure([
      flowItem('fight-1', 'fight', { params: { series: '10', medicineExpireDays: '3' } }),
    ])).toBeNull()
  })

  it('rejects a negative recruit permit reserve and an unsupported tag strategy', () => {
    expect(findTaskFlowValidationFailure([
      flowItem('recruit-1', 'recruit', {
        taskType: 'Recruit',
        params: { level3_recruitment_permit_reserve: -1 },
      }),
    ])).toEqual({
      taskId: 'recruit-1',
      message: '3 星保留招聘许可应为不小于 0 的整数',
    })
    expect(findTaskFlowValidationFailure([
      flowItem('recruit-1', 'recruit', {
        taskType: 'Recruit',
        params: { extra_tags_mode: 3 },
      }),
    ])).toEqual({
      taskId: 'recruit-1',
      message: '公招多选 Tag 策略无效',
    })
    expect(findTaskFlowValidationFailure([
      flowItem('recruit-1', 'recruit', {
        taskType: 'Recruit',
        params: { force_refresh: true, level3_recruitment_permit_reserve: 8, extra_tags_mode: 2 },
      }),
    ])).toBeNull()
  })

  it('reports the custom shift problem before a drop target problem', () => {
    const failure = findTaskFlowValidationFailure([
      flowItem('fight-1', 'fight', { params: { drops: 'invalid' } }),
      flowItem('infrast-1', 'infrast', {
        taskType: 'Infrast',
        params: { mode: '10000', filename: '' },
      }),
    ])

    expect(failure?.taskId).toBe('infrast-1')
  })
})

describe('automation task flow serialization', () => {
  it('round-trips a created task through JSON with the persisted shape', () => {
    const fight = definition('fight', { stages: [{ stage: '1-7', times: '1' }], drops: '' })
    const { flow } = addTaskToFlow([flowItem('startup-1', 'startup')], fight, 6)

    const serialized = JSON.parse(JSON.stringify(flow)) as TaskFlowEntry[]
    expect(serialized).toEqual(flow)
    expect(serialized[1]).toEqual({
      id: 'fight-6',
      commandId: 'fight',
      name: 'fight任务',
      description: 'fight说明',
      defaultParams: { stages: [{ stage: '1-7', times: '1' }], drops: '' },
      params: { stages: [{ stage: '1-7', times: '1' }], drops: '' },
      enabled: true,
    })
  })

  it('keeps the persisted shape after a parameter edit', () => {
    const updated = updateTaskFlowParams(
      [flowItem('fight-1', 'fight', { params: { stages: [] } })],
      0,
      'stages',
      ['1-7'],
    )
    const serialized = JSON.parse(JSON.stringify(updated)) as TaskFlowEntry[]

    expect(serialized[0]?.params.stages).toEqual(['1-7'])
    expect('icon' in serialized[0]!).toBe(false)
    expect('paramFields' in serialized[0]!).toBe(false)
  })
})
