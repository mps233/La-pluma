import { create } from 'zustand'
import type { GlobalRunStatus } from '@/features/task-execution'

/** 唯一快照尚未投影或投影为 `idle` 时的运行状态。 */
export const IDLE_RUN_STATUS: GlobalRunStatus = Object.freeze({
  phase: 'idle',
  isRunning: false,
  runId: null,
  label: null,
  detail: null,
})

const isSameRunStatus = (left: GlobalRunStatus, right: GlobalRunStatus) => (
  left.phase === right.phase
  && left.isRunning === right.isRunning
  && left.runId === right.runId
  && left.label === right.label
  && left.detail === right.detail
)

interface StatusState {
  /**
   * 全局运行状态，由 `useRunStatusProjection` 从执行控制器的唯一快照投影写入。
   * 页面与连接监测器都不得自行改写；这里只保留阶段、身份与一行标签，
   * 不复制 Run 记录。
   */
  runStatus: GlobalRunStatus
  backendStatus: 'unknown' | 'checking' | 'available' | 'unavailable'
  backendMessage: string
  applyRunStatus: (runStatus: GlobalRunStatus) => void
  setBackendStatus: (status: StatusState['backendStatus'], message?: string) => void
}

export const useStatusStore = create<StatusState>((set, get) => ({
  runStatus: IDLE_RUN_STATUS,
  backendStatus: 'unknown',
  backendMessage: '',
  applyRunStatus: (runStatus) => {
    const previous = get().runStatus
    if (isSameRunStatus(previous, runStatus)) return
    set({ runStatus })
  },
  setBackendStatus: (backendStatus, backendMessage = '') => {
    const current = get()
    // 轮询每秒都会返回相同连接健康：值未变时不写 store，避免无意义的订阅通知。
    if (current.backendStatus === backendStatus && current.backendMessage === backendMessage) return
    set({ backendStatus, backendMessage })
  },
}))
