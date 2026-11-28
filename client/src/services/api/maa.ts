/**
 * MAA API 服务
 * 由各域分组组合而成；调用方仍从 `@/services/api` 导入 `maaApi`。
 */

import { activityApi } from './groups/activity'
import { configApi } from './groups/config'
import { connectionsApi } from './groups/connections'
import { dataApi } from './groups/data'
import { logsApi } from './groups/logs'
import { scheduleApi } from './groups/schedule'
import { systemApi } from './groups/system'
import { updatesApi } from './groups/updates'

/**
 * MAA API 客户端
 */
export const maaApi = {
  ...systemApi,
  ...logsApi,
  ...configApi,
  ...connectionsApi,
  ...activityApi,
  ...scheduleApi,
  ...updatesApi,
  ...dataApi,
}
