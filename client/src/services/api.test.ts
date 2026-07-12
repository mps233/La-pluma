// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, fetchWithAuth, maaApi } from './api'

describe('maaApi WebRTC preview', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('starts the complete preview infrastructure through the combined endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        serverRunning: true,
        agentRunning: true,
        signalingUrl: 'ws://192.168.1.2:8443'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))

    const result = await maaApi.startWebrtc()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/agent/webrtc/start`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ profileId: 'default', deviceId: 'mumu-la-pluma' })
    }))
    expect(result.data?.signalingUrl).toBe('ws://192.168.1.2:8443')
  })
})

describe('fetchWithAuth connectivity errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('distinguishes browser offline state from an unavailable backend', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(fetchWithAuth('/api/agent/status')).rejects.toThrow('当前网络已断开，请恢复连接后重试')
  })

  it('keeps the backend guidance when the browser itself is online', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(fetchWithAuth('/api/agent/status')).rejects.toThrow('无法连接后端服务，请确认服务已启动')
  })
})
