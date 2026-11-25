// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from '@/shared/api'
import {
  captureScreen,
  getDeviceStats,
  getWebrtcStatus,
  installWebrtc,
  startWebrtc,
  startWebrtcAgent,
  startWebrtcServer,
  stopWebrtcAgent,
  stopWebrtcServer,
} from './index'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('device-mirror WebRTC preview', () => {
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

    const result = await startWebrtc()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/agent/webrtc/start`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ profileId: 'default', deviceId: 'mumu-la-pluma' })
    }))
    expect(result.data?.signalingUrl).toBe('ws://192.168.1.2:8443')
  })

  it('posts each infrastructure and capture action to its preview endpoint', async () => {
    const endpoints: [string, () => Promise<unknown>, string, unknown?][] = [
      ['install', () => installWebrtc(), '/agent/webrtc/install'],
      ['start-server', () => startWebrtcServer(), '/agent/webrtc/start-server'],
      ['stop-server', () => stopWebrtcServer(), '/agent/webrtc/stop-server'],
      ['start-agent', () => startWebrtcAgent('default'), '/agent/webrtc/start-agent', { profileId: 'default' }],
      ['stop-agent', () => stopWebrtcAgent(), '/agent/webrtc/stop-agent'],
      ['capture-screen', () => captureScreen('default'), '/agent/screen/screenshot', { profileId: 'default' }],
    ]

    for (const [name, action, path, body] of endpoints) {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true }))
      const result = await action()

      expect(fetchMock, name).toHaveBeenCalledWith(
        `${API_BASE_URL}${path}`,
        expect.objectContaining({
          method: 'POST',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      )
      expect(result, name).toMatchObject({ success: true })
      fetchMock.mockRestore()
    }
  })

  it('forwards the signal when reading WebRTC status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { serverRunning: false, agentRunning: false, signalingUrl: '/webrtc-signaling' },
    }))
    const controller = new AbortController()

    const result = await getWebrtcStatus(controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/agent/webrtc/status`, expect.objectContaining({
      signal: controller.signal,
    }))
    expect(result.success).toBe(true)
    expect(result.data?.signalingUrl).toBe('/webrtc-signaling')
  })

  it('rejects a malformed WebRTC status payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: 'not-an-object',
    }))

    const result = await getWebrtcStatus()

    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'INVALID_DOMAIN_PAYLOAD',
      message: '预览服务状态格式不正确',
    })
  })

  it('forwards the signal for device stats and keeps the null legacy payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: null,
    }))
    const controller = new AbortController()

    const result = await getDeviceStats('127.0.0.1:5555', controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/agent/device-stats?address=127.0.0.1%3A5555`,
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })
})
