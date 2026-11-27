// @vitest-environment jsdom

import { Activity } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardPreview } from './useDashboardPreview'
import { usePreviewStore } from '@/state'

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

function previewTree(mode: 'visible' | 'hidden') {
  return (
    <Activity mode={mode}>
      <PreviewHarness />
    </Activity>
  )
}

describe('useDashboardPreview Activity lifecycle', () => {
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
  })

  afterEach(cleanup)

  afterEach(() => {
    cleanup()
    usePreviewStore.setState({ mode: 'off' })
    vi.restoreAllMocks()
  })

  it('prefers the preview service snapshot over an ADB screenshot', async () => {
    mocks.getWebrtcSnapshot.mockResolvedValue({
      success: true,
      data: {
        deviceId: 'mumu-la-pluma',
        image: 'snapshot-base64',
        mediaType: 'image/jpeg',
      },
    })

    render(previewTree('visible'))

    await waitFor(() => expect(mocks.getWebrtcSnapshot).toHaveBeenCalled())
    expect(mocks.captureScreen).not.toHaveBeenCalled()
  })

  it('keeps the live connection across an Activity hide when the preview mode stays live', async () => {
    usePreviewStore.setState({ mode: 'live' })
    const { rerender } = render(previewTree('visible'))
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce())

    rerender(previewTree('hidden'))
    rerender(previewTree('visible'))

    expect(mocks.connect).toHaveBeenCalledOnce()
  })
})
