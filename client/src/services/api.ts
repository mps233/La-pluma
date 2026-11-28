/**
 * MAA API 服务门面
 * 组装 HTTP 核心、maaApi 域模块与独立端点模块。
 */

export * from './api/maa'
export * from './api/types'
export { API_BASE_URL, fetchWithAuth, getItemIconUrl } from './api/client'
export { parseJsonResponse } from '@/utils/apiResponse'

export {
  getMasteryPreflight,
  getMasteryCatalog,
  getMasteryOperator,
  getMasteryStatus,
  addMasteryTargets,
  updateMasteryTarget,
  removeMasteryTarget,
  reorderMasteryTargets,
  updateMasterySettings,
  startMasteryCampaign,
  pauseMasteryCampaign,
  resumeMasteryCampaign,
  stopMasteryCampaign,
  retryMasteryTarget,
} from './api/mastery'

export {
  getSklandStatus,
  getSklandSnapshot,
  loginSkland,
  saveSklandCredentials,
  clearSklandCredentials,
  syncSkland,
} from './api/skland'

export { searchParadoxCopilot, searchCopilot } from './api/copilotSearch'

export { getTodayDrops, getDropStatistics, getOpenTodayStages } from './api/drops'

export {
  cloneNotificationConfig,
  notificationsApi,
  type NotificationConfig,
  type TelegramConfig,
} from './api/notifications'

export {
  getOperatorList,
  getOperatorCounts,
  getAllOperators,
  getOperBoxData,
  getTrainingQueue,
  addToTrainingQueue,
  removeFromTrainingQueue,
  updateTrainingQueueOrder,
  updateTrainingSettings,
  generateTrainingPlan,
  applyTrainingPlan,
  fetchOperatorMaterials,
  type TrainingQueueResponse,
  type OperatorListData,
  type ApplyTrainingPlanResult,
} from './api/training'
