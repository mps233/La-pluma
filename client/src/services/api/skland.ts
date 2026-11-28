import type { ApiResponse } from '@/types/api'
import type { SklandSnapshot, SklandStatus } from '@/types/components'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

// ========== 森空岛数据源 API ==========

export async function getSklandStatus(): Promise<ApiResponse<SklandStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/status`)
  return parseJsonResponse(response)
}

export async function getSklandSnapshot(): Promise<ApiResponse<{ available: boolean; snapshot: SklandSnapshot }>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/snapshot`)
  return parseJsonResponse(response)
}

export async function loginSkland(
  account: string,
  password: string,
  uid?: string
): Promise<ApiResponse<SklandStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, uid: uid || '' }),
  })
  return parseJsonResponse(response)
}

export async function saveSklandCredentials(
  cred: string,
  token: string,
  uid?: string
): Promise<ApiResponse<SklandStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cred, token, uid: uid || '' }),
  })
  return parseJsonResponse(response)
}

export async function clearSklandCredentials(): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/credentials`, {
    method: 'DELETE',
  })
  return parseJsonResponse(response)
}

export async function syncSkland(): Promise<ApiResponse<SklandStatus>> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/skland/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return parseJsonResponse(response)
}

