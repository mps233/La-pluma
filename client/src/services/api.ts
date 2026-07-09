/**
 * MAA API 服务
 * 提供与后端 API 交互的所有方法
 */

import type { ApiResponse } from '@/types/api'
import type { TrainingPlan, TrainingSettings } from '@/types/components'

/**
 * 自动检测 API 地址
 * 始终使用当前页面同源地址。
 * 开发环境由 Vite proxy 转发 /api，生产环境由 Express 同源服务前端和 API。
 */
const getApiBaseUrl = (): string => {
  return `${window.location.origin}/api`
}

export const API_BASE_URL = getApiBaseUrl()

export const getItemIconUrl = (iconId: string | number): string =>
  `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/refs/heads/main/item/${encodeURIComponent(String(iconId))}.png`

const getStoredToken = (): string => {
  const rawToken = localStorage.getItem('laPlumaToken') || ''
  const token = rawToken.replace(/^Bearer\s+/i, '').trim()

  // Headers.set() throws "The string did not match the expected pattern" when
  // the value contains CR/LF or other control characters. Treat malformed
  // stored tokens as absent so API calls can return a normal 401 instead of
  // crashing the UI action.
  return /[\u0000-\u001f\u007f]/.test(token) ? '' : token
}

export const getAuthHeaders = (): Record<string, string> => {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}`, 'X-La-Pluma-Token': token } : {}
}

export const fetchWithAuth = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {})
  Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value))
  return fetch(input, { ...init, headers })
}

/**
 * 任务配置接口
 */
interface TaskConfig {
  [key: string]: any
}

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
  priority?: number
}

/**
 * 养成计划应用数据
 */
interface ApplyTrainingPlanData {
  plan: TrainingPlan
  settings?: TrainingSettings
  taskType?: 'combat'
}

/**
 * 干员筛选条件
 */
interface OperatorFilters {
  rarity?: number
  profession?: string
  owned?: boolean
  needsElite2?: boolean
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
  async getVersion(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/version`)
    return response.json()
  },

  /**
   * 获取配置目录
   */
  async getConfigDir(): Promise<ApiResponse<string>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config-directory`)
    return response.json()
  },

  /**
   * 在本机文件管理器中打开配置目录
   */
  async openConfigDir(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/open-config-directory`, { method: 'POST' })
    return response.json()
  },

  // ========== 命令执行 ==========
  
  /**
   * 执行 MAA 命令
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    taskConfig: TaskConfig | null = null,
    signal: AbortSignal | null = null,
    taskName: string | null = null,
    taskType: string | null = null,
    waitForCompletion: boolean = false
  ): Promise<ApiResponse> {
    const body: Record<string, any> = { command, args }
    
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
    return response.json()
  },

  /**
   * 使用结构化参数执行预定义任务，避免字符串 split 破坏本地路径/URL
   */
  async executePredefinedTaskArgs(
    taskType: string,
    args: string[] = [],
    taskConfig: TaskConfig | null = null,
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
    taskConfig: TaskConfig | null = null,
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

  /**
   * 获取任务执行状态
   */
  async getTaskStatus(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/tasks/status`)
    return response.json()
  },

  /**
   * 终止当前任务
   */
  async stopTask(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/stop`, {
      method: 'POST',
    })
    return response.json()
  },

  // ========== 日志管理 ==========
  
  /**
   * 获取实时日志
   */
  async getRealtimeLogs(lines: number = 100): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/recent?lines=${lines}`)
    return response.json()
  },

  /**
   * 清空实时日志
   */
  async clearRealtimeLogs(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/recent/clear`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 获取日志文件列表
   */
  async getLogFiles(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/files`)
    return response.json()
  },

  /**
   * 读取日志文件内容
   */
  async readLogFile(filePath: string, lines: number = 1000): Promise<ApiResponse> {
    const encodedPath = encodeURIComponent(filePath)
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/logs/files/${encodedPath}?lines=${lines}`)
    return response.json()
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
    return response.json()
  },

  // ========== 任务管理 ==========
  
  /**
   * 列出所有任务
   */
  async listTasks(): Promise<ApiResponse> {
    return this.executeCommand('list')
  },

  // ========== 配置管理 ==========
  
  /**
   * 获取配置
   */
  async getConfig(profileName: string = 'default'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/maa/${profileName}`)
    return response.json()
  },

  /**
   * 保存配置
   */
  async saveConfig(profileName: string = 'default', config: any): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/maa/${profileName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })
    return response.json()
  },

  // ========== 连接测试 ==========
  
  /**
   * 测试 ADB 连接
   */
  async testConnection(adbPath: string, address: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ adbPath, address }),
    })
    return response.json()
  },

  async getWebrtcStatus(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/status`)
    return response.json()
  },

  async installWebrtc(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/install`, { method: 'POST' })
    return response.json()
  },

  async startWebrtcServer(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start-server`, { method: 'POST' })
    return response.json()
  },

  async stopWebrtcServer(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/stop-server`, { method: 'POST' })
    return response.json()
  },

  async startWebrtcAgent(address: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/start-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    })
    return response.json()
  },

  async stopWebrtcAgent(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/webrtc/stop-agent`, { method: 'POST' })
    return response.json()
  },

  async setPreviewOrientation(orientation: 'portrait' | 'landscape' | 'auto', address = '127.0.0.1:16384'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/preview/orientation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orientation, address })
    })
    return response.json()
  },

  async captureScreen(address = '127.0.0.1:16384'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/screen/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    })
    return response.json()
  },

  async getDeviceStats(address?: string): Promise<ApiResponse> {
    const qs = address ? `?address=${encodeURIComponent(address)}` : ''
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/device-stats${qs}`)
    return response.json()
  },

  // ========== 活动信息 ==========
  
  /**
   * 获取当前活动信息
   */
  async getActivity(clientType: string = 'Official'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/activity?clientType=${clientType}`)
    return response.json()
  },

  // ========== 定时任务管理 ==========
  
  /**
   * 设置定时任务
   */
  async setupSchedule(
    scheduleId: string = 'default',
    times: string[],
    taskFlow: any[]
  ): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scheduleId, times, taskFlow }),
    })
    return response.json()
  },

  /**
   * 停止定时任务
   */
  async stopSchedule(scheduleId: string = 'default'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}`, {
      method: 'DELETE',
    })
    return response.json()
  },

  /**
   * 获取定时任务状态
   */
  async getScheduleStatus(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/status`)
    return response.json()
  },

  /**
   * 获取定时任务执行状态
   */
  async getScheduleExecutionStatus(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/execution`)
    return response.json()
  },

  /**
   * 立即执行定时任务
   */
  async executeScheduleNow(scheduleId: string = 'default', taskFlow: any[]): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskFlow }),
    })
    return response.json()
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
    return response.json()
  },

  /**
   * 更新 MAA CLI
   */
  async updateMaaCli(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/update-cli`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 热更新资源文件
   */
  async hotUpdateResources(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/hot-update-resources`, {
      method: 'POST',
    })
    return response.json()
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
    return response.json()
  },

  /**
   * 获取自动更新状态
   */
  async getAutoUpdateStatus(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/auto-update/status`)
    return response.json()
  },

  /**
   * 获取 MaaCore 更新日志（最新的 Beta 和正式版）
   */
  async getMaaCoreChangelog(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/changelog/core`)
    return response.json()
  },

  /**
   * 获取 MAA CLI 更新日志（最新的正式版）
   */
  async getMaaCliChangelog(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/changelog/cli`)
    return response.json()
  },

  // ========== 用户配置存储 ==========
  
  /**
   * 保存用户配置到服务器
   */
  async saveUserConfig(configType: string, data: any): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user/${configType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    return response.json()
  },

  /**
   * 从服务器读取用户配置
   */
  async loadUserConfig(configType: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user/${configType}`)
    return response.json()
  },

  /**
   * 获取所有用户配置
   */
  async getAllUserConfigs(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user`)
    return response.json()
  },

  /**
   * 删除用户配置
   */
  async deleteUserConfig(configType: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/config/user/${configType}`, {
      method: 'DELETE',
    })
    return response.json()
  },

  // ========== 数据统计 ==========
  
  /**
   * 解析并保存仓库数据
   */
  async parseDepotData(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/depot-recognition`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 解析并保存干员数据
   */
  async parseOperBoxData(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/operbox-recognition`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 获取已保存的仓库数据
   */
  async getDepotData(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/depot`)
    return response.json()
  },

  /**
   * 获取已保存的干员数据
   */
  async getOperBoxData(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/operbox`)
    return response.json()
  },

  /**
   * 获取所有干员列表
   */
  async getAllOperators(): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/data/operators`)
    return response.json()
  },

  /**
   * 获取作业信息（通过后端代理，避免 CORS）
   */
  async getCopilotInfo(copilotId: string): Promise<ApiResponse<CopilotSetInfo>> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilots/${copilotId}`)
    return response.json()
  },

  /**
   * 获取作业集信息（通过后端代理，避免 CORS）
   */
  async getCopilotSet(copilotId: string): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot-sets/${copilotId}`)
    return response.json()
  },

  // ========== 干员养成相关 API ==========
  
  /**
   * 生成养成计划
   */
  async generateTrainingPlan(mode: 'current' | 'all' = 'current'): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    })
    return response.json()
  },
}

