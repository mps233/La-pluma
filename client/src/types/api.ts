/**
 * API 响应类型定义
 */

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface TaskExecutionResponse {
  taskId: string
  status: 'running' | 'completed' | 'failed'
  progress: number
  currentStep: number
  totalSteps: number
  startTime: number
  endTime?: number
  error?: string
}

export interface ConnectionTestResponse {
  connected: boolean
  adbVersion?: string
  deviceInfo?: {
    model: string
    androidVersion: string
  }
  error?: string
}

export interface TaskConfigResponse {
  taskFlow: TaskFlow[]
  scheduleEnabled: boolean
  scheduleTimes: string[]
  lastModified: number
}

export interface TaskFlow {
  id: string
  type: string
  name: string
  description: string
  enabled: boolean
  params: Record<string, any>
  estimatedMinutes?: number
  steps?: TaskStep[]
  order: number
}

export interface TaskStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
}

export interface ScheduleStatus {
  isRunning: boolean
  currentTask: string | null
  currentTaskId: string | null
  currentStep: number
  message: string
  startTime: number
}

export interface ConnectionConfig {
  adbPath: string
  address: string
  clientType: 'Official' | 'Bilibili' | 'YoStarEN' | 'YoStarJP' | 'YoStarKR' | 'Txwy'
}

export interface DepotData {
  items: Record<string, number>
  timestamp: number
}

export interface OperatorData {
  operators: Operator[]
  timestamp: number
}

export interface Operator {
  id: string
  name: string
  rarity: number
  elite: number
  level: number
  potential: number
  own: boolean
}

export interface DropRecord {
  stage: string
  items: Record<string, number>
  timestamp: number
  sanity: number
}

export interface NotificationConfig {
  enabled: boolean
  telegram?: {
    enabled: boolean
    botToken: string
    chatId: string
  }
}
