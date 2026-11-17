// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { AutomationActivityPayload } from '@/features/automation'
import {
  normalizeDashboardSnapshot,
  type DashboardSnapshotPayloads,
} from './snapshot'

const activityDto = (overrides: Partial<AutomationActivityPayload> = {}): AutomationActivityPayload => ({
  status: 'active',
  clientType: 'Official',
  available: true,
  message: '当前活动: 昨日海',
  code: 'YW',
  name: '昨日海',
  source: 'maa',
  startTime: null,
  endTime: null,
  stages: [],
  lastSuccessAt: 1_760_000_000_000,
  dataUpdatedAt: 1_760_000_000_000,
  failure: null,
  completion: {
    known: true,
    complete: false,
    completedStages: ['YW-1'],
    totalStages: 3,
    source: 'local-activity-progress',
  },
  ...overrides,
})

const validPayloads = (): DashboardSnapshotPayloads => ({
  activity: activityDto(),
  scheduleExecution: {
    isRunning: true,
    taskName: '收取信用',
    message: '正在执行',
    lastResult: {
      successCount: 2,
      failedCount: 1,
      skippedCount: 0,
      durationMs: 61_000,
      actions: [{ task: '收取信用' }],
    },
  },
  trainingQueue: {
    queue: [
      { operator: { name: '能天使' } },
      { name: '艾雅法拉' },
      { operatorName: '银灰' },
      { nickname: '第四位' },
    ],
  },
  todayDrops: [
    { stageName: '1-7', drops: [{ name: '固源岩', count: 4 }] },
    { stageCode: 'CE-6', items: [{ itemName: '龙门币', count: 3 }] },
    { stage: 'AP-5' },
  ],
  openTodayStages: {
    open: [{ stage: 'AP-5', name: '采购凭证' }],
    closed: [{ stage: 'CE-6', name: '龙门币' }],
  },
})

