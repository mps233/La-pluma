import type { ApiResponse } from '@/types/api'
import type { MaaConnectionConfig } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'

export const configApi = {
  // ========== 配置管理 ==========
  
  /**
   * 获取配置
   */
  async getConfig(profileName: string = 'default'): Promise<ApiResponse<MaaConnectionConfig>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/maa/${profileName}`)
    return parseJsonResponse(response)
  },

  /**
   * 保存配置
   */
  async saveConfig(profileName: string = 'default', config: Record<string, unknown>): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/maa/${profileName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })
    return parseJsonResponse(response)
  },

  // ========== 用户配置存储 ==========
  
  /**
   * 保存用户配置到服务器
   */
  async saveUserConfig(configType: string, data: unknown): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user/${configType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    return parseJsonResponse(response)
  },

  /**
   * 从服务器读取用户配置
   */
  async loadUserConfig<T = unknown>(configType: string, signal?: AbortSignal): Promise<ApiResponse<T>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user/${configType}`, { signal })
    return parseJsonResponse(response)
  },

}
