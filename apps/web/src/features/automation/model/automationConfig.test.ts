// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTOMATION_CONFIG_COMMIT_DELAY_MS,
  AUTOMATION_CONFIG_KEY,
  AUTOMATION_CONFIG_PENDING_KEY,
  AUTOMATION_LOCAL_WRITE_DELAY_MS,
  AUTOMATION_SCHEDULE_KEY,
  AUTOMATION_TASK_FLOW_KEY,
  automationConfigAdapter,
  createDefaultAutomationDraft,
  type AutomationConfigDraft,
} from './automationConfig'
import { activeScheduleTimes, createDefaultScheduleEntries } from './automationSchedule'
import { addTaskToFlow } from './taskFlowCommands'

const mocks = vi.hoisted(() => ({
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
}))

vi.mock('@/features/user-config', () => ({
  USER_CONFIG_KEYS: { combatTasks: 'combat-tasks',
    roguelikeTasks: 'roguelike-tasks',
    automationTasks: 'automation-tasks' },
  USER_CONFIG_PENDING_KEYS: { 'combat-tasks': 'combatConfigSyncPending',
    'roguelike-tasks': 'roguelikeConfigSyncPending',
    'automation-tasks': 'automationConfigSyncPending' },
  loadUserConfig: mocks.loadUserConfig,
  saveUserConfig: mocks.saveUserConfig,
}))

vi.mock('../api', () => ({
  setupSchedule: mocks.setupSchedule,
  stopSchedule: mocks.stopSchedule,
}))

const taskFlow = [
  {
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    description: '启动游戏并进入主界面',
    enabled: true,
    params: { clientType: 'Bilibili', accountName: '' },
  },
  {
    id: 'recruit-1',
    commandId: 'recruit',
    name: '自动公招',
    description: '自动公开招募',
    enabled: true,
    params: { refresh: true, skip_robot: true },
  },
  {
    id: 'closedown-1',
    commandId: 'closedown',
    name: '关闭游戏',
    description: '关闭游戏客户端',
    enabled: true,
    params: {},
  },
]

const draft: AutomationConfigDraft = {
  taskFlow: taskFlow as AutomationConfigDraft['taskFlow'],
  schedule: {
    enabled: true,
    entries: [
      { time: '08:00', enabled: true },
      { time: '14:00', enabled: false },
    ],
  },
}

const taskFlowFixtureForFetch = [
  {
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    description: '启动游戏并进入主界面',
    enabled: true,
    params: { clientType: 'Official', accountName: '' },
  },
]

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  mocks.loadUserConfig.mockReset()
  mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
  mocks.setupSchedule.mockReset().mockResolvedValue({ success: true })
  mocks.stopSchedule.mockReset().mockResolvedValue({ success: true })
})

