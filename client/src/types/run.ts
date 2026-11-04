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

export interface CurrentRunSnapshot {
  run: AgentRun | null
  lastRun: AgentRun | null
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