// ========== 干员养成相关 API（独立导出函数）==========

/**
 * 获取干员列表
 */
export async function getOperatorList(filters: OperatorFilters = {}): Promise<ApiResponse> {
  const params = new URLSearchParams()
  if (filters.rarity) params.append('rarity', filters.rarity.toString())
  if (filters.profession) params.append('profession', filters.profession)
  if (filters.owned !== undefined) params.append('owned', filters.owned.toString())
  if (filters.needsElite2) params.append('needsElite2', 'true')
  
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/operators?${params}`)
  return response.json()
}

/**
 * 获取养成队列
 */
export async function getTrainingQueue(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue`)
  return response.json()
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
  return response.json()
}

/**
 * 从养成队列中移除干员
 */
export async function removeFromTrainingQueue(operatorId: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/${operatorId}`, {
    method: 'DELETE'
  })
  return response.json()
}

/**
 * 更新队列顺序
 */
export async function updateTrainingQueueOrder(operatorIds: string[]): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorIds })
  })
  return response.json()
}

/**
 * 更新养成设置
 */
export async function updateTrainingSettings(settings: TrainingSettings): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  return response.json()
}

/**
 * 生成养成计划
 */
export async function generateTrainingPlan(options: TrainingPlanOptions): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  })
  return response.json()
}

/**
 * 应用养成计划到任务流程
 */
export async function applyTrainingPlan(data: ApplyTrainingPlanData): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/apply-training-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return response.json()
}

/**
 * 获取干员材料数据
 */
export async function fetchOperatorMaterials(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/fetch-training-materials`, {
    method: 'POST'
  })
  return response.json()
}

