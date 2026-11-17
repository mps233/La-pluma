import { create } from 'zustand'
import {
  isActivityCompletion,
  isActivityEntry,
  MAX_ACTIVITY_STAGES,
} from '@/features/automation'
import { DASHBOARD_CACHE_MAX_FUTURE_SKEW_MS } from '../constants'
import type {
  ActivitySummary,
  DashboardBusinessSnapshot,
  DropSummary,
  OpenStageSummary,
  ScheduleSummary,
  TrainingSummary,
} from '../model/snapshot'

const DASHBOARD_CACHE_STORAGE_KEY = 'la-pluma-dashboard-cache'
const DASHBOARD_CACHE_VERSION = 1

const MAX_TRAINING_NAMES = 10
const MAX_RECENT_DROPS = 50
const MAX_OPEN_STAGE_ITEMS = 100
const MAX_TEMPERATURE_SAMPLES = 36

interface DeviceStats {
  cpuPct?: number | null
  load1m?: number | null
  memPct?: number | null
  memUsed?: string | null
  memTotal?: string | null
  diskPct?: number | null
  diskUsed?: string | null
  diskTotal?: string | null
  temp?: number | null
}

interface DashboardSnapshot {
  activitySummary: ActivitySummary
  scheduleSummary: ScheduleSummary
  trainingSummary: TrainingSummary
  dropSummary: DropSummary
  openStageSummary: OpenStageSummary
  deviceStats: DeviceStats | null
  temperatureHistory: number[]
  lastUpdate: number | null
}

type DashboardSnapshotData = Omit<DashboardSnapshot, 'lastUpdate'>

interface DashboardCacheState extends DashboardSnapshot {
  hasLoaded: boolean
  isRefreshing: boolean
  lastRefreshAttemptAt: number | null
  /**
   * 最近一次快照刷新失败的原因；只存在于运行期，不持久化。
   * 卡片据此把旧活动标为可能过期，而不是把失败伪装成空活动。
   */
  lastRefreshError: string | null
  /**
   * 最近一次投影到温度历史的采样时间（Query 的 `dataUpdatedAt`）。
   * 不持久化：只用于抑制 Activity 恢复或重挂载时同一份缓存样本重复追加。
   */
  lastDeviceSampleAt: number | null
  startRefresh: () => void
  finishRefresh: (attemptedAt: number, snapshot?: DashboardBusinessSnapshot, error?: string) => void
  updateDeviceStats: (stats: unknown, sampleAt?: number) => void
  reset: () => void
}

type PersistedDashboardSnapshot = DashboardSnapshotData

interface PersistedDashboardCache {
  version: typeof DASHBOARD_CACHE_VERSION
  savedAt: number
  snapshot: PersistedDashboardSnapshot
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const isTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)
const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)
const isPercentage = (value: unknown): value is number => (
  isFiniteNumber(value) && value >= 0 && value <= 100
)

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalTimestamp = (value: unknown) => value === undefined || isTimestamp(value)
const isStringArray = (value: unknown, maxLength: number): value is string[] => (
  Array.isArray(value)
  && value.length <= maxLength
  && value.every(item => typeof item === 'string')
)

const ACTIVITY_STATUSES = ['active', 'none', 'unavailable', 'stale'] as const

const isActivityStatus = (value: unknown): boolean => (
  typeof value === 'string' && (ACTIVITY_STATUSES as readonly string[]).includes(value)
)

const isActivityFailure = (value: unknown): boolean => (
  isRecord(value)
  && typeof value.source === 'string'
  && value.source.length > 0
  && typeof value.message === 'string'
)

function isActivitySummary(value: unknown): value is ActivitySummary {
  if (!isRecord(value) || typeof value.available !== 'boolean') return false
  if (value.status !== undefined && !isActivityStatus(value.status)) return false
  if (!isOptionalString(value.code)
    || !isOptionalString(value.name)
    || !isOptionalString(value.clientType)
    || !isOptionalString(value.message)
    || !isOptionalString(value.source)) {
    return false
  }
  if (value.rerun !== undefined && typeof value.rerun !== 'boolean') return false
  if (value.activities !== undefined) {
    if (!Array.isArray(value.activities)
      || value.activities.length > MAX_ACTIVITY_STAGES
      || !value.activities.every(isActivityEntry)) {
      return false
    }
  }
  if (!isOptionalTimestamp(value.startTime)
    || !isOptionalTimestamp(value.endTime)
    || !isOptionalTimestamp(value.lastSuccessAt)
    || !isOptionalTimestamp(value.dataUpdatedAt)) {
    return false
  }
  if (value.stages !== undefined && !isStringArray(value.stages, MAX_ACTIVITY_STAGES)) return false
  if (value.failure !== undefined && !isActivityFailure(value.failure)) return false
  return value.completion === undefined || isActivityCompletion(value.completion)
}