describe('automation config adapter', () => {
  it('round trips cultivation plans with omitted professions and theme candidates through local and server drafts', () => {
    const gameDraft: AutomationConfigDraft = {
      ...createDefaultAutomationDraft(),
      taskFlow: [
        { id: 'operprogress-1', commandId: 'operprogress', taskType: 'OperProgress', name: '游戏内培养', description: '', defaultParams: {}, enabled: true, params: { plans: [{ name: '阿米娅', elite: 2, skill_level: 7, skill_mastery: [0, 3, 0] }] } },
        { id: 'switchtheme-1', commandId: 'switchtheme', taskType: 'SwitchTheme', name: '更换游戏主题', description: '', defaultParams: {}, enabled: true, params: { themes: ['明日方舟', '新主题'] } },
      ],
    }
    automationConfigAdapter.writeLocalDraft(gameDraft)
    expect(automationConfigAdapter.readLocalDraft()?.taskFlow).toEqual(gameDraft.taskFlow)
    const wire = automationConfigAdapter.encodeDraft(gameDraft)
    expect(automationConfigAdapter.decodeDraft(wire)?.taskFlow).toEqual(gameDraft.taskFlow)
  })

  it('keeps the original config key, pending key, local keys, and debounced persistence policy', () => {
    expect(automationConfigAdapter).toMatchObject({
      key: 'automation-tasks',
      pendingKey: 'automationConfigSyncPending',
      commitDelayMs: 300,
      localWriteDelayMs: 250,
    })
    expect({
      config: AUTOMATION_CONFIG_KEY,
      pending: AUTOMATION_CONFIG_PENDING_KEY,
      taskFlow: AUTOMATION_TASK_FLOW_KEY,
      schedule: AUTOMATION_SCHEDULE_KEY,
      commitDelay: AUTOMATION_CONFIG_COMMIT_DELAY_MS,
      localWriteDelay: AUTOMATION_LOCAL_WRITE_DELAY_MS,
    }).toEqual({
      config: 'automation-tasks',
      pending: 'automationConfigSyncPending',
      taskFlow: 'maa-task-flow',
      schedule: 'maa-schedule',
      commitDelay: 300,
      localWriteDelay: 250,
    })
  })

  it('encodes only the persisted task fields and enabled schedule times', () => {
    const withUiFields = {
      ...draft,
      taskFlow: draft.taskFlow.map(task => ({
        ...task,
        icon: 'icon-node',
        paramFields: [{ key: 'clientType' }],
      })),
    } as unknown as AutomationConfigDraft

    const wire = automationConfigAdapter.encodeDraft(withUiFields)

    expect(wire.schedule).toEqual({ enabled: true, times: ['08:00'] })
    expect(activeScheduleTimes(draft.schedule.entries)).toEqual(['08:00'])
    expect(wire.taskFlow[0]).not.toHaveProperty('icon')
    expect(wire.taskFlow[0]).not.toHaveProperty('paramFields')
    expect(Object.keys(wire).sort()).toEqual(['schedule', 'taskFlow'])
  })

  it('decodes the server payload with existing migrations, connection sync, and closedown last', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [
        taskFlow[2],
        taskFlow[0],
        { ...taskFlow[1], params: { refresh: true, skip_robot: true } },
      ],
      schedule: { enabled: true, times: ['08:00', '20:00', '08:00'] },
    })

    expect(decoded).not.toBeNull()
    expect(decoded!.taskFlow.map(task => task.id)).toEqual(['startup-1', 'recruit-1', 'closedown-1'])
    expect(decoded!.taskFlow[1]?.params).toMatchObject({
      refresh: true,
      preserve_tags: '支援机械',
      force_refresh: true,
      first_tags: '',
      extra_tags_mode: 0,
      recruitment_time: { '3': 540, '4': 540 },
    })
    expect(decoded!.taskFlow[1]?.params).not.toHaveProperty('skip_robot')
    expect(decoded!.taskFlow[2]?.params).toMatchObject({
      clientType: 'Bilibili',
      recognizeDepotBeforeClose: true,
      recognizeOperBoxBeforeClose: false,
    })
    expect(decoded!.schedule).toEqual({
      enabled: true,
      entries: [
        { time: '08:00', enabled: true },
        { time: '20:00', enabled: true },
      ],
    })
  })

  it('keeps an explicitly enabled operator recognition on saved closedown tasks', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [{
        id: 'closedown-1',
        commandId: 'closedown',
        name: '关闭游戏',
        enabled: true,
        params: { recognizeOperBoxBeforeClose: true },
      }],
    })

    expect(decoded).not.toBeNull()
    expect(decoded!.taskFlow[0]?.params).toMatchObject({
      recognizeDepotBeforeClose: true,
      recognizeOperBoxBeforeClose: true,
    })
  })

  it('normalizes legacy custom infrastructure task parameters without touching the schedule file', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [{
        id: 'infrast-1',
        name: '基建换班',
        commandId: 'infrast',
        taskType: 'Infrast',
        enabled: true,
        params: { mode: '10000', filename: ' schedules/base.json ', plan_index: '2', facility: [] },
      }],
    })

    expect(decoded).not.toBeNull()
    expect(decoded!.taskFlow[0]?.params).toMatchObject({
      filename: 'schedules/base.json',
      plan_index: 2,
      continue_training: false,
      dorm_notstationed_enabled: false,
      dorm_trust_enabled: false,
      reception_message_board: true,
      reception_clue_exchange: true,
      reception_send_clue: true,
    })
  })

  it('keeps local-only disabled entries and falls back to default times', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      schedule: {
        enabled: false,
        entries: [
          { time: '08:00', enabled: false },
          { time: '14:00', enabled: true },
        ],
      },
    })

    expect(decoded!.schedule).toEqual({
      enabled: false,
      entries: [
        { time: '08:00', enabled: false },
        { time: '14:00', enabled: true },
      ],
    })

    expect(automationConfigAdapter.decodeDraft({ schedule: { enabled: false, times: [] } })!.schedule)
      .toEqual({ enabled: false, entries: createDefaultScheduleEntries() })
    expect(automationConfigAdapter.decodeDraft({})).toEqual(createDefaultAutomationDraft())
  })

  it('preserves local-only disabled entries when adopting a server payload', () => {
    localStorage.setItem(AUTOMATION_SCHEDULE_KEY, JSON.stringify({
      enabled: true,
      entries: [
        { time: '08:00', enabled: true },
        { time: '14:00', enabled: false },
      ],
    }))

    const decoded = automationConfigAdapter.decodeDraft({
      schedule: { enabled: true, times: ['08:00', '20:00'] },
    })

    expect(decoded!.schedule).toEqual({
      enabled: true,
      entries: [
        { time: '08:00', enabled: true },
        { time: '14:00', enabled: false },
        { time: '20:00', enabled: true },
      ],
    })
  })

  it('fingerprints local schedule entries so disabled-row edits are not treated as no-ops', () => {
    const base: AutomationConfigDraft = {
      ...draft,
      taskFlow: [],
      schedule: {
        enabled: true,
        entries: [
          { time: '08:00', enabled: true },
          { time: '14:00', enabled: false },
        ],
      },
    }
    const edited: AutomationConfigDraft = {
      ...base,
      schedule: {
        enabled: true,
        entries: [
          { time: '08:00', enabled: true },
          { time: '15:00', enabled: false },
        ],
      },
    }
    const removed: AutomationConfigDraft = {
      ...base,
      schedule: { enabled: true, entries: [{ time: '08:00', enabled: true }] },
    }
    const fingerprint = automationConfigAdapter.fingerprint!

    // 禁用项不进入 wire，但本地草稿指纹必须能区分编辑与删除。
    expect(automationConfigAdapter.encodeDraft(base)).toEqual(automationConfigAdapter.encodeDraft(edited))
    expect(automationConfigAdapter.encodeDraft(base)).toEqual(automationConfigAdapter.encodeDraft(removed))
    expect(fingerprint(edited)).not.toBe(fingerprint(base))
    expect(fingerprint(removed)).not.toBe(fingerprint(base))
  })

  it.each([
    ['a non-object payload', null],
    ['an array payload', []],
    ['a non-array task flow', { taskFlow: {} }],
    ['a task without an id', { taskFlow: [{ name: '启动游戏' }] }],
    ['a non-object schedule', { schedule: [] }],
    ['a non-boolean schedule flag', { schedule: { enabled: 'true' } }],
    ['a non-array times list', { schedule: { times: '08:00' } }],
  ])('rejects %s so the caller can fall back to the local draft', (_label, payload) => {
    expect(automationConfigAdapter.decodeDraft(payload)).toBeNull()
  })

  it('normalizes legacy tasks with catalog defaults, derived commands, and readable names', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [
        { id: 'fight-1', params: { medicine: 2 } },
        { id: 'startup-2' },
        { id: 'custom-1', params: { legacy: true } },
        { id: 'custom-2', name: '自定义任务' },
      ],
    })

    expect(decoded).not.toBeNull()
    const [fight, startup, custom, namedCustom] = decoded!.taskFlow
    expect(fight).toMatchObject({
      commandId: 'fight',
      name: '理智作战',
      description: '自动刷关卡消耗理智',
      enabled: true,
      params: {
        medicine: 2,
        stages: [{ stage: '1-7', times: '' }],
        medicineExpireDays: 0,
        DrGrandet: false,
      },
    })
    expect(startup).toMatchObject({
      commandId: 'startup',
      name: '启动游戏',
      enabled: true,
      params: { clientType: 'Official', accountName: '', start_game_enabled: true },
    })
    expect(custom).toMatchObject({
      commandId: 'custom',
      name: 'custom',
      enabled: true,
      params: { legacy: true },
    })
    expect(namedCustom).toMatchObject({
      commandId: 'custom',
      name: '自定义任务',
      enabled: true,
      params: {},
    })
  })

  it('keeps unknown command params through decode, local read, and encode', () => {
    const params = { legacy: 7, nested: { mode: 'custom' } }
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [{ id: 'custom-1', name: '自定义任务', params }],
    })!

    expect(decoded.taskFlow[0]?.params).toEqual(params)

    automationConfigAdapter.writeLocalDraft(decoded)
    const local = automationConfigAdapter.readLocalDraft()!

    expect(local.taskFlow[0]?.params).toEqual(params)
    expect(automationConfigAdapter.encodeDraft(local).taskFlow[0]?.params).toEqual(params)
  })

  it('keeps explicit task fields and params over the catalog defaults', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [{
        id: 'startup-1',
        commandId: 'startup',
        name: '自定义启动',
        description: '自定义说明',
        taskType: 'Manual',
        enabled: false,
        params: { clientType: 'Bilibili', accountName: 'doctor' },
      }],
    })

    expect(decoded!.taskFlow[0]).toMatchObject({
      commandId: 'startup',
      name: '自定义启动',
      description: '自定义说明',
      taskType: 'Manual',
      enabled: false,
      params: {
        clientType: 'Bilibili',
        accountName: 'doctor',
        start_game_enabled: true,
      },
    })
  })

  it('recovers tasks with non-object params and non-boolean enabled flags', () => {
    const decoded = automationConfigAdapter.decodeDraft({
      taskFlow: [{ id: 'startup-1', params: [], enabled: 'yes' }],
    })

    expect(decoded!.taskFlow[0]).toMatchObject({
      commandId: 'startup',
      enabled: true,
      params: { clientType: 'Official', start_game_enabled: true },
    })

    const unknown = automationConfigAdapter.decodeDraft({
      taskFlow: [{ id: 'custom-1', params: [] }],
    })!
    expect(unknown.taskFlow[0]?.params).toEqual({})
  })

  it('normalizes legacy local drafts on read', () => {
    localStorage.setItem(
      AUTOMATION_TASK_FLOW_KEY,
      JSON.stringify([{ id: 'recruit-1', params: { times: '2' } }]),
    )

    const read = automationConfigAdapter.readLocalDraft()

    expect(read?.taskFlow[0]).toMatchObject({
      commandId: 'recruit',
      name: '自动公招',
      enabled: true,
      params: {
        times: '2',
        refresh: true,
        preserve_tags: '支援机械',
        recruitment_time: { '3': 540, '4': 540 },
      },
    })
  })

  it('reads and writes the original local draft layout symmetrically', () => {
    automationConfigAdapter.writeLocalDraft(draft)

    expect(JSON.parse(localStorage.getItem(AUTOMATION_TASK_FLOW_KEY) ?? 'null')).toEqual(draft.taskFlow)
    expect(JSON.parse(localStorage.getItem(AUTOMATION_SCHEDULE_KEY) ?? 'null')).toEqual({
      enabled: true,
      times: ['08:00'],
      entries: draft.schedule.entries,
    })
    const read = automationConfigAdapter.readLocalDraft()
    expect(read?.schedule).toEqual(draft.schedule)
    expect(read?.taskFlow.map(task => task.id)).toEqual(draft.taskFlow.map(task => task.id))
    expect(read?.taskFlow[1]?.params).toMatchObject({
      preserve_tags: '支援机械',
      recruitment_time: { '3': 540, '4': 540 },
    })
  })

  it('cleans a damaged local key and keeps the readable part', () => {
    localStorage.setItem(AUTOMATION_TASK_FLOW_KEY, '{not-json')
    localStorage.setItem(AUTOMATION_SCHEDULE_KEY, JSON.stringify({ enabled: true, times: ['09:30'] }))

    expect(automationConfigAdapter.readLocalDraft()).toEqual({
      taskFlow: [],
      schedule: { enabled: true, entries: [{ time: '09:30', enabled: true }] },
    })
    expect(localStorage.getItem(AUTOMATION_TASK_FLOW_KEY)).toBeNull()
    expect(localStorage.getItem(AUTOMATION_SCHEDULE_KEY)).not.toBeNull()
  })

  it('returns null when the whole local draft is unusable', () => {
    localStorage.setItem(AUTOMATION_TASK_FLOW_KEY, '{not-json')
    localStorage.setItem(AUTOMATION_SCHEDULE_KEY, '[]')

    expect(automationConfigAdapter.readLocalDraft()).toBeNull()
    expect(localStorage.getItem(AUTOMATION_TASK_FLOW_KEY)).toBeNull()
    expect(localStorage.getItem(AUTOMATION_SCHEDULE_KEY)).toBeNull()
  })

  it('commits the config and the enabled schedule as one unit', async () => {
    const wire = automationConfigAdapter.encodeDraft(draft)

    await expect(automationConfigAdapter.commit(wire)).resolves.toEqual({ ok: true })
    expect(mocks.saveUserConfig).toHaveBeenCalledWith('automation-tasks', {
      taskFlow: wire.taskFlow,
      schedule: { enabled: true, times: ['08:00'] },
    })
    expect(mocks.setupSchedule).toHaveBeenCalledWith('default', ['08:00'], wire.taskFlow)
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
  })

  it('stops the server schedule when disabled or every entry is disabled', async () => {
    const disabledWire = automationConfigAdapter.encodeDraft({
      ...draft,
      schedule: { enabled: false, entries: draft.schedule.entries },
    })
    await automationConfigAdapter.commit(disabledWire)
    expect(mocks.stopSchedule).toHaveBeenLastCalledWith('default')

    const allDisabledWire = automationConfigAdapter.encodeDraft({
      ...draft,
      schedule: {
        enabled: true,
        entries: [
          { time: '08:00', enabled: false },
          { time: '14:00', enabled: false },
        ],
      },
    })
    await automationConfigAdapter.commit(allDisabledWire)
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).toHaveBeenCalledTimes(2)
  })

  it('does not touch the server schedule when the config save fails', async () => {
    mocks.saveUserConfig.mockResolvedValueOnce({ success: false, message: '配置存储暂不可用' })
    const wire = automationConfigAdapter.encodeDraft(draft)

    await expect(automationConfigAdapter.commit(wire))
      .resolves.toEqual({ ok: false, message: '配置存储暂不可用' })
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
  })

  it('keeps a schedule failure retryable after the config was saved', async () => {
    mocks.setupSchedule.mockResolvedValueOnce({ success: false, message: '排班设置失败' })
    const wire = automationConfigAdapter.encodeDraft(draft)

    await expect(automationConfigAdapter.commit(wire))
      .resolves.toEqual({ ok: false, message: '排班设置失败' })
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.setupSchedule).toHaveBeenCalledOnce()
  })

  it('does not apply a stale schedule step when a newer draft appears during the config save', async () => {
    const save = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(save.promise)
    const wire = automationConfigAdapter.encodeDraft(draft)

    const commit = automationConfigAdapter.commit(wire)
    automationConfigAdapter.encodeDraft({ ...draft, schedule: { enabled: false, entries: draft.schedule.entries } })
    await Promise.resolve()
    save.resolve({ success: true })

    await expect(commit).resolves.toEqual({ ok: false, message: '配置已更新，本次定时设置未提交' })
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
  })

  it('turns transport failures into retryable results', async () => {
    const wire = automationConfigAdapter.encodeDraft(draft)
    mocks.saveUserConfig.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(automationConfigAdapter.commit(wire))
      .resolves.toEqual({ ok: false, message: 'Failed to fetch' })

    mocks.saveUserConfig.mockResolvedValueOnce({ success: true })
    mocks.setupSchedule.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(automationConfigAdapter.commit(wire))
      .resolves.toEqual({ ok: false, message: 'Failed to fetch' })

    mocks.saveUserConfig.mockResolvedValueOnce({ success: true })
    mocks.setupSchedule.mockRejectedValueOnce('offline')
    await expect(automationConfigAdapter.commit(wire))
      .resolves.toEqual({ ok: false, message: '暂时无法连接服务器' })
  })

  it('fetches through the user-config endpoint with the coordinator signal', async () => {
    const controller = new AbortController()
    const payload = { taskFlow: taskFlowFixtureForFetch, schedule: { enabled: true, times: ['08:00'] } }
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: payload })

    await expect(automationConfigAdapter.fetch({ signal: controller.signal }))
      .resolves.toEqual({ ok: true, payload })
    expect(mocks.loadUserConfig).toHaveBeenCalledWith('automation-tasks', controller.signal)
  })

  it('reports load failures without throwing', async () => {
    mocks.loadUserConfig.mockResolvedValueOnce({ success: false, message: '后端不可用' })
    await expect(automationConfigAdapter.fetch({ signal: new AbortController().signal }))
      .resolves.toEqual({ ok: false, message: '后端不可用' })

    mocks.loadUserConfig.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(automationConfigAdapter.fetch({ signal: new AbortController().signal }))
      .resolves.toEqual({ ok: false, message: 'Failed to fetch' })
  })
})

