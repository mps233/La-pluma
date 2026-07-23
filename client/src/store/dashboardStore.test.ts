// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'la-pluma-dashboard-cache'

const snapshotFixture = {
  activitySummary: {
    available: true,
    code: 'SSS',
    name: '测试活动',
    completion: {
      known: true,
      complete: false,
      completedStages: ['SSS-1'],
      totalStages: 3,
    },
  },
  scheduleSummary: {
    isRunning: false,
    lastTask: '日常流程',
    lastResult: '执行成功',
  },
  trainingSummary: {
    count: 2,
    topNames: ['能天使', '艾雅法拉'],
  },
  dropSummary: {
    count: 1,
    recent: [{ stage: '1-7', items: '固源岩x4' }],
  },
  openStageSummary: {
    open: [{ stage: 'AP-5', name: '采购凭证' }],
    closed: [{ stage: 'CE-6', name: '龙门币' }],
  },
  deviceStats: {
    cpuPct: 24,
    memPct: 61,
    temp: 38,
  },
  temperatureHistory: [36, 37, 38],
}

const businessSnapshotFixture = {
  activitySummary: snapshotFixture.activitySummary,
  scheduleSummary: snapshotFixture.scheduleSummary,
  trainingSummary: snapshotFixture.trainingSummary,
  dropSummary: snapshotFixture.dropSummary,
  openStageSummary: snapshotFixture.openStageSummary,
}

async function persistFixture(savedAt: number) {
  const dashboardModule = await import('./dashboardStore')
  const store = dashboardModule.useDashboardStore.getState()
  dashboardModule.useDashboardStore.setState({
    deviceStats: snapshotFixture.deviceStats,
    temperatureHistory: snapshotFixture.temperatureHistory,
  })
  store.startRefresh()
  store.finishRefresh(savedAt, businessSnapshotFixture)
  return dashboardModule
}

