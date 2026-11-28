import type { ApiResponse } from '@/types/api'
import type { AutoUpdateConfig } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { bumpItemIconCacheVersion } from '../../itemIconCache'
import { API_BASE_URL, fetchWithAuth } from '../client'

export const updatesApi = {
  // ========== 更新管理 ==========
  
  /**
   * 更新 MaaCore
   */
  async updateMaaCore(version?: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/update-core`, {
      method: 'POST',
      headers: version ? {
        'Content-Type': 'application/json',
      } : undefined,
      body: version ? JSON.stringify({ version }) : undefined,
    })
    const result = await parseJsonResponse(response)
    if (result.success) bumpItemIconCacheVersion()
    return result
  },

  /**
   * 更新 MAA CLI
   */
  async updateMaaCli(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/update-cli`, {
      method: 'POST',
    })
    const result = await parseJsonResponse(response)
    if (result.success) bumpItemIconCacheVersion()
    return result
  },

  /**
   * 热更新资源文件
   */
  async hotUpdateResources(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/hot-update-resources`, {
      method: 'POST',
    })
    const result = await parseJsonResponse(response)
    if (result.success) bumpItemIconCacheVersion()
    return result
  },

  /**
   * 设置自动更新
   */
  async setupAutoUpdate(config: AutoUpdateConfig): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/configure-auto-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })
    return parseJsonResponse(response)
  },

}
