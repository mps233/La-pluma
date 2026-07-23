import { create } from 'zustand'

export const DASHBOARD_CACHE_STORAGE_KEY = 'la-pluma-dashboard-cache'
export const DASHBOARD_CACHE_VERSION = 1
export const DASHBOARD_CACHE_MAX_FUTURE_SKEW_MS = 60_000

const MAX_COMPLETED_STAGES = 500
const MAX_TRAINING_NAMES = 10
const MAX_RECENT_DROPS = 50
const MAX_OPEN_STAGE_ITEMS = 100
const MAX_TEMPERATURE_SAMPLES = 36

export interface ActivitySummary {
  available: boolean
  code?: string
  name?: string
  tip?: string
  completion?: {
    known?: boolean
    complete?: boolean
    completedStages?: string[]
    totalStages?: number
  }
}

export interface ScheduleSummary {
  isRunning: boolean
  currentTask?: string
  message?: string
  lastTask?: string
  lastResult?: string
}

export interface TrainingSummary {
  count: number
  topNames: string[]
}

export interface DropSummary {
  count: number
  recent: Array<{
    stage: string
    items: string
  }>
}

export interface OpenStageSummary {
  open: Array<{ stage: string; name: string }>
  closed: Array<{ stage: string; name: string }>
}

export interface DeviceStats {
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

export interface DashboardSnapshot {
  activitySummary: ActivitySummary
  scheduleSummary: ScheduleSummary
  trainingSummary: TrainingSummary
  dropSummary: DropSummary
  openStageSummary: OpenStageSummary
  deviceStats: DeviceStats | null
  temperatureHistory: number[]
  lastUpdate: number | null
}

export type DashboardSnapshotData = Omit<DashboardSnapshot, 'lastUpdate'>
export type DashboardBusinessSnapshot = Pick<
  DashboardSnapshotData,
  'activitySummary' | 'scheduleSummary' | 'trainingSummary' | 'dropSummary' | 'openStageSummary'
>

interface DashboardCacheState extends DashboardSnapshot {
  hasLoaded: boolean
  isRefreshing: boolean
  lastRefreshAttemptAt: number | null
  startRefresh: () => void
  finishRefresh: (attemptedAt: number, snapshot?: DashboardBusinessSnapshot) => void
  updateDeviceStats: (stats: DeviceStats) => void
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
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const isStringArray = (value: unknown, maxLength: number): value is string[] => (
  Array.isArray(value)
  && value.length <= maxLength
  && value.every(item => typeof item === 'string')
)

function isActivitySummary(value: unknown): value is ActivitySummary {
  if (!isRecord(value) || typeof value.available !== 'boolean') return false
  if (!isOptionalString(value.code) || !isOptionalString(value.name) || !isOptionalString(value.tip)) return false
  if (value.completion === undefined) return true
  if (!isRecord(value.completion)) return false

  return isOptionalBoolean(value.completion.known)
    && isOptionalBoolean(value.completion.complete)
    && (value.completion.completedStages === undefined
      || isStringArray(value.completion.completedStages, MAX_COMPLETED_STAGES))
    && (value.completion.totalStages === undefined || isNonNegativeInteger(value.completion.totalStages))
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
})

const initialCacheState = () => restoreDashboardCache() ?? emptyCacheState()

export const useDashboardStore = create<DashboardCacheState>((set, get) => ({
  ...initialCacheState(),
  startRefresh: () => set({ isRefreshing: true }),
  finishRefresh: (attemptedAt, snapshot) => {
    const validSnapshot = snapshot && isDashboardBusinessSnapshot(snapshot) ? snapshot : undefined
    set(state => validSnapshot
      ? {
          ...validSnapshot,
          deviceStats: state.deviceStats,
          temperatureHistory: state.temperatureHistory,
          hasLoaded: true,
          isRefreshing: false,
          lastRefreshAttemptAt: attemptedAt,
          lastUpdate: attemptedAt,
        }
      : {
          hasLoaded: true,
          isRefreshing: false,
          lastRefreshAttemptAt: attemptedAt,
          lastUpdate: state.lastUpdate,
        })
    if (validSnapshot) persistDashboardCache(get())
  },
  updateDeviceStats: (deviceStats) => {
    if (!isDeviceStats(deviceStats) || deviceStats === null) return
    set(state => ({
      deviceStats,
      temperatureHistory: Number.isFinite(deviceStats.temp)
        ? [...state.temperatureHistory, Number(deviceStats.temp)].slice(-36)
        : state.temperatureHistory,
    }))
  },
  reset: () => {
    clearDashboardCache()
    set(emptyCacheState())
  },
}))
