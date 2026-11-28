import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth, getAuthHeaders } from '../client'
import type { CurrentRunSnapshot } from '@/types/run'
import type { MaaVersionData, StopTaskData, TaskConfigInput, TaskStatusData } from '../types'

export const systemApi = {
  // ========== 工具 ==========

  getErrorMessage(result?: Partial<ApiResponse> | null, fallback = '未知错误'): string {
    return result?.message || result?.errorInfo?.message || result?.error || fallback
  },

  // ========== 基础信息 ==========
  
  /**
   * 获取版本信息
   */
  async getVersion(): Promise<ApiResponse<MaaVersionData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/version`)
    return parseJsonResponse(response)
  },

  /**
   * 获取配置目录
   */
  async getConfigDir(): Promise<ApiResponse<string>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config-directory`)
    return parseJsonResponse(response)
  },

  /**
   * 在本机文件管理器中打开配置目录
   */
  async openConfigDir(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/open-config-directory`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  // ========== 命令执行 ==========
  
  /**
   * 执行 MAA 命令
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    taskConfig: TaskConfigInput | null = null,
    signal: AbortSignal | null = null,
    taskName: string | null = null,
    taskType: string | null = null,
    waitForCompletion: boolean = false
  ): Promise<ApiResponse> {
    const body: Record<string, unknown> = { command, args }
    
    if (taskConfig) {
      body.taskConfig = taskConfig
    }
    if (taskName) {
      body.taskName = taskName
    }
    if (taskType) {
      body.taskType = taskType
    }
    if (waitForCompletion !== undefined) {
      body.waitForCompletion = waitForCompletion
    }
    
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(body)
    }
    
    // 如果提供了 abort signal，添加到 fetch 选项中
    if (signal) {
      fetchOptions.signal = signal
    }
    
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/run-task`, fetchOptions)
    return parseJsonResponse(response)
  },

  /**
   * 使用结构化参数执行预定义任务，避免字符串 split 破坏本地路径/URL
   */
  async executePredefinedTaskArgs(
    taskType: string,
    args: string[] = [],
    taskConfig: TaskConfigInput | null = null,
    signal: AbortSignal | null = null,
    taskName: string | null = null,
    taskTypeLabel: string | null = null,
    waitForCompletion: boolean = false
  ): Promise<ApiResponse> {
    return this.executeCommand(taskType, args, taskConfig, signal, taskName, taskTypeLabel, waitForCompletion)
  },

  /**
   * 执行预定义任务
   */
  async executePredefinedTask(
    taskType: string,
    params: string,
    taskConfig: TaskConfigInput | null = null,
    signal: AbortSignal | null = null,
    taskName: string | null = null,
    taskTypeLabel: string | null = null,
    waitForCompletion: boolean = false
  ): Promise<ApiResponse> {
    // 按 shell 风格切分参数，保留带引号的本地路径与远程 URL
    const args = params
      ? (params.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
          .map(arg => arg.replace(/^("|')|("|')$/g, ''))
          .filter(arg => arg.trim())
      : []
    return this.executeCommand(taskType, args, taskConfig, signal, taskName, taskTypeLabel, waitForCompletion)
  },

  async getActivityCopilotCandidates(signal?: AbortSignal): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity/copilot-candidates`, { signal })
    return parseJsonResponse(response)
  },

  /**
   * 获取当前 Agent Run 快照。
   * lines=1 只取一条日志，避免全局状态轮询把整段日志反复拉回。
   */
  async getCurrentRun(signal?: AbortSignal): Promise<ApiResponse<CurrentRunSnapshot>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/runs/current?lines=1`, { signal })
    return parseJsonResponse<ApiResponse<CurrentRunSnapshot>>(response)
  },

  /**
   * 获取任务执行状态
   */
  async getTaskStatus(signal?: AbortSignal): Promise<ApiResponse<TaskStatusData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/tasks/status`, { signal })
    return parseJsonResponse(response)
  },

  /**
   * 终止当前任务
   */
  async stopTask(runId?: string | null): Promise<ApiResponse<StopTaskData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/stop`, {
      method: 'POST',
      headers: runId ? { 'Content-Type': 'application/json' } : undefined,
      body: runId ? JSON.stringify({ runId }) : undefined
    })
    return parseJsonResponse(response)
  },

}
