import { notifyAuthRequired, readAccessToken } from '@/utils/accessToken'
import { getItemIconCacheVersion } from '../itemIconCache'

/**
 * 自动检测 API 地址
 * 始终使用当前页面同源地址。
 * 开发环境由 Vite proxy 转发 /api，生产环境由 Go server 同源服务前端和 API。
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

export const getAuthHeaders = (): Record<string, string> => {
  const token = readAccessToken()
  return token ? { Authorization: `Bearer ${token}`, 'X-La-Pluma-Token': token } : {}
}

export const fetchWithAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {})
  Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value))

  try {
    const response = await fetch(input, { ...init, headers })
    if (response.status === 401) notifyAuthRequired()
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('当前网络已断开，请恢复连接后重试')
    }
    throw new Error('无法连接后端服务，请确认服务已启动')
  }
}
