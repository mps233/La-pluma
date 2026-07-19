import { create } from 'zustand'
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

export interface StatusState {
  message: string
  messageType: StatusMessageType | null
  isActive: boolean
  backendStatus: 'unknown' | 'checking' | 'available' | 'unavailable'
  backendMessage: string
  setMessage: (message: string, type?: StatusMessageType) => number
  clearMessage: (expectedRevision?: number) => void
  setActive: (active: boolean) => void
  setBackendStatus: (status: StatusState['backendStatus'], message?: string) => void
}

export const useStatusStore = create<StatusState>((set, get) => {
  const scheduleDismiss = (type: StatusMessageType, revision: number) => {
    cancelDismissTimer()
    if (get().isActive) return
    if (AUTO_DISMISS_MS[type] <= 0) return

    dismissTimer = setTimeout(() => {
      if (revision !== messageRevision || get().isActive) return
      dismissTimer = null
      set({ message: '', messageType: null })
    }, AUTO_DISMISS_MS[type])
  }

  return {
    message: '',
    messageType: null,
    isActive: false,
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
    clearMessage: (expectedRevision) => {
      if (expectedRevision !== undefined && expectedRevision !== messageRevision) return
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
    setBackendStatus: (backendStatus, backendMessage = '') => {
      set({ backendStatus, backendMessage })
    },
  }
})