describe('dashboardStore persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('synchronously restores a fresh successful snapshot without runtime state', async () => {
    const savedAt = Date.now()
    await persistFixture(savedAt)

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(persisted).toMatchObject({
      version: 1,
      savedAt,
      snapshot: snapshotFixture,
    })
    expect(Object.keys(persisted).sort()).toEqual(['savedAt', 'snapshot', 'version'])
    expect(persisted.snapshot).not.toHaveProperty('lastUpdate')
    expect(persisted).not.toHaveProperty('hasLoaded')
    expect(persisted).not.toHaveProperty('isRefreshing')
    expect(persisted).not.toHaveProperty('finishRefresh')

    vi.resetModules()
    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored).toMatchObject({
      ...snapshotFixture,
      hasLoaded: true,
      isRefreshing: false,
      lastUpdate: savedAt,
      lastRefreshAttemptAt: savedAt,
    })
  })

  it('restores a stale snapshot so the dashboard can refresh it in the background', async () => {
    const savedAt = Date.now() - 7 * 24 * 60 * 60 * 1000
    await persistFixture(savedAt)

    vi.resetModules()
    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(true)
    expect(restored.lastUpdate).toBe(savedAt)
    expect(restored.lastRefreshAttemptAt).toBe(savedAt)
    expect(restored.activitySummary).toEqual(snapshotFixture.activitySummary)
  })

  it('restores the nullable device fields returned by the real endpoint', async () => {
    const savedAt = Date.now()
    const dashboardModule = await import('./dashboardStore')
    dashboardModule.useDashboardStore.setState({
      deviceStats: {
        cpuPct: null,
        load1m: null,
        memPct: null,
        diskPct: null,
        temp: null,
        diskUsed: null,
        diskTotal: null,
      },
      temperatureHistory: [],
    })
    dashboardModule.useDashboardStore.getState().finishRefresh(savedAt, businessSnapshotFixture)

    vi.resetModules()
    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(true)
    expect(restored.deviceStats).toMatchObject({
      cpuPct: null,
      load1m: null,
      memPct: null,
      diskPct: null,
      temp: null,
    })
  })

  it('merges the latest device sample when a business refresh commits', async () => {
    const dashboardModule = await import('./dashboardStore')
    const store = dashboardModule.useDashboardStore.getState()
    store.startRefresh()
    store.updateDeviceStats({ cpuPct: 44, temp: 39 })
    store.finishRefresh(Date.now(), businessSnapshotFixture)

    const state = dashboardModule.useDashboardStore.getState()
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(state.deviceStats).toEqual({ cpuPct: 44, temp: 39 })
    expect(state.temperatureHistory).toEqual([39])
    expect(persisted.snapshot.deviceStats).toEqual({ cpuPct: 44, temp: 39 })
    expect(persisted.snapshot.temperatureHistory).toEqual([39])
  })

  it('ignores an invalid device sample before it can poison the cache', async () => {
    const dashboardModule = await import('./dashboardStore')
    const store = dashboardModule.useDashboardStore.getState()
    store.updateDeviceStats({ cpuPct: 101, temp: 39 })
    store.finishRefresh(Date.now(), businessSnapshotFixture)

    const state = dashboardModule.useDashboardStore.getState()
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(state.deviceStats).toBeNull()
    expect(state.temperatureHistory).toEqual([])
    expect(persisted.snapshot.deviceStats).toBeNull()
    expect(persisted.snapshot.temperatureHistory).toEqual([])
  })

  it('falls back to an empty cache when persisted JSON is corrupt', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-json')

    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(false)
    expect(restored.isRefreshing).toBe(false)
    expect(restored.lastUpdate).toBeNull()
    expect(restored.lastRefreshAttemptAt).toBeNull()
  })

  it('ignores a cache from an unsupported version', async () => {
    await persistFixture(Date.now())
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persisted, version: 999 }))

    vi.resetModules()
    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(false)
    expect(restored.lastUpdate).toBeNull()
    expect(restored.activitySummary).toEqual({ available: false })
  })

  it('does not replace the last successful cache after a failed refresh', async () => {
    const successfulAt = Date.now() - 60_000
    const dashboardModule = await persistFixture(successfulAt)
    const successfulCache = window.localStorage.getItem(STORAGE_KEY)
    const store = dashboardModule.useDashboardStore.getState()

    store.startRefresh()
    store.finishRefresh(Date.now())

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(successfulCache)
    expect(dashboardModule.useDashboardStore.getState().trainingSummary).toEqual(snapshotFixture.trainingSummary)
    expect(dashboardModule.useDashboardStore.getState().lastUpdate).toBe(successfulAt)
  })

  it('rejects timestamps beyond the clock-skew allowance', async () => {
    const now = Date.now()
    const dashboardModule = await persistFixture(now)
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    persisted.savedAt = now + dashboardModule.DASHBOARD_CACHE_MAX_FUTURE_SKEW_MS + 10_000
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    vi.resetModules()
    const { useDashboardStore } = await import('./dashboardStore')
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(false)
    expect(restored.lastUpdate).toBeNull()
  })

  it('clamps a small future timestamp to the current clock', async () => {
    const now = Date.now()
    await persistFixture(now)
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    persisted.savedAt = now + 30_000
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    vi.resetModules()
    const beforeRestore = Date.now()
    const { useDashboardStore } = await import('./dashboardStore')
    const afterRestore = Date.now()
    const restored = useDashboardStore.getState()

    expect(restored.hasLoaded).toBe(true)
    expect(restored.lastUpdate).toBeGreaterThanOrEqual(beforeRestore)
    expect(restored.lastUpdate).toBeLessThanOrEqual(afterRestore)
    expect(restored.lastRefreshAttemptAt).toBe(restored.lastUpdate)
  })

  it('rejects cached snapshots with invalid semantic bounds', async () => {
    const now = Date.now()
    await persistFixture(now)
    const validPayload = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    const invalidPayloads = [
      {
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          trainingSummary: { count: -1, topNames: [] },
        },
      },
      {
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          activitySummary: {
            ...validPayload.snapshot.activitySummary,
            completion: {
              ...validPayload.snapshot.activitySummary.completion,
              totalStages: 1.5,
            },
          },
        },
      },
      {
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          deviceStats: { ...validPayload.snapshot.deviceStats, cpuPct: 101 },
        },
      },
      {
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          temperatureHistory: Array.from({ length: 37 }, () => 36),
        },
      },
      {
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          openStageSummary: {
            ...validPayload.snapshot.openStageSummary,
            open: Array.from({ length: 101 }, (_, index) => ({ stage: `S-${index}`, name: '关卡' })),
          },
        },
      },
    ]

    for (const payload of invalidPayloads) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      vi.resetModules()
      const { useDashboardStore } = await import('./dashboardStore')
      expect(useDashboardStore.getState().hasLoaded).toBe(false)
    }
  })
})
