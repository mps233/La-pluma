import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'
import type { ActivityData, ActivityNavigationPreflightData } from '../types'

export const activityApi = {
  // ========== 活动信息 ==========
  
  /**
   * 获取当前活动信息
   */
  async getActivity(clientType?: string): Promise<ApiResponse<ActivityData>> {
    const query = clientType ? `?clientType=${encodeURIComponent(clientType)}` : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity${query}`)
    return parseJsonResponse(response)
  },

  /**
   * 获取当前活动的关卡列表与 MAA 活动导航资源状态
   */
  async getActivityPreflight(clientType?: string): Promise<ApiResponse<ActivityNavigationPreflightData>> {
    const query = clientType ? `?clientType=${encodeURIComponent(clientType)}` : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity/preflight${query}`)
    return parseJsonResponse(response)
  },

}
