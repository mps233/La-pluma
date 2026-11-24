import { create } from 'zustand'
import type { MasteryCampaignStatus, MasteryQueueStatus } from '../types/components'

export interface MasteryOutcome {
  status: MasteryCampaignStatus
  at: number
  message: string | null
}

interface MasteryStore {
  status: MasteryQueueStatus | null
  /**
   * A campaign that just ended while the app was open. The island holds it for a few seconds,
   * then the monitor clears it so a page refresh does not replay an old completion.
   */
  lastOutcome: MasteryOutcome | null
  applyStatus: (status: MasteryQueueStatus) => void
  setLastOutcome: (outcome: MasteryOutcome) => void
  clearLastOutcome: () => void
  reset: () => void
}

export const useMasteryStore = create<MasteryStore>(set => ({
  status: null,
  lastOutcome: null,
  applyStatus: (status) => set({ status }),
  setLastOutcome: (outcome) => set({ lastOutcome: outcome }),
  clearLastOutcome: () => set({ lastOutcome: null }),
  reset: () => set({ status: null, lastOutcome: null }),
}))