describe('normalizeDashboardSnapshot', () => {
  it('normalizes all five business payloads into one complete snapshot', () => {
    const snapshot = normalizeDashboardSnapshot(validPayloads())

    expect(snapshot).not.toBeNull()
    expect(snapshot?.activitySummary).toMatchObject({
      available: true,
      status: 'active',
      clientType: 'Official',
      message: '当前活动: 昨日海',
      code: 'YW',
      name: '昨日海',
      source: 'maa',
      stages: [],
      lastSuccessAt: 1_760_000_000_000,
      dataUpdatedAt: 1_760_000_000_000,
      completion: {
        known: true,
        complete: false,
        completedStages: ['YW-1'],
        totalStages: 3,
        source: 'local-activity-progress',
      },
    })
    expect(snapshot?.activitySummary).not.toHaveProperty('tip')
    expect(snapshot?.activitySummary.startTime).toBeUndefined()
    expect(snapshot?.activitySummary.failure).toBeUndefined()
    expect(snapshot?.scheduleSummary).toEqual({
      isRunning: true,
      currentTask: '收取信用',
      message: '正在执行',
      lastTask: '收取信用',
      lastResult: '成功 2 · 失败 1 · 61 秒',
    })
    expect(snapshot?.trainingSummary).toEqual({
      count: 4,
      topNames: ['能天使', '艾雅法拉', '银灰'],
    })
    expect(snapshot?.dropSummary).toEqual({
      count: 3,
      items: '固源岩×4、龙门币×3',
      recent: [
        { stage: 'AP-5', items: '已记录作战，暂无材料明细' },
        { stage: 'CE-6', items: '龙门币×3' },
        { stage: '1-7', items: '固源岩×4' },
      ],
    })
    expect(snapshot?.openStageSummary).toEqual({
      open: [{ stage: 'AP-5', name: '采购凭证' }],
      closed: [{ stage: 'CE-6', name: '龙门币' }],
    })
  })

  it('keeps the legacy queue array and drops array payload shapes', () => {
    const payloads = validPayloads()
    payloads.trainingQueue = [{ operatorName: '能天使' }]
    payloads.todayDrops = [{ stageName: '1-7', drops: [{ name: '固源岩', count: 4 }] }]

    const snapshot = normalizeDashboardSnapshot(payloads)

    expect(snapshot?.trainingSummary).toEqual({ count: 1, topNames: ['能天使'] })
    expect(snapshot?.dropSummary).toEqual({
      count: 1,
      items: '固源岩×4',
      recent: [{ stage: '1-7', items: '固源岩×4' }],
    })
  })

  it('merges repeated stages of today drops into one accumulated row', () => {
    const payloads = validPayloads()
    payloads.todayDrops = [
      {
        stage: 'TL-9',
        items: [
          { itemId: '4001', name: '龙门币', count: 1008 },
          { itemId: '4002', name: '失败的记录', count: 84 },
          { itemId: '4003', name: '电极单元', count: 2 },
        ],
      },
      {
        stage: 'TL-9',
        items: [
          { itemId: '4001', name: '龙门币', count: 1512 },
          { itemId: '4002', name: '失败的记录', count: 126 },
          { itemId: '4003', name: '电极单元', count: 4 },
        ],
      },
    ]

    expect(normalizeDashboardSnapshot(payloads)?.dropSummary).toEqual({
      count: 2,
      items: '龙门币×2520、失败的记录×210、电极单元×6',
      recent: [{ stage: 'TL-9', items: '龙门币×2520、失败的记录×210、电极单元×6' }],
    })
  })

  it('maps a successful empty activity to none without inventing a code', () => {
    const payloads = validPayloads()
    payloads.activity = activityDto({
      status: 'none',
      available: false,
      code: null,
      name: null,
      source: 'maa',
      message: '当前没有刷关活动',
      lastSuccessAt: 1_760_000_000_000,
      dataUpdatedAt: 1_760_000_000_000,
      completion: undefined,
    })

    const activity = normalizeDashboardSnapshot(payloads)?.activitySummary

    expect(activity).toMatchObject({
      available: false,
      status: 'none',
      clientType: 'Official',
      source: 'maa',
      message: '当前没有刷关活动',
      lastSuccessAt: 1_760_000_000_000,
    })
    expect(activity?.code).toBeUndefined()
    expect(activity?.name).toBeUndefined()
    expect(activity?.failure).toBeUndefined()
  })

  it('preserves an unavailable activity failure instead of treating it as empty', () => {
    const payloads = validPayloads()
    payloads.activity = activityDto({
      status: 'unavailable',
      available: false,
      code: null,
      name: null,
      source: null,
      message: '无法获取活动信息: MAA 活动查询失败: 超时',
      lastSuccessAt: null,
      dataUpdatedAt: null,
      failure: { source: 'maa', message: 'MAA 活动查询失败: 超时' },
      completion: undefined,
    })

    const activity = normalizeDashboardSnapshot(payloads)?.activitySummary

    expect(activity).toMatchObject({
      available: false,
      status: 'unavailable',
      failure: { source: 'maa', message: 'MAA 活动查询失败: 超时' },
    })
    expect(activity?.code).toBeUndefined()
    expect(activity?.lastSuccessAt).toBeUndefined()
    expect(activity?.dataUpdatedAt).toBeUndefined()
  })

  it('preserves stale activity data and its last success time', () => {
    const payloads = validPayloads()
    payloads.activity = activityDto({
      status: 'stale',
      available: true,
      code: 'OLD',
      name: '旧活动',
      lastSuccessAt: 1_700_000_000_000,
      dataUpdatedAt: null,
      failure: { source: 'penguin', message: '备用活动数据源不可用: 503' },
    })

    const activity = normalizeDashboardSnapshot(payloads)?.activitySummary

    expect(activity).toMatchObject({
      available: true,
      status: 'stale',
      code: 'OLD',
      name: '旧活动',
      lastSuccessAt: 1_700_000_000_000,
      failure: { source: 'penguin', message: '备用活动数据源不可用: 503' },
    })
    expect(activity?.dataUpdatedAt).toBeUndefined()
  })

  it('accepts alternative schedule fields without alternative activity fields', () => {
    const payloads = validPayloads()
    payloads.scheduleExecution = {
      running: true,
      currentTask: '备用任务',
      status: '状态说明',
      lastTask: '上次任务',
      lastResult: '上次结果',
    }

    const snapshot = normalizeDashboardSnapshot(payloads)

    expect(snapshot?.scheduleSummary).toEqual({
      isRunning: true,
      currentTask: '备用任务',
      message: '状态说明',
      lastTask: '上次任务',
      lastResult: '上次结果',
    })
  })

  it('does not treat the backend probe as part of the five business payloads', () => {
    const snapshot = normalizeDashboardSnapshot(validPayloads())
    expect(snapshot).not.toBeNull()
  })

  it('returns null when the activity DTO misses its status', () => {
    const payloads = validPayloads()
    const withoutStatus: Record<string, unknown> = { ...activityDto() }
    delete withoutStatus.status
    payloads.activity = withoutStatus

    expect(normalizeDashboardSnapshot(payloads)).toBeNull()
  })

  it('returns null when the activity completion is out of bounds', () => {
    const payloads = validPayloads()
    payloads.activity = {
      ...activityDto(),
      completion: { known: true, totalStages: 1.5 },
    }

    expect(normalizeDashboardSnapshot(payloads)).toBeNull()
  })

  it('returns null when activity stages contain a non-string', () => {
    const payloads = validPayloads()
    payloads.activity = {
      ...activityDto(),
      stages: ['YW-1', 1],
    }

    expect(normalizeDashboardSnapshot(payloads)).toBeNull()
  })

  it.each([
    ['activity is missing', { activity: undefined }],
    ['activity is not a record', { activity: 'ok' }],
    ['activity status is unknown', { activity: activityDto({ status: 'running' as AutomationActivityPayload['status'] }) }],
    ['activity message is missing', { activity: { ...activityDto(), message: undefined } }],
    ['activity completion has non-string stages', {
      activity: { ...activityDto(), completion: { completedStages: ['A', 1] } },
    }],
    ['training queue is not an array', { trainingQueue: { queue: 'none' } }],
    ['training queue item is not a record', { trainingQueue: { queue: ['能天使'] } }],
    ['today drops is neither array nor records envelope', { todayDrops: { records: null } }],
    ['today drops item is not a record', { todayDrops: [null] }],
    ['open stages are missing', { openTodayStages: { open: [] } }],
    ['closed stages item has no name', { openTodayStages: { open: [], closed: [{ stage: 'CE-6' }] } }],
    ['schedule execution is not a record', { scheduleExecution: 42 }],
  ])('returns null when %s', (_label, override) => {
    expect(normalizeDashboardSnapshot({ ...validPayloads(), ...override })).toBeNull()
  })

  it('rejects stage summaries beyond the historical bound', () => {
    const payloads = validPayloads()
    payloads.openTodayStages = {
      open: Array.from({ length: 101 }, (_, index) => ({ stage: `S-${index}`, name: '关卡' })),
      closed: [],
    }

    expect(normalizeDashboardSnapshot(payloads)).toBeNull()
  })

  it('prefers drop name fields before the placeholder text', () => {
    const payloads = validPayloads()
    payloads.todayDrops = [
      { stageName: 'ST-A', itemName: '固源岩' },
      { stageName: 'ST-B', items: [{ name: '装置', count: 0 }] },
      { stageName: 'ST-C', items: 'bad-shape' },
    ]

    expect(normalizeDashboardSnapshot(payloads)?.dropSummary.recent).toEqual([
      { stage: 'ST-C', items: '已记录作战，暂无材料明细' },
      { stage: 'ST-B', items: '装置×1' },
      { stage: 'ST-A', items: '固源岩' },
    ])
  })
})
