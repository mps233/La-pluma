export interface TaskConfig {
  name: string
  type: string
  params: Record<string, unknown>
  [key: string]: unknown
}

export type TaskConfigInput = TaskConfig | string

/**
 * 养成计划选项
 */

export interface WebrtcStatusData {
  installed?: boolean
  serverRunning?: boolean
  signalingUrl?: string
  deviceId?: string
  devices?: string[]
  serverVersion?: string | null
  [key: string]: unknown
}

export interface WebrtcSnapshotData {
  deviceId: string
  image: string
  mediaType: string
  size?: number
  capturedAt?: string
}

export interface MaaVersionData {
  cli: string
  core: string
  raw: string
  resource?: {
    lastUpdated: string | null
    modifiedAt: string | null
    ageDays: number | null
    status: 'current' | 'stale' | 'unknown'
    message: string
    activity?: unknown
    gacha?: unknown
  }
}

export interface TaskStatusData {
  isRunning: boolean
  taskName: string | null
  startTime: number | null
  taskType: string | null
  currentStage?: string | null
  currentStep?: number | null
  totalSteps?: number | null
  stopRequested: boolean
  logs: unknown[]
}

export interface ScheduleExecutionStatusData {
  isRunning: boolean
  scheduleId: string | null
  currentStep: number
  totalSteps: number
  currentTask: string | null
  currentTaskId?: string | null
  message: string
  startTime: number | null
  shouldStop: boolean
  lastResult?: unknown
  hasLastResult?: boolean
  lastResultRevision?: number
}

interface MaaSanityReadingData {
  current: number
  max: number
  reportAt: string
}

export interface MaaCallbackLogData {
  content: string
  logPath: string
  totalLines: number
  returnedLines: number
  /** The newest sanity MaaCore reported, or absent when no fight is in the log. */
  sanity?: MaaSanityReadingData
}

export interface ActivityData {
  code: string | null
  name: string | null
  available?: boolean
  status?: 'active' | 'none' | 'unavailable' | 'stale'
  failure?: { source?: string; message?: string } | null
  startTime?: number | null
  endTime?: number | null
  dataUpdatedAt?: number | null
  lastSuccessAt?: number | null
  [key: string]: unknown
}

export interface ActivityNavigationPreflightData {
  state?: string
  canPrepare?: boolean
  canRun?: boolean
  reasonCode?: string | null
  reason?: string
  activity?: {
    code?: string | null
    name?: string | null
    source?: string | null
    stages?: string[]
  }
  navigation?: {
    source?: string
    stageFile?: string
    stageCount?: number
    entryTask?: string
    specialStages?: boolean
  } | null
}

export interface StopTaskData {
  task?: {
    success?: boolean
    message?: string
  }
  scheduleStopped?: boolean
  stopRequested?: boolean
  run?: unknown
  stopped?: boolean
  alreadyTerminal?: boolean
}

export interface ScheduleExecutionResultData {
  success?: boolean
  message?: string
  stopped?: boolean
  busy?: boolean
  owner?: unknown
  summary?: unknown
  runId?: string
  state?: string
  pollUrl?: string
  stopUrl?: string
  results?: unknown[]
  pending?: Array<{ itemIndex: number; [key: string]: unknown }>
  substitutions?: Array<{
    itemIndex?: number
    stage?: string
    originalCopilotId?: number
    copilotId?: number
  }>
  skipped?: Array<{
    itemIndex?: number
    stage?: string
    reason?: string
  }>
}

export interface ManualCopilotSetResult {
  runId: string
  state: string
  setId: string
  name: string
  waitingForNext: boolean
  finished: boolean
  stopped: boolean
  nextItemIndex: number | null
  taskResults: unknown[]
  message: string
}

export interface LogFileContentData {
  content: string
  totalLines?: number
  returnedLines?: number
}

/**
 * 作业集信息
 */
export interface CopilotSetInfo {
  id: string
  name: string
  stages: string[]
}

