/**
 * MAA API 服务
 * 提供与后端 API 交互的所有方法
 */

import type { ApiResponse } from '@/types/api'
import type { CurrentRunSnapshot } from '@/types/run'
import type {
  CopilotSearchResult,
  DepotDataDetailed,
  DropStatistics,
  MaaConnectionConfig,
  OperBoxData,
  OperatorDetailed,
  ParadoxSearchResult,
  TrainingOperator,
  TrainingPlan,
  TrainingQueueItem,
  TrainingSettings,
} from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { bumpItemIconCacheVersion, getItemIconCacheVersion } from './itemIconCache'

export { parseJsonResponse } from '@/utils/apiResponse'

/**
 * 自动检测 API 地址
 * 始终使用当前页面同源地址。
 * 开发环境由 Vite proxy 转发 /api，生产环境由 Express 同源服务前端和 API。
 */
const getApiBaseUrl = (): string => {
  return `${window.location.origin}/api`
}

export const API_BASE_URL = getApiBaseUrl()

export const getItemIconUrl = (iconId: string | number): string => {
  const path = `${API_BASE_URL}/maa-assets/item/${encodeURIComponent(String(iconId))}`
  const version = getItemIconCacheVersion()
  return version > 0 ? `${path}?v=${version}` : path
}

const getStoredToken = (): string => {
  const rawToken = localStorage.getItem('laPlumaToken') || ''
  const token = rawToken.replace(/^Bearer\s+/i, '').trim()

  // Headers.set() throws "The string did not match the expected pattern" when
  // the value contains CR/LF or other control characters. Treat malformed
  // stored tokens as absent so API calls can return a normal 401 instead of
  // crashing the UI action.
  return /[\u0000-\u001f\u007f]/.test(token) ? '' : token
}

const getAuthHeaders = (): Record<string, string> => {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}`, 'X-La-Pluma-Token': token } : {}
}

export const fetchWithAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {})
  Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value))

  try {
    return await fetch(input, { ...init, headers })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('当前网络已断开，请恢复连接后重试')
    }
    throw new Error('无法连接后端服务，请确认服务已启动')
  }
}

/**
 * 任务配置接口
 */
export interface TaskConfig {
  name: string
  type: string
  params: Record<string, unknown>
  [key: string]: unknown
}

export type TaskConfigInput = TaskConfig | string

/**
 * 自动更新配置接口
 */
interface AutoUpdateConfig {
  enabled: boolean
  time: string
  updateCore: boolean
  updateCli: boolean
}

/**
 * 养成计划选项
 */
interface TrainingPlanOptions {
  mode: 'current' | 'all'
}

/**
 * 养成队列数据
 */
interface TrainingQueueData {
  operatorId: string
  currentElite?: number
  targetElite?: number
}

/**
 * 养成计划应用数据
 */
interface ApplyTrainingPlanData {
  plan: TrainingPlan
  settings?: TrainingSettings
}

export interface WebrtcStatusData {
  installed?: boolean
  built?: boolean
  serverRunning?: boolean
  agentRunning?: boolean
  signalingUrl?: string
  directSignalingUrl?: string
  deviceId?: string
  devices?: string[]
  serverVersion?: string | null
  agentVersion?: string | null
  agentOnline?: boolean
  agentVersionStatus?: 'ok' | 'outdated' | 'unknown'
  minimumAgentVersion?: string
  screenState?: string | null
  usingDefaultPassword?: boolean
  runtimeVersion?: string | null
  [key: string]: unknown
}

export interface WebrtcSnapshotData {
  deviceId: string
  image: string
  mediaType: string
  size?: number
  capturedAt?: string
}

export interface WebrtcInstallState {
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  startedAt?: string | null
  finishedAt?: string | null
  result?: unknown
  error?: {
    code: string
    message: string
    retryable: boolean
    details?: unknown
  } | null
}

export interface MaaVersionData {
  cli: string
  core: string
  raw: string
  resource?: {
    lastUpdated: string | null
    modifiedAt: string | null
    ageDays: number | null
    status: 'current' | 'stale' | 'unknown'
    message: string
    activity?: unknown
    gacha?: unknown
  }
}

export interface TaskStatusData {
  isRunning: boolean
  taskName: string | null
  startTime: number | null
  taskType: string | null
  currentStage?: string | null
  currentStep?: number | null
  totalSteps?: number | null
  stopRequested: boolean
  logs: unknown[]
}

export interface ScheduleExecutionStatusData {
  isRunning: boolean
  scheduleId: string | null
  currentStep: number
  totalSteps: number
  currentTask: string | null
  currentTaskId?: string | null
  message: string
  startTime: number | null
  shouldStop: boolean
  lastResult?: unknown
  hasLastResult?: boolean
  lastResultRevision?: number
}

export interface ActivityData {
  code: string | null
  name: string | null
  available?: boolean
  status?: 'active' | 'none' | 'unavailable' | 'stale'
  failure?: { source?: string; message?: string } | null
  startTime?: number | null
  endTime?: number | null
  dataUpdatedAt?: number | null
  lastSuccessAt?: number | null
  [key: string]: unknown
}

export interface StopTaskData {
  task?: {
    success?: boolean
    message?: string
  }
  scheduleStopped?: boolean
  stopRequested?: boolean
  run?: unknown
  stopped?: boolean
  alreadyTerminal?: boolean
}

export interface ScheduleExecutionResultData {
  success?: boolean
  message?: string
  stopped?: boolean
  busy?: boolean
  owner?: unknown
  summary?: unknown
  runId?: string
  results?: unknown[]
  pending?: Array<{ itemIndex: number; [key: string]: unknown }>
}

export interface ManualCopilotSetResult {
  runId: string
  state: string
  setId: string
  name: string
  waitingForNext: boolean
  finished: boolean
  stopped: boolean
  nextItemIndex: number | null
  taskResults: unknown[]
  message: string
}

export interface TrainingQueueResponse {
  queue: TrainingQueueItem[]
  settings: TrainingSettings
  lastUpdated?: string
}

export interface OperatorListData {
  operators: TrainingOperator[]
  count?: number
}

export interface ApplyTrainingPlanResult {
  success?: boolean
  stageCount: number
  totalStages?: number
  hasFallback?: boolean
}

export interface ScreenCaptureData {
  image: string
  mediaType?: string
  width?: number
  height?: number
  adbPath?: string
  address?: string
  profileId?: string
}

export interface LogFileContentData {
  content: string
  totalLines?: number
  returnedLines?: number
}

/**
 * 干员筛选条件
 */
interface OperatorFilters {
  rarity?: number
  profession?: string
  owned?: boolean
  needsElite2?: boolean
  status?: 'trainable' | 'owned' | 'all'
}

/**
 * 作业集信息
 */
interface CopilotSetInfo {
  id: string
  name: string
  stages: string[]
}

/**
 * MAA API 客户端
 */
export const maaApi = {
  // ========== 工具 ==========

  getErrorMessage(result?: Partial<ApiResponse> | null): string {
    return result?.message || result?.errorInfo?.message || result?.error || '未知错误'
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

  async startWebrtc(
    profileId: string = 'default',
    deviceId: string = 'mumu-la-pluma',
    signal?: AbortSignal
  ): Promise<ApiResponse<WebrtcStatusData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, deviceId }),
      signal
    })
    return parseJsonResponse(response)
  },

  async installWebrtc(): Promise<ApiResponse<WebrtcInstallState>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/install`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  async getWebrtcInstallStatus(): Promise<ApiResponse<WebrtcInstallState>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/install/status`)
    return parseJsonResponse(response)
  },

  async startWebrtcServer(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start-server`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  async stopWebrtcServer(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/stop-server`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  async startWebrtcAgent(profileId: string = 'default'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    })
    return parseJsonResponse(response)
  },

  async stopWebrtcAgent(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/stop-agent`, { method: 'POST' })
    return parseJsonResponse(response)
  },

  async captureScreen(profileId: string = 'default'): Promise<ApiResponse<ScreenCaptureData>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/screen/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    })
    return parseJsonResponse(response)
  },

  /** Binary, downscaled snapshot used by the dashboard preview fallback. */
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

