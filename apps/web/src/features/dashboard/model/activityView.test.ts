// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from './snapshot'
import { buildDashboardActivityView, type DashboardActivityViewInput } from './activityView'

const summary = (overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
  available: false,
  status: 'none',
  clientType: 'Official',
  source: 'maa',
  message: '当前没有刷关活动',
  ...overrides,
})

const view = (overrides: Partial<DashboardActivityViewInput> = {}) => buildDashboardActivityView({
  summary: summary(),
  hasSnapshot: true,
  isRefreshing: false,
  lastRefreshFailed: false,
  lastRefreshError: null,
  lastUpdate: 1_760_000_000_000,
  formatTimestamp: timestamp => `T${timestamp}`,
  ...overrides,
})

describe('buildDashboardActivityView', () => {
  it('shows a real loading phase only while the first snapshot is being read', () => {
    const result = view({ summary: { available: false }, hasSnapshot: false, isRefreshing: true })

    expect(result).toMatchObject({
      phase: 'loading',
      title: '正在获取活动信息',
      duration: '',
    })
    expect(result.title).not.toContain('等待活动数据')
  })

  it('distinguishes a first-load failure from an empty activity', () => {
    const result = view({
      summary: { available: false },
      hasSnapshot: false,
      lastRefreshFailed: true,
      lastRefreshError: '活动服务不可用',
    })

    expect(result).toMatchObject({
      phase: 'unavailable',
      title: '活动数据加载失败',
      duration: '',
      detail: '活动服务不可用',
    })
    expect(result.title).not.toBe('暂无当前刷关活动')
  })

  it('treats a v1 cache without status as refreshing until a refresh completes', () => {
    const result = view({
      summary: { available: true, code: 'OLD', name: '旧活动', clientType: undefined, source: undefined },
    })

    expect(result.phase).toBe('loading')
    expect(result.detail).toBe('')
  })

  it('treats a failed refresh of a v1 cache as stale', () => {
    const result = view({
      summary: { available: true, code: 'OLD', name: '旧活动', clientType: undefined, source: undefined },
      lastRefreshFailed: true,
      lastRefreshError: '网络中断',
    })

    expect(result).toMatchObject({
      phase: 'stale',
      title: '活动信息可能已过期',
      detail: '网络中断',
      meta: '上次成功 T1760000000000',
    })
  })

  it('renders a confirmed empty activity as none', () => {
    const result = view({
      summary: summary({ dataUpdatedAt: 1_760_000_100_000 }),
    })

    expect(result).toEqual({
      phase: 'none',
      title: '暂无当前刷关活动',
      duration: '',
      detail: '官服 · MAA 活动表 · 更新于 T1760000100000',
      meta: '',
    })
  })

  it('renders an active activity with its region, source, and update time', () => {
    const result = view({
      summary: summary({
        available: true,
        status: 'active',
        code: 'YW',
        name: '昨日海',
        source: 'penguin',
        clientType: 'Bilibili',
        dataUpdatedAt: 1_760_000_100_000,
      }),
    })

    expect(result).toEqual({
      phase: 'active',
      title: '昨日海',
      duration: '',
      detail: 'B服 · 企鹅物流 · 更新于 T1760000100000',
      meta: '',
    })
  })

  it('shows a server unavailable snapshot with its reason', () => {
    const result = view({
      summary: summary({
        status: 'unavailable',
        failure: { source: 'maa', message: 'MAA 活动查询失败: 超时' },
      }),
      lastUpdate: 1_760_000_000_000,
    })

    expect(result).toMatchObject({
      phase: 'unavailable',
      title: '无法获取活动信息',
      detail: 'MAA 活动查询失败: 超时',
      meta: '上次成功 T1760000000000',
    })
  })

  it('keeps stale activity data with its last success time', () => {
    const result = view({
      summary: summary({
        available: true,
        status: 'stale',
        code: 'OLD',
        name: '旧活动',
        source: 'maa',
        startTime: 1_760_000_000_000,
        endTime: 1_760_100_000_000,
        stages: ['OLD-1'],
        rerun: true,
        lastSuccessAt: 1_759_000_000_000,
        failure: { source: 'penguin', message: '备用活动数据源不可用: 503' },
      }),
    })

    expect(result).toEqual({
      phase: 'stale',
      title: '旧活动',
      duration: 'T1760000000000 ~ T1760100000000',
      detail: '备用活动数据源不可用: 503',
      meta: '官服 · MAA 活动表 · 上次成功 T1759000000000 · 复刻 · 1 个关卡',
    })
  })

  it('degrades an active snapshot to stale when the latest snapshot refresh failed', () => {
    const result = view({
      summary: summary({
        available: true,
        status: 'active',
        code: 'YW',
        name: '昨日海',
        lastSuccessAt: 1_700_000_000_000,
      }),
      lastRefreshFailed: true,
      lastRefreshError: '掉落服务不可用',
    })

    expect(result).toMatchObject({
      phase: 'stale',
      title: '昨日海',
      detail: '掉落服务不可用',
      meta: '官服 · MAA 活动表 · 上次成功 T1760000000000',
    })
  })

  it('degrades a confirmed empty activity to stale after a failed refresh', () => {
    const result = view({
      lastRefreshFailed: true,
      lastRefreshError: '调度服务不可用',
    })

    expect(result).toMatchObject({
      phase: 'stale',
      title: '活动信息可能已过期',
      detail: '调度服务不可用',
    })
  })

  it('renders multiple active activities with rerun markers and local times', () => {
    const result = view({
      summary: summary({
        available: true,
        status: 'active',
        code: 'TL',
        name: '时间啊，向前！',
        source: 'maa',
        startTime: 1_760_000_000_000,
        endTime: 1_760_100_000_000,
        stages: ['TL-9', 'TL-8'],
        rerun: false,
        activities: [
          {
            code: 'TL',
            name: '时间啊，向前！',
            startTime: 1_760_000_000_000,
            endTime: 1_760_100_000_000,
            stages: ['TL-9', 'TL-8'],
            rerun: false,
          },
          {
            code: 'AT',
            name: '墟',
            startTime: 1_759_000_000_000,
            endTime: 1_759_100_000_000,
            stages: ['AT-8'],
            rerun: true,
          },
        ],
      }),
    })

    expect(result.duration).toBe('T1760000000000 ~ T1760100000000')
    expect(result.detail).not.toContain('T1760000000000')
    expect(result.detail).not.toContain('T1760100000000')
    expect(result.detail).not.toContain('复刻')
    expect(result.detail).toContain('2 个关卡')
    expect(result.activities).toEqual([
      {
        title: '时间啊，向前！',
        detail: 'T1760000000000 ~ T1760100000000 · 2 个关卡',
        rerun: false,
      },
      {
        title: '墟',
        detail: '复刻 · T1759000000000 ~ T1759100000000 · 1 个关卡',
        rerun: true,
      },
    ])
  })

  it('shows a mainline activity by name', () => {
    const result = view({
      summary: summary({
        available: false,
        status: 'active',
        code: undefined,
        name: '相变临界',
      }),
    })

    expect(result).toMatchObject({
      phase: 'active',
      title: '相变临界',
    })
  })

  it('maps every supported client and source label', () => {
    const clients: Array<[string, string]> = [
      ['Official', '官服'],
      ['Bilibili', 'B服'],
      ['YoStarEN', '美服'],
      ['YoStarJP', '日服'],
      ['YoStarKR', '韩服'],
      ['Txwy', '繁中服'],
    ]

    for (const [clientType, label] of clients) {
      const result = view({
        summary: summary({ status: 'active', available: true, name: '活动', clientType, source: 'maa' }),
      })
      expect(result.detail).toContain(label)
    }

    expect(view({ summary: summary({ status: 'active', available: true, name: '活动', source: 'penguin' }) }).detail)
      .toContain('企鹅物流')
  })
})
