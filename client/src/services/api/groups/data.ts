import type { ApiResponse } from '@/types/api'
import type { DepotDataDetailed, OperBoxData } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'
import type { CopilotSetInfo, ManualCopilotSetResult, ScheduleExecutionResultData } from '../types'

export const dataApi = {
  // ========== 数据统计 ==========
  
  /**
   * 解析并保存仓库数据
   */
  async parseDepotData(): Promise<ApiResponse<DepotDataDetailed>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/depot-recognition`, {
      method: 'POST',
    })
    return parseJsonResponse(response)
  },

  /**
   * 解析并保存干员数据
   */
  async parseOperBoxData(): Promise<ApiResponse<OperBoxData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/operbox-recognition`, {
      method: 'POST',
    })
    return parseJsonResponse(response)
  },

  /**
   * 获取已保存的仓库数据
   */
  async getDepotData(): Promise<ApiResponse<DepotDataDetailed>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/depot`)
    return parseJsonResponse(response)
  },

  /**
   * 获取作业信息（通过后端代理，避免 CORS）
   */
  async getCopilotInfo(copilotId: string): Promise<ApiResponse<CopilotSetInfo>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilots/${copilotId}`)
    return parseJsonResponse(response)
  },

  /**
   * 获取作业集信息（通过后端代理，避免 CORS）
   */
  async getCopilotSet(copilotId: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${copilotId}`)
    return parseJsonResponse(response)
  },

  async getCopilotSetPlan(copilotId: string, raid: 'normal' | 'raid' | 'both' = 'normal'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${encodeURIComponent(copilotId)}/plan?raid=${raid}`)
    return parseJsonResponse(response)
  },

  async listCustomTools(): Promise<ApiResponse<{ tools?: unknown }>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/custom-tools`)
    return parseJsonResponse(response)
  },

  async runCustomTool(toolId: string, params: Record<string, unknown> = {}, options: {
    dryRun?: boolean
    waitForCompletion?: boolean
  } = {}): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/run-custom-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId,
        params,
        dryRun: options.dryRun === true,
        waitForCompletion: options.waitForCompletion !== false
      })
    })
    return parseJsonResponse(response)
  },

  async runActivitySet(setId: string, payload: {
    raid: 'normal' | 'raid' | 'both'
    selectedIndexes: number[]
    options?: Record<string, unknown>
  }): Promise<ApiResponse<ScheduleExecutionResultData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setId,
        raid: payload.raid,
        selectedIndexes: payload.selectedIndexes,
        options: payload.options || {},
        waitForCompletion: true
      })
    })
    return parseJsonResponse(response)
  },

  async runActivityFallback(payload: {
    options?: Record<string, unknown>
  } = {}): Promise<ApiResponse<ScheduleExecutionResultData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedIndexes: [],
        options: payload.options || {},
        waitForCompletion: true
      })
    })
    return parseJsonResponse(response)
  },

  async startManualCopilotSet(copilotId: string, payload: {
    raid: 'normal' | 'raid' | 'both'
    selectedIndexes: number[]
    options?: Record<string, unknown>
  }): Promise<ApiResponse<ManualCopilotSetResult>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${encodeURIComponent(copilotId)}/manual/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return parseJsonResponse<ApiResponse<ManualCopilotSetResult>>(response)
  },

  async continueManualCopilotSet(runId: string, options?: Record<string, unknown>): Promise<ApiResponse<ManualCopilotSetResult>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/continue-copilot-set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, ...(options ? { options } : {}) })
    })
    return parseJsonResponse<ApiResponse<ManualCopilotSetResult>>(response)
  },

  async executeCopilotSetPlan(copilotId: string, payload: {
    raid: 'normal' | 'raid' | 'both'
    selectedIndexes: number[]
    options?: Record<string, unknown>
  }): Promise<ApiResponse<ScheduleExecutionResultData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${encodeURIComponent(copilotId)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return parseJsonResponse(response)
  },

  async resetCopilotSetProgress(copilotId: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${encodeURIComponent(copilotId)}/reset-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    return parseJsonResponse(response)
  },

}
