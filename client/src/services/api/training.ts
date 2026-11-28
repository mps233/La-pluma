import type { ApiResponse } from '@/types/api'
import type {
  OperBoxData,
  OperatorDetailed,
  TrainingOperator,
  TrainingPlan,
  TrainingQueueItem,
  TrainingSettings,
} from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

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


