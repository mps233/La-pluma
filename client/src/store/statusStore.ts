import { create } from 'zustand'
import {
  IDLE_RUN_STATUS,
  isRunStatusBusy,
  isSameGlobalRunStatus,
  type GlobalRunStatus,
} from '../types/run'
import { detectStatusMessageType, type StatusMessageType } from '../utils/statusMessage'

const AUTO_DISMISS_MS: Record<StatusMessageType, number> = {
  success: 1500,
  error: 0,
  warning: 3000,
  info: 10000,
  default: 3000,
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null
let messageRevision = 0

const cancelDismissTimer = () => {
  if (!dismissTimer) return
  clearTimeout(dismissTimer)
  dismissTimer = null
}

interface StatusState {
  message: string
  messageType: StatusMessageType | null
  isActive: boolean
  /**
   * 全局运行状态，由 useRunStatusMonitor 从 /api/agent/runs/current 投影写入。
   * 页面不直接改写这个字段；它是跨页面显示运行中任务的唯一来源。
   */
  runStatus: GlobalRunStatus
  backendStatus: 'unknown' | 'checking' | 'available' | 'unavailable'
  backendMessage: string
  setMessage: (message: string, type?: StatusMessageType) => number
  clearMessage: () => void
  setActive: (active: boolean) => void
  applyRunStatus: (runStatus: GlobalRunStatus) => void
  setBackendStatus: (status: StatusState['backendStatus'], message?: string) => void
}

export const useStatusStore = create<StatusState>((set, get) => {
  const scheduleDismiss = (type: StatusMessageType, revision: number) => {
    cancelDismissTimer()
    if (get().isActive || isRunStatusBusy(get().runStatus)) return
    if (AUTO_DISMISS_MS[type] <= 0) return

    dismissTimer = setTimeout(() => {
      if (revision !== messageRevision || get().isActive || isRunStatusBusy(get().runStatus)) return
      dismissTimer = null
      set({ message: '', messageType: null })
    }, AUTO_DISMISS_MS[type])
  }

  return {
    message: '',
    messageType: null,
    isActive: false,
    runStatus: IDLE_RUN_STATUS,
    backendStatus: 'unknown',
    backendMessage: '',
    setMessage: (message, type) => {
      // Existing callers clear after their own delay. Ignore those stale clears;
      // the store owns dismissal so a previous operation cannot erase a newer one.
      if (!message) return messageRevision

      const revision = ++messageRevision
      const messageType = type ?? detectStatusMessageType(message)
      cancelDismissTimer()
      set({ message, messageType })
      scheduleDismiss(messageType, revision)
      return revision
    },
    clearMessage: () => {
      messageRevision += 1
      cancelDismissTimer()
      set({ message: '', messageType: null })
    },
    setActive: (isActive) => {
      if (get().isActive === isActive) return

      set({ isActive })
      if (isActive) {
        cancelDismissTimer()
        return
      }

      const { message, messageType } = get()
      if (message && messageType) scheduleDismiss(messageType, messageRevision)
    },
    applyRunStatus: (runStatus) => {
      const previous = get().runStatus
      if (isSameGlobalRunStatus(previous, runStatus)) return

      const wasBusy = isRunStatusBusy(previous)
      set({ runStatus })
      if (isRunStatusBusy(runStatus)) {
        cancelDismissTimer()
        return
      }

      // 只在从忙到闲的转变时重新计时，重复上报空闲不能推迟已有提示的消失。
      if (!wasBusy) return
      const { message, messageType } = get()
      if (message && messageType) scheduleDismiss(messageType, messageRevision)
    },
    setBackendStatus: (backendStatus, backendMessage = '') => {
      set({ backendStatus, backendMessage })
    },
  }
})
