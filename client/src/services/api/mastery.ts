import type { ApiResponse } from '@/types/api'
import type {
  MasteryCandidate,
  MasteryCandidateStatus,
  MasteryOperatorDetail,
  MasteryPreflight,
  MasteryQueueItem,
  MasteryQueueSettings,
  MasteryQueueStatus,
} from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

// ========== 技能专精 API ==========

export async function getMasteryPreflight(): Promise<ApiResponse<MasteryPreflight>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/preflight`)
  return parseJsonResponse(response)
}

export async function getMasteryCatalog(params: {
  clientType?: string
  search?: string
  rarity?: number | null
  status?: MasteryCandidateStatus
  limit?: number
} = {}): Promise<ApiResponse<{ operators: MasteryCandidate[]; total: number; dataFreshness: unknown }>> {
  const searchParams = new URLSearchParams()
  if (params.clientType) searchParams.append('clientType', params.clientType)
  if (params.search) searchParams.append('search', params.search)
  if (params.rarity) searchParams.append('rarity', String(params.rarity))
  if (params.status) searchParams.append('status', params.status)
  if (params.limit) searchParams.append('limit', String(params.limit))
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/catalog?${searchParams}`)
  return parseJsonResponse(response)
}

export async function getMasteryOperator(
  operatorId: string,
  declaredLevel: number = 0
): Promise<ApiResponse<MasteryOperatorDetail>> {
  const searchParams = new URLSearchParams({ declaredLevel: String(declaredLevel) })
  const response = await fetchWithAuth(
    `${API_BASE_URL}/agent/operator-mastery/operators/${encodeURIComponent(operatorId)}?${searchParams}`
  )
  return parseJsonResponse(response)
}

export async function getMasteryStatus(): Promise<ApiResponse<MasteryQueueStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/status`)
  return parseJsonResponse(response)
}

export async function addMasteryTargets(
  items: Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel?: number }>
): Promise<ApiResponse<{ items: MasteryQueueItem[]; added: number }>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  })
  return parseJsonResponse(response)
}

export async function updateMasteryTarget(
  id: string,
  patch: { targetLevel?: number; enabled?: boolean }
): Promise<ApiResponse<MasteryQueueItem>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  return parseJsonResponse(response)
}

export async function removeMasteryTarget(id: string): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/items/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
  return parseJsonResponse(response)
}

export async function reorderMasteryTargets(order: string[]): Promise<ApiResponse<{ items: MasteryQueueItem[] }>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/items/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  })
  return parseJsonResponse(response)
}

export async function updateMasterySettings(
  settings: Partial<MasteryQueueSettings>
): Promise<ApiResponse<MasteryQueueSettings>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  return parseJsonResponse(response)
}

export async function startMasteryCampaign(dryRun = false): Promise<ApiResponse<MasteryQueueStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun })
  })
  return parseJsonResponse(response)
}

export async function pauseMasteryCampaign(): Promise<ApiResponse<MasteryQueueStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  return parseJsonResponse(response)
}

export async function resumeMasteryCampaign(): Promise<ApiResponse<MasteryQueueStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  return parseJsonResponse(response)
}

export async function stopMasteryCampaign(): Promise<ApiResponse<MasteryQueueStatus & { task?: unknown }>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/operator-mastery/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  return parseJsonResponse(response)
}

export async function retryMasteryTarget(id: string): Promise<ApiResponse<MasteryQueueItem>> {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/agent/operator-mastery/items/${encodeURIComponent(id)}/retry`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
  )
  return parseJsonResponse(response)
}


