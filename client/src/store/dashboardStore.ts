import { create } from 'zustand'

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
  cpuPct?: number
  load1m?: number
  memPct?: number
  memUsed?: string
  memTotal?: string
  diskPct?: number
  diskUsed?: string
  diskTotal?: string
  temp?: number
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

interface DashboardCacheState extends DashboardSnapshot {
  hasLoaded: boolean
  isRefreshing: boolean
  lastRefreshAttemptAt: number | null
  updateSnapshot: (snapshot: Partial<DashboardSnapshot>) => void
  startRefresh: () => void
  finishRefresh: (attemptedAt: number, successful: boolean) => void
  updateDeviceStats: (stats: DeviceStats) => void
  reset: () => void
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

const initialCacheState = () => ({
  ...initialSnapshot(),
  hasLoaded: false,
  isRefreshing: false,
  lastRefreshAttemptAt: null,
})

export const useDashboardStore = create<DashboardCacheState>((set) => ({
  ...initialCacheState(),
  updateSnapshot: (snapshot) => set(snapshot),
  startRefresh: () => set({ isRefreshing: true }),
  finishRefresh: (attemptedAt, successful) => set(state => ({
    hasLoaded: true,
    isRefreshing: false,
    lastRefreshAttemptAt: attemptedAt,
    lastUpdate: successful ? attemptedAt : state.lastUpdate,
  })),
  updateDeviceStats: (deviceStats) => set(state => ({
    deviceStats,
    temperatureHistory: Number.isFinite(deviceStats.temp)
      ? [...state.temperatureHistory, Number(deviceStats.temp)].slice(-36)
      : state.temperatureHistory,
  })),
  reset: () => set(initialCacheState()),
}))
