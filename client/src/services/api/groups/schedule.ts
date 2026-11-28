import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'
import type { ScheduleExecutionResultData, ScheduleExecutionStatusData } from '../types'

export const scheduleApi = {
  // ========== 定时任务管理 ==========
  
  /**
   * 设置定时任务
   */
  async setupSchedule(
    scheduleId: string = 'default',
    times: string[],
    taskFlow: unknown[]
  ): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scheduleId, times, taskFlow }),
    })
    return parseJsonResponse(response)
  },

  /**
   * 停止定时任务
   */
  async stopSchedule(scheduleId: string = 'default'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}`, {
      method: 'DELETE',
    })
    return parseJsonResponse(response)
  },

  /**
   * 获取定时任务执行状态
   */
  async getScheduleExecutionStatus(signal?: AbortSignal, includeResult = false): Promise<ApiResponse<ScheduleExecutionStatusData>> {
    const query = includeResult ? '?includeResult=true' : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/execution${query}`, { signal })
    return parseJsonResponse(response)
  },

  /**
   * 立即执行定时任务
   */
  async executeScheduleNow(scheduleId: string = 'default', taskFlow: unknown[]): Promise<ApiResponse<ScheduleExecutionResultData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskFlow }),
    })
    return parseJsonResponse(response)
  },

}
