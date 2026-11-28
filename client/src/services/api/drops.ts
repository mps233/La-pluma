import type { ApiResponse } from '@/types/api'
import type { DropStatistics } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

// ==================== 掉落记录 API ====================

/**
 * 获取今日掉落记录
 */
export async function getTodayDrops(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/drops/today`)
  return parseJsonResponse(response)
}

/**
 * 获取掉落统计数据
 */
export async function getDropStatistics(days: number = 7): Promise<ApiResponse<DropStatistics>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/drops/statistics?days=${days}`)
  return parseJsonResponse(response)
}

export async function getOpenTodayStages(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/stages/open-today`)
  return parseJsonResponse(response)
}