function isScheduleSummary(value: unknown): value is ScheduleSummary {
  return isRecord(value)
    && typeof value.isRunning === 'boolean'
    && isOptionalString(value.currentTask)
    && isOptionalString(value.message)
    && isOptionalString(value.lastTask)
    && isOptionalString(value.lastResult)
}

function isTrainingSummary(value: unknown): value is TrainingSummary {
  return isRecord(value)
    && isNonNegativeInteger(value.count)
    && isStringArray(value.topNames, MAX_TRAINING_NAMES)
}

function isDropSummary(value: unknown): value is DropSummary {
  return isRecord(value)
    && isNonNegativeInteger(value.count)
    && (value.items === undefined || typeof value.items === 'string')
    && Array.isArray(value.recent)
    && value.recent.length <= MAX_RECENT_DROPS
    && value.recent.every(item => (
      isRecord(item) && typeof item.stage === 'string' && typeof item.items === 'string'
    ))
}

function isOpenStageSummary(value: unknown): value is OpenStageSummary {
  const isStageList = (items: unknown) => (
    Array.isArray(items)
    && items.length <= MAX_OPEN_STAGE_ITEMS
    && items.every(item => (
      isRecord(item) && typeof item.stage === 'string' && typeof item.name === 'string'
    ))
  )

  return isRecord(value) && isStageList(value.open) && isStageList(value.closed)
}

function isDeviceStats(value: unknown): value is DeviceStats | null {
  if (value === null) return true
  if (!isRecord(value)) return false

  return ['cpuPct', 'memPct', 'diskPct']
    .every(key => value[key] == null || isPercentage(value[key]))
    && (value.load1m == null || (isFiniteNumber(value.load1m) && value.load1m >= 0))
    && (value.temp == null || isFiniteNumber(value.temp))
    && ['memUsed', 'memTotal', 'diskUsed', 'diskTotal']
      .every(key => value[key] == null || typeof value[key] === 'string')
}

function isDashboardBusinessSnapshot(
  value: unknown,
): value is DashboardBusinessSnapshot & Record<string, unknown> {
  if (!isRecord(value)) return false

  return isActivitySummary(value.activitySummary)
    && isScheduleSummary(value.scheduleSummary)
    && isTrainingSummary(value.trainingSummary)
    && isDropSummary(value.dropSummary)
    && isOpenStageSummary(value.openStageSummary)
}

function isPersistedDashboardCache(value: unknown): value is PersistedDashboardCache {
  if (!isRecord(value)
    || value.version !== DASHBOARD_CACHE_VERSION
    || !isTimestamp(value.savedAt)
    || !isRecord(value.snapshot)) {
    return false
  }

  const snapshot = value.snapshot
  return isDashboardBusinessSnapshot(snapshot)
    && isDeviceStats(snapshot.deviceStats)
    && Array.isArray(snapshot.temperatureHistory)
    && snapshot.temperatureHistory.length <= MAX_TEMPERATURE_SAMPLES
    && snapshot.temperatureHistory.every(isFiniteNumber)
}

function getDashboardStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function persistedSnapshotFrom(state: DashboardSnapshot): PersistedDashboardSnapshot {
  return {
    activitySummary: state.activitySummary,
    scheduleSummary: state.scheduleSummary,
    trainingSummary: state.trainingSummary,
    dropSummary: state.dropSummary,
    openStageSummary: state.openStageSummary,
    deviceStats: state.deviceStats,
    temperatureHistory: state.temperatureHistory,
  }
}

