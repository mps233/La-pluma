import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from '../client'
import type { WebrtcSnapshotData, WebrtcStatusData } from '../types'

export const connectionsApi = {
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

}
