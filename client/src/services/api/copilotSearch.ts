import type { ApiResponse } from '@/types/api'
import type { CopilotSearchResult, ParadoxSearchResult } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

// ========== 悖论模拟 API ==========

/**
 * 搜索悖论模拟作业
 */
export async function searchParadoxCopilot(operatorName: string): Promise<ApiResponse<ParadoxSearchResult>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/paradox/search?name=${encodeURIComponent(operatorName)}`)
  return parseJsonResponse(response)
}

/**
 * 搜索普通关卡作业
 */
export async function searchCopilot(stageName: string): Promise<ApiResponse<CopilotSearchResult>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot/search?stage=${encodeURIComponent(stageName)}`)
  return parseJsonResponse(response)
}

