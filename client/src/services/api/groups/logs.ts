import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'
import type { LogFileContentData, MaaCallbackLogData } from '../types'

export const logsApi = {
  // ========== 日志管理 ==========
  
  /**
   * 获取实时日志
   */
  async getRealtimeLogs(lines: number = 100, signal?: AbortSignal, afterSequence = 0): Promise<ApiResponse> {
    const cursor = afterSequence > 0 ? `&afterSequence=${afterSequence}` : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/recent?lines=${lines}${cursor}`, { signal })
    return parseJsonResponse(response)
  },

  /**
   * 读取最近的 MAA 回调日志原文（用于提取当前理智、关卡掉落等运行事实）
   */
  async getMaaCallbacks(lines: number = 2000, signal?: AbortSignal): Promise<ApiResponse<MaaCallbackLogData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/maa-callbacks?lines=${lines}`, { signal })
    return parseJsonResponse(response)
  },

  /**
   * 获取日志文件列表
   */
  async getLogFiles(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/files`)
    return parseJsonResponse(response)
  },

  /**
   * 读取日志文件内容
   */
  async readLogFile(filePath: string, lines: number = 1000): Promise<ApiResponse<LogFileContentData>> {
    const encodedPath = encodeURIComponent(filePath)
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/files/${encodedPath}?lines=${lines}`)
    return parseJsonResponse(response)
  },

  /**
   * 手动清理日志文件
   */
  async cleanupLogs(maxSizeMB: number = 10): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ maxSizeMB }),
    })
    return parseJsonResponse(response)
  },

}