// ========== 干员养成相关 API（独立导出函数）==========

/**
 * 获取干员列表
 */
export async function getOperatorList(filters: OperatorFilters = {}, signal?: AbortSignal): Promise<ApiResponse<OperatorListData | TrainingOperator[]>> {
  const params = new URLSearchParams()
  if (filters.rarity) params.append('rarity', filters.rarity.toString())
  if (filters.profession) params.append('profession', filters.profession)
  if (filters.owned !== undefined) params.append('owned', filters.owned.toString())
  if (filters.needsElite2) params.append('needsElite2', 'true')
  if (filters.status) params.append('status', filters.status)

  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/operators?${params}`, { signal })
  return parseJsonResponse(response)
}

/**
 * 获取养成状态徽章计数
 */
export async function getOperatorCounts(
  filters: { rarity?: number } = {},
  signal?: AbortSignal
): Promise<ApiResponse<{ trainable: number; owned: number; all: number }>> {
  const params = new URLSearchParams()
  if (filters.rarity) params.append('rarity', filters.rarity.toString())
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/operator-counts?${params}`, { signal })
  return parseJsonResponse(response)
}

/**
 * 获取全量干员列表
 */
export async function getAllOperators(): Promise<ApiResponse<OperatorDetailed[]>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/operators`)
  return parseJsonResponse(response)
}

/**
 * 获取已识别的持有干员数据
 */
export async function getOperBoxData(): Promise<ApiResponse<OperBoxData>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/operbox`)
  return parseJsonResponse(response)
}

/**
 * 获取养成队列
 */
export async function getTrainingQueue(): Promise<ApiResponse<TrainingQueueResponse>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue`)
  return parseJsonResponse(response)
}

/**
 * 添加干员到养成队列
 */
export async function addToTrainingQueue(data: TrainingQueueData): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return parseJsonResponse(response)
}

/**
 * 从养成队列中移除干员
 */
export async function removeFromTrainingQueue(operatorId: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/${operatorId}`, {
    method: 'DELETE'
  })
  return parseJsonResponse(response)
}

/**
 * 更新养成队列顺序
 */
export async function updateTrainingQueueOrder(operatorIds: string[]): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorIds })
  })
  return parseJsonResponse(response)
}

/**
 * 更新养成设置
 */
export async function updateTrainingSettings(settings: TrainingSettings): Promise<ApiResponse<TrainingSettings>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  return parseJsonResponse(response)
}

/**
 * 生成养成计划
 */
export async function generateTrainingPlan(options: TrainingPlanOptions): Promise<ApiResponse<TrainingPlan>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  })
  return parseJsonResponse(response)
}

/**
 * 应用养成计划到任务流程
 */
export async function applyTrainingPlan(data: ApplyTrainingPlanData): Promise<ApiResponse<ApplyTrainingPlanResult>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/apply-training-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return parseJsonResponse(response)
}

/**
 * 获取干员材料数据
 */
export async function fetchOperatorMaterials(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/fetch-training-materials`, {
    method: 'POST'
  })
  return parseJsonResponse(response)
}

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