function persistDashboardCache(state: DashboardSnapshot) {
  if (!isTimestamp(state.lastUpdate)) return
  const storage = getDashboardStorage()
  if (!storage) return

  const payload: PersistedDashboardCache = {
    version: DASHBOARD_CACHE_VERSION,
    savedAt: state.lastUpdate,
    snapshot: persistedSnapshotFrom(state),
  }
  if (!isPersistedDashboardCache(payload)) return

  try {
    storage.setItem(DASHBOARD_CACHE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Persistence is an optimization; runtime dashboard state remains usable.
  }
}

function restoreDashboardCache() {
  const storage = getDashboardStorage()
  if (!storage) return null

  try {
    const serialized = storage.getItem(DASHBOARD_CACHE_STORAGE_KEY)
    if (!serialized) return null
    const payload: unknown = JSON.parse(serialized)
    if (!isPersistedDashboardCache(payload)) return null
    const now = Date.now()
    if (payload.savedAt > now + DASHBOARD_CACHE_MAX_FUTURE_SKEW_MS) return null
    const restoredAt = Math.min(payload.savedAt, now)

    return {
      ...payload.snapshot,
      lastUpdate: restoredAt,
      hasLoaded: true,
      isRefreshing: false,
      lastRefreshAttemptAt: restoredAt,
      lastRefreshError: null,
      lastDeviceSampleAt: null,
    }
  } catch {
    return null
  }
}

function clearDashboardCache() {
  const storage = getDashboardStorage()
  if (!storage) return
  try {
    storage.removeItem(DASHBOARD_CACHE_STORAGE_KEY)
  } catch {
    // Keep reset usable even when storage is unavailable.
  }
}

const initialSnapshot = (): DashboardSnapshot => ({
  activitySummary: { available: false },
  scheduleSummary: { isRunning: false },
  trainingSummary: { count: 0, topNames: [] },
  dropSummary: { count: 0, recent: [] },
  openStageSummary: { open: [], closed: [] },
  deviceStats: null,
  temperatureHistory: [],
  lastUpdate: null,
})

const emptyCacheState = () => ({
  ...initialSnapshot(),
  hasLoaded: false,
  isRefreshing: false,
  lastRefreshAttemptAt: null,
  lastRefreshError: null,
  lastDeviceSampleAt: null,
})

const initialCacheState = () => restoreDashboardCache() ?? emptyCacheState()

export const useDashboardStore = create<DashboardCacheState>((set, get) => ({
  ...initialCacheState(),
  startRefresh: () => set({ isRefreshing: true }),
  finishRefresh: (attemptedAt, snapshot, error) => {
    const validSnapshot = snapshot && isDashboardBusinessSnapshot(snapshot) ? snapshot : undefined
    set(state => validSnapshot
      ? {
          ...validSnapshot,
          deviceStats: state.deviceStats,
          temperatureHistory: state.temperatureHistory,
          hasLoaded: true,
          isRefreshing: false,
          lastRefreshAttemptAt: attemptedAt,
          lastRefreshError: null,
          lastUpdate: attemptedAt,
        }
      : {
          hasLoaded: true,
          isRefreshing: false,
          lastRefreshAttemptAt: attemptedAt,
          lastRefreshError: error ?? '刷新失败',
          lastUpdate: state.lastUpdate,
        })
    if (validSnapshot) persistDashboardCache(get())
  },
  updateDeviceStats: (deviceStats, sampleAt) => {
    if (!isDeviceStats(deviceStats) || deviceStats === null) return
    // 同一份采样（相同 dataUpdatedAt 的缓存回放）只追加一次温度点：Activity
    // 恢复会重跑页面 Effect，但 Query 缓存里的样本没有变化。同一毫秒内
    // 产生了新的采样对象时仍按新样本处理。
    const state = get()
    if (sampleAt != null && state.lastDeviceSampleAt != null) {
      if (sampleAt < state.lastDeviceSampleAt) return
      if (sampleAt === state.lastDeviceSampleAt && deviceStats === state.deviceStats) return
    }
    set(current => ({
      deviceStats,
      temperatureHistory: Number.isFinite(deviceStats.temp)
        ? [...current.temperatureHistory, Number(deviceStats.temp)].slice(-36)
        : current.temperatureHistory,
      lastDeviceSampleAt: sampleAt ?? current.lastDeviceSampleAt,
    }))
  },
  reset: () => {
    clearDashboardCache()
    set(emptyCacheState())
  },
}))