describe('legacy fight expiring medicine migration', () => {
  const legacyFightDraft = (params: Record<string, unknown>) => ({
    taskFlow: [{
      id: 'fight-1',
      commandId: 'fight',
      name: '理智作战',
      description: '自动刷关卡消耗理智',
      enabled: true,
      params: {
        stage: '1-7',
        stages: [{ stage: '1-7', times: '3' }],
        medicine: 0,
        stone: 0,
        series: '1',
        drops: '',
        clientType: '',
        DrGrandet: false,
        report_to_penguin: false,
        penguin_id: '',
        report_to_yituliu: false,
        yituliu_id: '',
        ...params,
      },
    }],
  })

  it('maps a legacy bottle count to the two-day expiry window on the wire', () => {
    const decoded = automationConfigAdapter.decodeDraft(legacyFightDraft({ expiringMedicine: 7 }))

    expect(decoded?.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 2 })
    expect(decoded?.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')

    const wire = automationConfigAdapter.encodeDraft(decoded!)
    expect(wire.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 2 })
    expect(wire.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')
  })

  it.each([
    ['a numeric zero', 0],
    ['a string zero', '0'],
  ])('keeps a disabled legacy %s disabled', (_label, expiringMedicine) => {
    const decoded = automationConfigAdapter.decodeDraft(legacyFightDraft({ expiringMedicine }))

    expect(decoded?.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 0 })
    expect(decoded?.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')
  })

  it('prefers the new expiry-day field when both keys are stored', () => {
    const decoded = automationConfigAdapter.decodeDraft(legacyFightDraft({
      medicineExpireDays: 3,
      expiringMedicine: 7,
    }))

    expect(decoded?.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 3 })
    expect(decoded?.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')
  })

  it('maps any enabled legacy bottle count string to the same window', () => {
    const decoded = automationConfigAdapter.decodeDraft(legacyFightDraft({ expiringMedicine: '4' }))

    expect(decoded?.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 2 })
    expect(decoded?.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')
  })

  it('defaults a null expiry-day field to disabled and keeps the new field authoritative', () => {
    const decoded = automationConfigAdapter.decodeDraft(legacyFightDraft({
      medicineExpireDays: null,
      expiringMedicine: 7,
    }))

    expect(decoded?.taskFlow[0]?.params).toMatchObject({ medicineExpireDays: 0 })
    expect(decoded?.taskFlow[0]?.params).not.toHaveProperty('expiringMedicine')
  })
})

describe('automation command model compatibility', () => {
  it('decodes a flow created by the command model with the existing migrations', () => {
    const { flow } = addTaskToFlow([], {
      id: 'fight',
      name: '理智作战',
      icon: null,
      description: '自动刷关卡消耗理智',
      defaultParams: { stages: [{ stage: '1-7', times: '1' }], drops: '' },
      paramFields: [],
    }, 1_700_000_000_000)

    const decoded = automationConfigAdapter.decodeDraft({ taskFlow: flow })

    expect(decoded?.taskFlow).toHaveLength(1)
    expect(decoded?.taskFlow[0]).toMatchObject({
      id: 'fight-1700000000000',
      commandId: 'fight',
      enabled: true,
      params: {
        stages: [{ stage: '1-7', times: '1' }],
        drops: '',
        clientType: '',
        DrGrandet: false,
      },
    })
    expect(decoded?.taskFlow[0]).not.toHaveProperty('icon')
    expect(decoded?.taskFlow[0]).not.toHaveProperty('paramFields')
  })
})
