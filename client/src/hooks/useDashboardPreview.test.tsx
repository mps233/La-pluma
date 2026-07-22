// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardPreview } from './useDashboardPreview'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getWebrtcStatus: vi.fn(),
  captureScreen: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getWebrtcStatus: mocks.getWebrtcStatus,
    captureScreen: mocks.captureScreen,
  },
}))

vi.mock('./useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: () => ({
    status: 'idle',
    error: null,
    stats: null,
    inputReady: false,
    mediaStream: null,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    sendTouch: vi.fn(),
    sendCommand: vi.fn(),
  }),
}))

function PreviewHarness() {
  const { videoRef, statusText } = useDashboardPreview()
  return <video ref={videoRef} data-preview-status={statusText} />
}

describe('useDashboardPreview Activity lifecycle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.getWebrtcStatus.mockReset().mockResolvedValue({
      success: true,
      data: { serverRunning: true, agentRunning: true, signalingUrl: '/webrtc-signaling' },
    })
    mocks.captureScreen.mockReset().mockResolvedValue({ success: false })
    mocks.connect.mockReset()
    mocks.disconnect.mockReset()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const renderMode = async (mode: 'visible' | 'hidden') => {
    await act(async () => {
      root.render(
        <Activity mode={mode}>
          <PreviewHarness />
        </Activity>,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('auto-connects again when the dashboard workspace becomes visible again', async () => {
    await renderMode('visible')
    expect(mocks.connect).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.connect).toHaveBeenCalledTimes(2)
  })
})