// ========== 悖论模拟 API ==========

/**
 * 搜索悖论模拟作业
 */
export async function searchParadoxCopilot(operatorName: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/paradox/search?name=${encodeURIComponent(operatorName)}`)
  return response.json()
}

/**
 * 获取所有悖论模拟干员列表
 */
export async function getParadoxOperators(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/paradox/operators`)
  return response.json()
}

/**
 * 搜索普通关卡作业
 */
export async function searchCopilot(stageName: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/copilot/search?stage=${encodeURIComponent(stageName)}`)
  return response.json()
}

// ==================== 掉落记录 API ====================

/**
 * 获取今日掉落记录
 */
export async function getTodayDrops(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/drops/today`)
  return response.json()
}

/**
 * 获取最近几天的掉落记录
 */
export async function getRecentDrops(days: number = 7): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/drops/recent?days=${days}`)
  return response.json()
}

/**
 * 获取掉落统计数据
 */
export async function getDropStatistics(days: number = 7): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/drops/statistics?days=${days}`)
  return response.json()
}

// ==================== 森空岛 API ====================

/**
 * 发送森空岛验证码
 */
export async function sklandSendCode(phone: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  return response.json()
}

/**
 * 森空岛登录（使用验证码或密码）
 */
export async function sklandLogin(phone: string, codeOrPassword: string, savePassword: boolean = false): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: codeOrPassword, savePassword })
  })
  return response.json()
}

/**
 * 森空岛登出
 */
export async function sklandLogout(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/logout`, {
    method: 'POST'
  })
  return response.json()
}

/**
 * 获取森空岛登录状态
 */
export async function getSklandStatus(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/status`)
  return response.json()
}

/**
 * 获取森空岛玩家完整数据
 */
export async function getSklandPlayerData(useCache: boolean = true): Promise<ApiResponse> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/player?cache=${useCache}`)
    const data = await response.json()
    
    // 如果响应不是 200，返回错误
    if (!response.ok) {
      return {
        success: false,
        error: data.error || '获取玩家数据失败'
      }
    }
    
    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络请求失败'
    }
  }
}

/**
 * 刷新森空岛玩家数据（强制从服务器获取最新数据）
 */
export async function refreshSklandPlayerData(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/refresh`, {
    method: 'POST'
  })
  return response.json()
}

export async function getOpenTodayStages(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/stages/open-today`)
  return response.json()
}

export default maaApi
