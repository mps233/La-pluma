/**
 * Global Zustand state. One module per concern, one barrel for consumers.
 */
export {
  appTabFromPath,
  appTabPath,
  applyThemePreference,
  isAppTab,
  useUIStore,
} from './uiStore'
export type { AppTab, CombatCopilotPrefill } from './uiStore'

export {
  buildPreviewScrcpyOptions,
  previewQualityPresets,
  usePreviewStore,
} from './previewStore'
export type { PreviewMode, PreviewQuality } from './previewStore'

export { useDashboardStore } from './dashboardStore'
export type { ActivitySummary, DashboardBusinessSnapshot } from './dashboardStore'

export { useRunStore } from './runStore'
export { useStatusStore } from './statusStore'

export { useMasteryStore } from './masteryStore'
export type { MasteryOutcome } from './masteryStore'

export { MAA_UPDATE_LABELS, useMaaUpdateStore } from './maaUpdateStore'
export type { MaaUpdateKind, MaaUpdateOperation } from './maaUpdateStore'
