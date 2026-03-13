import { create } from 'zustand'

export interface StatusState {
  message: string
  isActive: boolean
  setMessage: (message: string) => void
  clearMessage: () => void
  setActive: (active: boolean) => void
}

export const useStatusStore = create<StatusState>((set) => ({
  message: '',
  isActive: false,
  setMessage: (message) => set({ message }),
  clearMessage: () => set({ message: '' }),
  setActive: (isActive) => set({ isActive }),
}))
