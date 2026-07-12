// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, maaApi } from './api'

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
