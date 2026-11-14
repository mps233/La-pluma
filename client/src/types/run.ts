/**
 * Agent Run 类型
 * 与服务端 /api/agent/runs/current 的 Run 快照保持同构。
 */

export type AgentRunState =
  | 'accepted'
  | 'waiting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'interrupted'

export type RunTaskResultStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'stopped'

export interface RunTaskResult {
  index?: number
  itemIndex?: number
  name?: string
  status?: RunTaskResultStatus
  /** The server's terminal word for the result (`succeeded`, `failed`, …). */
  state?: string
  error?: string
  [key: string]: unknown
}

export interface AgentRunProgress {
  setId?: string | null
  currentStage?: string | null
  currentTask?: string | null
  currentStep?: number | null
  totalSteps?: number | null
  message?: string
  taskResults?: RunTaskResult[]
  battle?: {
    kills: number
    total: number
  }
  [key: string]: unknown
}

export interface AgentRun {
  runId: string
  operationId: string
  state: AgentRunState
  acceptedAt?: string
  startedAt?: string | null
  finishedAt?: string | null
  progress?: AgentRunProgress | null
  taskResults?: RunTaskResult[]
  error?: {
    code?: string
    message?: string
    retryable?: boolean
    [key: string]: unknown
  } | null
  links?: {
    self?: string
    stop?: string
    targetedStop?: string
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/** The schedule executor's live status; currentStep is zero-based here. */
export interface RunScheduleProgress {
  isRunning?: boolean
  scheduleId?: string | null
  currentStep?: number | null
  totalSteps?: number | null
  currentTask?: string | null
  currentTaskId?: string | null
  currentStage?: string | null
  message?: string | null
  startTime?: number | null
  shouldStop?: boolean
  [key: string]: unknown
}

/** The legacy task snapshot the server keeps beside the Run. */
export interface LegacyRunTaskProgress {
  isRunning?: boolean
  currentStage?: string | null
  currentTask?: string | null
  currentStep?: number | null
  totalSteps?: number | null
  taskName?: string | null
  [key: string]: unknown
}

export interface CurrentRunSnapshot {
  run: AgentRun | null
  lastRun: AgentRun | null
  isRunning?: boolean
  taskName?: string | null
  currentStage?: string | null
  currentTask?: string | null
  /** The scheduled flow's own progress, which the Run itself does not carry. */
  schedule?: RunScheduleProgress | null
  /** The legacy task process status, used when a run has no progress. */
  task?: LegacyRunTaskProgress | null
  [key: string]: unknown
}

export type GlobalRunPhase = 'idle' | 'running' | 'stopping' | 'unknown'

export interface GlobalRunStatus {
  phase: GlobalRunPhase
  isRunning: boolean
  runId: string | null
  label: string | null
  detail: string | null
}

export const IDLE_RUN_STATUS: GlobalRunStatus = Object.freeze({
  phase: 'idle',
  isRunning: false,
  runId: null,
  label: null,
  detail: null,
})

const ACTIVE_RUN_STATES = new Set<AgentRunState>(['accepted', 'waiting', 'running', 'stopping'])

export const isActiveRunState = (state: AgentRunState): boolean => ACTIVE_RUN_STATES.has(state)

export const isSameGlobalRunStatus = (left: GlobalRunStatus, right: GlobalRunStatus): boolean => (
  left.phase === right.phase
  && left.isRunning === right.isRunning
  && left.runId === right.runId
  && left.label === right.label
  && left.detail === right.detail
)

export const isRunStatusBusy = (status: GlobalRunStatus): boolean => (
  status.isRunning || status.phase === 'stopping' || status.phase === 'unknown'
)
