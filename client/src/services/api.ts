/**
 * MAA API 服务
 * 提供与后端 API 交互的所有方法
 */

import type { ApiResponse } from '@/types/api'

/**
 * 自动检测 API 地址
 * 如果是 localhost，使用 localhost
 * 如果是通过 IP 访问，使用相同的 IP 地址
 */
const getApiBaseUrl = (): string => {
  const hostname = window.location.hostname
  // 直接使用当前页面的端口，不使用环境变量
  const port = window.location.port || '3000'
  
  // 如果是 localhost 或 127.0.0.1，使用 localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://localhost:${port}/api`
  }
  
  // 否则使用当前访问的 IP 地址
  return `http://${hostname}:${port}/api`
}

const API_BASE_URL = getApiBaseUrl()

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
 * 材料目标接口
 */
interface MaterialGoal {
  materialId: string
  targetAmount: number
}

/**
 * 材料计划接口
 */
interface MaterialPlan {
  stages: Array<{
    stageId: string
    stageName: string
    times: number
    sanity: number
  }>
  totalSanity: number
}

/**
 * 材料计划转换选项
 */
interface MaterialPlanOptions {
  useMedicine?: number
  useStone?: number
  series?: number
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
  priority?: number
}

/**
 * 养成设置
 */
interface TrainingSettings {
  autoSwitch: boolean
  notify: boolean
  useMedicine?: number
  useStone?: number
}

/**
 * 养成计划应用数据
 */
interface ApplyTrainingPlanData {
  plan: any
  options?: any
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
  // ========== 基础信息 ==========
  
