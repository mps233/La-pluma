/**
 * MAA API 服务
 * 提供与后端 API 交互的所有方法
 */

import type { ApiResponse } from '@/types/api'
import type { CurrentRunSnapshot } from '@/types/run'
import type {
  AutoUpdateConfig,
  DepotDataDetailed,
  MaaConnectionConfig,
  OperBoxData,
} from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { bumpItemIconCacheVersion } from '../itemIconCache'
import { API_BASE_URL, fetchWithAuth, getAuthHeaders } from './client'
import type {
  ActivityData,
  ActivityNavigationPreflightData,
  CopilotSetInfo,
  LogFileContentData,
  MaaCallbackLogData,
  MaaVersionData,
  ManualCopilotSetResult,
  ScheduleExecutionResultData,
  ScheduleExecutionStatusData,
  StopTaskData,
  TaskConfigInput,
  TaskStatusData,
  WebrtcSnapshotData,
  WebrtcStatusData,
} from './types'




/**
 * 任务配置接口
 */
/**
 * MAA API 客户端
 */
export const maaApi = {
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

  // ========== 连接测试 ==========
  
  /**
   * 测试 ADB 连接
   */
  async testConnection(adbPath?: string, address?: string, signal?: AbortSignal): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-connection`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...(adbPath ? { adbPath } : {}), ...(address ? { address } : {}) }),
    })
    return parseJsonResponse(response)
  },

  async discoverDevices(adbPath: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/discover-devices?adbPath=${encodeURIComponent(adbPath)}`)
    return parseJsonResponse(response)
  },

  async getWebrtcStatus(): Promise<ApiResponse<WebrtcStatusData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/status`)
    return parseJsonResponse(response)
  },

  async getWebrtcSnapshot(deviceId: string = 'mumu-la-pluma'): Promise<ApiResponse<WebrtcSnapshotData>> {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/agent/webrtc/snapshot?deviceId=${encodeURIComponent(deviceId)}`
    )
    return parseJsonResponse(response)
  },

  async getClipboard(): Promise<ApiResponse<{ text?: string }>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/clipboard`)
    return parseJsonResponse<ApiResponse<{ text?: string }>>(response)
  },

  async setClipboard(text: string, paste: boolean = true): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, paste })
    })
    return parseJsonResponse(response)
  },

  async stopWebrtc(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/stop`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  async startWebrtc(
    profileId: string = 'default',
    deviceId: string = 'mumu-la-pluma',
    signal?: AbortSignal,
    options?: { max_fps?: number; max_size?: number; bitrate?: number }
  ): Promise<ApiResponse<WebrtcStatusData>> {
    const body: Record<string, unknown> = { profileId, deviceId }
    if (options?.max_fps) body.maxFps = options.max_fps
    if (options?.max_size) body.maxSize = options.max_size
    if (options?.bitrate) body.bitRate = options.bitrate
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    return parseJsonResponse(response)
  },

  async captureScreenFrame(profileId: string = 'default', signal?: AbortSignal): Promise<Blob> {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/agent/screen/frame?profileId=${encodeURIComponent(profileId)}`,
      { signal }
    )
    if (!response.ok) {
      throw new Error(`截图失败: HTTP ${response.status}`)
    }
    return response.blob()
  },

  async getDeviceStats(address?: string): Promise<ApiResponse> {
    const qs = address ? `?address=${encodeURIComponent(address)}` : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/device-stats${qs}`)
    return parseJsonResponse(response)
  },

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

