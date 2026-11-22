import {
  API_BASE_URL,
  fetchWithAuth,
  isRecord,
  parseJsonResponse,
  readApiResponse,
  type ApiResponse,
} from '@/shared/api'
import type {
  TrainingPlan,
  TrainingQueueMutationData,
  TrainingQueueSnapshot,
  TrainingSettings,
} from '../types'

interface OperatorFilters {
  rarity?: number
  profession?: string
  owned?: boolean
  needsElite2?: boolean
  status?: 'trainable' | 'owned' | 'all'
}

export interface TrainingPlanOptions {
  mode: 'current' | 'all'
}

interface TrainingQueueData {
  operatorId: string
  currentElite?: number
  targetElite?: number
  priority?: number
  position?: number
}

export interface ApplyTrainingPlanData {
  plan: TrainingPlan
  settings?: TrainingSettings
  taskType?: 'combat'
}

const isOperatorListPayload = (payload: unknown): boolean =>
  Array.isArray(payload) || (isRecord(payload) && Array.isArray(payload.operators))

const isTrainingQueuePayload = (payload: unknown): boolean =>
  isRecord(payload) && Array.isArray(payload.queue)

export async function getOperatorList(
  filters: OperatorFilters = {},
  signal?: AbortSignal,
): Promise<ApiResponse> {
  const params = new URLSearchParams()
  if (filters.rarity) params.append('rarity', filters.rarity.toString())
  if (filters.profession) params.append('profession', filters.profession)
  if (filters.owned !== undefined) params.append('owned', filters.owned.toString())
  if (filters.needsElite2) params.append('needsElite2', 'true')
  if (filters.status) params.append('status', filters.status)

  return readApiResponse(`${API_BASE_URL}/agent/training/operators?${params}`, {
    signal,
    validate: isOperatorListPayload,
    invalidPayloadMessage: '干员列表格式不正确',
  })
}

export async function getTrainingQueue(
  signal?: AbortSignal,
): Promise<ApiResponse<TrainingQueueSnapshot>> {
  return readApiResponse(`${API_BASE_URL}/agent/training/queue`, {
    signal,
    validate: isTrainingQueuePayload,
    invalidPayloadMessage: '养成队列数据格式不正确',
  })
}

export async function addToTrainingQueue(
  data: TrainingQueueData,
): Promise<ApiResponse<TrainingQueueMutationData>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return parseJsonResponse(response)
}

export async function removeFromTrainingQueue(
  operatorId: string,
): Promise<ApiResponse<TrainingQueueMutationData>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/${operatorId}`, {
    method: 'DELETE'
  })
  return parseJsonResponse(response)
}

export async function updateTrainingQueueOrder(
  operatorIds: string[],
): Promise<ApiResponse<TrainingQueueMutationData>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/queue/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorIds })
  })
  return parseJsonResponse(response)
}

export async function retryTrainingSync(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/sync`, { method: 'POST' })
  return parseJsonResponse(response)
}

export async function updateTrainingSettings(
  settings: Partial<TrainingSettings>,
): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  return parseJsonResponse(response)
}

export async function generateTrainingPlan(options: TrainingPlanOptions): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/training/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  })
  return parseJsonResponse(response)
}

export async function applyTrainingPlan(data: ApplyTrainingPlanData): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/apply-training-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return parseJsonResponse(response)
}

/**
 * 获取干员材料数据
 *
 * 这是刷新材料缓存的脚本入口，不占设备执行租约。`signal` 只结束本地等待，
 * 服务端可能已经完成脚本刷新；因此超时后不能把它当作确定失败。
 */
export async function fetchOperatorMaterials(signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/fetch-training-materials`, {
    method: 'POST',
    signal,
  })
  return parseJsonResponse(response)
}