  /**
   * 获取版本信息
   */
  async getVersion(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/version`)
    return response.json()
  },

  /**
   * 获取配置目录
   */
  async getConfigDir(): Promise<ApiResponse<string>> {
    const response = await fetch(`${API_BASE_URL}/maa/config-dir`)
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
      },
      body: JSON.stringify(body)
    }
    
    // 如果提供了 abort signal，添加到 fetch 选项中
    if (signal) {
      fetchOptions.signal = signal
    }
    
    const response = await fetch(`${API_BASE_URL}/maa/execute`, fetchOptions)
    return response.json()
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
    // 如果 params 包含空格，说明是多个参数，需要分割
    const args = params ? params.split(' ').filter(arg => arg.trim()) : []
    return this.executeCommand(taskType, args, taskConfig, signal, taskName, taskTypeLabel, waitForCompletion)
  },

  /**
   * 获取任务执行状态
   */
  async getTaskStatus(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/task-status`)
    return response.json()
  },

  /**
   * 终止当前任务
   */
  async stopTask(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/stop-task`, {
      method: 'POST',
    })
    return response.json()
  },

  // ========== 日志管理 ==========
  
  /**
   * 获取实时日志
   */
  async getRealtimeLogs(lines: number = 100): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/realtime-logs?lines=${lines}`)
    return response.json()
  },

  /**
   * 清空实时日志
   */
  async clearRealtimeLogs(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/realtime-logs/clear`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 获取日志文件列表
   */
  async getLogFiles(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/logs`)
    return response.json()
  },

  /**
   * 读取日志文件内容
   */
  async readLogFile(filePath: string, lines: number = 1000): Promise<ApiResponse> {
    const encodedPath = encodeURIComponent(filePath)
    const response = await fetch(`${API_BASE_URL}/maa/logs/${encodedPath}?lines=${lines}`)
    return response.json()
  },

  /**
   * 手动清理日志文件
   */
  async cleanupLogs(maxSizeMB: number = 10): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/logs/cleanup`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/config/${profileName}`)
    return response.json()
  },

  /**
   * 保存配置
   */
  async saveConfig(profileName: string = 'default', config: any): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/config/${profileName}`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/test-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ adbPath, address }),
    })
    return response.json()
  },

  // ========== 截图功能 ==========
  
  /**
   * 截图功能
   */
  async captureScreen(
    adbPath: string = '/opt/homebrew/bin/adb',
    address: string = '127.0.0.1:16384'
  ): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ adbPath, address }),
    })
    return response.json()
  },

  /**
   * 获取调试截图
   */
  async getDebugScreenshots(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/debug-screenshots`)
    return response.json()
  },

  // ========== 活动信息 ==========
  
  /**
   * 获取当前活动信息
   */
  async getActivity(clientType: string = 'Official'): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/activity?clientType=${clientType}`)
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
    const response = await fetch(`${API_BASE_URL}/maa/schedule`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/schedule/${scheduleId}`, {
      method: 'DELETE',
    })
    return response.json()
  },

  /**
   * 获取定时任务状态
   */
  async getScheduleStatus(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/schedule/status`)
    return response.json()
  },

  /**
   * 获取定时任务执行状态
   */
  async getScheduleExecutionStatus(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/schedule/execution-status`)
    return response.json()
  },

  /**
   * 立即执行定时任务
   */
  async executeScheduleNow(scheduleId: string = 'default', taskFlow: any[]): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/schedule/${scheduleId}/execute`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/update-core`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/update-cli`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 热更新资源文件
   */
  async hotUpdateResources(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/hot-update`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 设置自动更新
   */
  async setupAutoUpdate(config: AutoUpdateConfig): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/auto-update`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/auto-update/status`)
    return response.json()
  },

  /**
   * 获取 MaaCore 更新日志（最新的 Beta 和正式版）
   */
  async getMaaCoreChangelog(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/changelog/core`)
    return response.json()
  },

  /**
   * 获取 MAA CLI 更新日志（最新的正式版）
   */
  async getMaaCliChangelog(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/changelog/cli`)
    return response.json()
  },

  // ========== 用户配置存储 ==========
  
  /**
   * 保存用户配置到服务器
   */
  async saveUserConfig(configType: string, data: any): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/user-config/${configType}`, {
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
    const response = await fetch(`${API_BASE_URL}/maa/user-config/${configType}`)
    return response.json()
  },

  /**
   * 获取所有用户配置
   */
  async getAllUserConfigs(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/user-configs`)
    return response.json()
  },

  /**
   * 删除用户配置
   */
  async deleteUserConfig(configType: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/user-config/${configType}`, {
      method: 'DELETE',
    })
    return response.json()
  },

  // ========== 数据统计 ==========
  
  /**
   * 解析并保存仓库数据
   */
  async parseDepotData(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/data/depot/parse`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 解析并保存干员数据
   */
  async parseOperBoxData(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/data/operbox/parse`, {
      method: 'POST',
    })
    return response.json()
  },

  /**
   * 获取已保存的仓库数据
   */
  async getDepotData(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/data/depot`)
    return response.json()
  },

  /**
   * 获取已保存的干员数据
   */
  async getOperBoxData(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/data/operbox`)
    return response.json()
  },

  /**
   * 获取所有干员列表
   */
  async getAllOperators(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/maa/data/all-operators`)
    return response.json()
  },

  /**
   * 获取作业信息（通过后端代理，避免 CORS）
   */
  async getCopilotInfo(copilotId: string): Promise<ApiResponse<CopilotSetInfo>> {
    const response = await fetch(`${API_BASE_URL}/maa/copilot/get/${copilotId}`)
    return response.json()
  },

  // ========== 材料规划相关 API ==========
  
  /**
   * 获取材料列表
   */
  async getMaterialsList(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/material-planner/materials`)
    return response.json()
  },

  /**
   * 获取用户材料计划
   */
  async getUserMaterialPlans(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/material-planner/plans`)
    return response.json()
  },

  /**
   * 保存用户材料计划
   */
  async saveUserMaterialPlans(plans: MaterialGoal[]): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/material-planner/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plans)
    })
    return response.json()
  },

  /**
   * 生成材料刷取计划
   */
  async generateMaterialPlan(
    materialGoals: MaterialGoal[],
    currentInventory: Record<string, number>
  ): Promise<ApiResponse<MaterialPlan>> {
    const response = await fetch(`${API_BASE_URL}/material-planner/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialGoals, currentInventory })
    })
    return response.json()
  },

  /**
   * 将材料计划转换为任务流程
   */
  async convertMaterialPlanToTasks(
    plan: MaterialPlan,
    options: MaterialPlanOptions
  ): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/material-planner/convert-to-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, options })
    })
    return response.json()
  },

  /**
   * 更新材料进度
   */
  async updateMaterialProgress(materialId: string, amount: number): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/material-planner/update-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId, amount })
    })
    return response.json()
  },

  // ========== 干员养成相关 API ==========
  
  /**
   * 生成养成计划
   */
  async generateTrainingPlan(mode: 'current' | 'all' = 'current'): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE_URL}/operator-training/plan`, {
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
  
  const response = await fetch(`${API_BASE_URL}/operator-training/operators?${params}`)
  return response.json()
}

/**
 * 获取养成队列
 */
export async function getTrainingQueue(): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/operator-training/queue`)
  return response.json()
}

/**
 * 添加干员到养成队列
 */
export async function addToTrainingQueue(data: TrainingQueueData): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/operator-training/queue`, {
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
  const response = await fetch(`${API_BASE_URL}/operator-training/queue/${operatorId}`, {
    method: 'DELETE'
  })
  return response.json()
}

/**
 * 更新队列顺序
 */
export async function updateTrainingQueueOrder(operatorIds: string[]): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/operator-training/queue/order`, {
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
  const response = await fetch(`${API_BASE_URL}/operator-training/settings`, {
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
  const response = await fetch(`${API_BASE_URL}/operator-training/plan`, {
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
  const response = await fetch(`${API_BASE_URL}/operator-training/apply`, {
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
  const response = await fetch(`${API_BASE_URL}/operator-training/fetch-materials`, {
    method: 'POST'
  })
  return response.json()
}

// ========== 悖论模拟 API ==========

/**
 * 搜索悖论模拟作业
 */
export async function searchParadoxCopilot(operatorName: string): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/paradox/search?name=${encodeURIComponent(operatorName)}`)
  return response.json()
}

/**
 * 获取所有悖论模拟干员列表
 */
export async function getParadoxOperators(): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/paradox/operators`)
  return response.json()
}

/**
 * 搜索普通关卡作业
 */
export async function searchCopilot(stageName: string): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/copilot/search?stage=${encodeURIComponent(stageName)}`)
  return response.json()
}

// ==================== 掉落记录 API ====================

/**
 * 获取今日掉落记录
 */
export async function getTodayDrops(): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/drops/today`)
  return response.json()
}

/**
 * 获取最近几天的掉落记录
 */
export async function getRecentDrops(days: number = 7): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/drops/recent?days=${days}`)
  return response.json()
}

/**
 * 获取掉落统计数据
 */
export async function getDropStatistics(days: number = 7): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/maa/drops/statistics?days=${days}`)
  return response.json()
}

export default maaApi
