/**
 * Zustand Stores 导出索引
 */

export { useUIStore } from './uiStore'
export type { CombatCopilotPrefill, StatisticsTab } from './uiStore'
export {
  usePreviewStore,
  previewQualityPresets,
  previewFpsOptions,
  buildPreviewScrcpyOptions,
} from './previewStore'
export type {
  PreviewMode,
  PreviewQuality,
  PreviewQualityPreset,
} from './previewStore'
