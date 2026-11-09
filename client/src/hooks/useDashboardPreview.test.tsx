// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardPreview } from './useDashboardPreview'
import { usePreviewStore } from '../stores'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getWebrtcStatus: vi.fn(),
  getWebrtcSnapshot: vi.fn(),
  captureScreen: vi.fn(),
  captureScreenFrame: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getWebrtcStatus: mocks.getWebrtcStatus,
    getWebrtcSnapshot: mocks.getWebrtcSnapshot,
    captureScreen: mocks.captureScreen,
    captureScreenFrame: mocks.captureScreenFrame,
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
    sendScroll: vi.fn(),
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
    usePreviewStore.setState({ mode: 'snapshot' })
    mocks.getWebrtcStatus.mockReset().mockResolvedValue({
      success: true,
      data: { serverRunning: true, signalingUrl: '/webrtc-signaling' },
    })
    mocks.getWebrtcSnapshot.mockReset().mockResolvedValue({ success: false })
    mocks.captureScreen.mockReset().mockResolvedValue({ success: false })
    mocks.captureScreenFrame.mockReset()
    mocks.connect.mockReset()
    mocks.disconnect.mockReset()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    usePreviewStore.setState({ mode: 'off' })
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

  it('prefers the preview service snapshot over an ADB screenshot', async () => {
    mocks.getWebrtcSnapshot.mockResolvedValue({
      success: true,
      data: {
        deviceId: 'mumu-la-pluma',
        image: 'snapshot-base64',
        mediaType: 'image/jpeg',
      },
    })

    await renderMode('visible')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getWebrtcSnapshot).toHaveBeenCalled()
    expect(mocks.captureScreen).not.toHaveBeenCalled()
  })

  it('keeps the live connection across an Activity hide when the preview mode stays live', async () => {
    usePreviewStore.setState({ mode: 'live' })
    await renderMode('visible')
    expect(mocks.connect).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.connect).toHaveBeenCalledOnce()
  })
})
