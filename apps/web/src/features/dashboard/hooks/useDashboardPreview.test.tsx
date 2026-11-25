// @vitest-environment jsdom

import { Activity, act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardPreview } from './useDashboardPreview'
import { PreviewSessionProvider, usePreviewStore } from '@/features/device-mirror'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
}))

const signalingConnections: string[] = []
let screenshotPending = false

const jsonResponse = (payload: unknown) => ({ text: async () => JSON.stringify(payload) }) as Response
const callsFor = (suffix: string) => mocks.fetchWithAuth.mock.calls
  .filter(([input]) => String(input).endsWith(suffix))
const startCalls = () => callsFor('/agent/webrtc/start')
const screenshotCalls = () => callsFor('/agent/screen/screenshot')

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    signalingConnections.push(url)
  }

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED
  }
}

vi.mock('@/features/runtime-status', () => ({ useAutomationAvailability: () => ({ isAvailable: true }) }))

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>()
  return { ...actual, fetchWithAuth: mocks.fetchWithAuth }
})

let retryPreview: () => void

function PreviewHarness() {
  const { videoRef, status, retry } = useDashboardPreview()
  useEffect(() => { retryPreview = retry })
  return <video ref={videoRef} data-preview-status={status.label} data-preview-phase={status.phase} />
}

describe('useDashboardPreview Activity lifecycle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    usePreviewStore.setState({ mode: 'off' })
    signalingConnections.length = 0
    screenshotPending = false
    mocks.fetchWithAuth.mockReset().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/agent/webrtc/start')) {
        return Promise.resolve(jsonResponse({ success: true, data: { signalingUrl: '/webrtc-signaling' } }))
      }
      if (url.endsWith('/api/login')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ token: 'test-token' }) })
      }
      if (url.endsWith('/agent/screen/screenshot')) {
        return screenshotPending ? new Promise(() => {}) : Promise.resolve(jsonResponse({ success: false }))
      }
      return Promise.resolve(jsonResponse({ success: false }))
    })
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const renderMode = async (mode: 'visible' | 'hidden') => {
    await act(async () => {
      root.render(
        <PreviewSessionProvider><Activity mode={mode}>
          <PreviewHarness />
        </Activity></PreviewSessionProvider>,
      )
      await Promise.resolve()
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
      await Promise.resolve()
    })
  }

  it('keeps the shared live connection while the dashboard hides and returns', async () => {
    usePreviewStore.getState().setMode('live')
    await renderMode('visible')
    expect(signalingConnections).toHaveLength(1)

    await renderMode('hidden')
    await renderMode('visible')

    expect(signalingConnections).toHaveLength(1)
  })

  it('does not connect or capture a screenshot merely because the service is online', async () => {
    await renderMode('visible')
    expect(startCalls()).toHaveLength(0)
    expect(signalingConnections).toHaveLength(0)
    expect(screenshotCalls()).toHaveLength(0)
    expect(container.querySelector('video')?.dataset.previewStatus).toBe('预览已关闭')
    expect(container.querySelector('video')?.dataset.previewPhase).toBe('off')
  })

  it('reports a connecting state while the first snapshot is pending', async () => {
    screenshotPending = true
    usePreviewStore.getState().setMode('snapshot')
    await renderMode('visible')

    expect(container.querySelector('video')?.dataset.previewPhase).toBe('snapshot-loading')
  })

  it('stays off after the user closes preview and changes workspaces', async () => {
    usePreviewStore.getState().setMode('live')
    await renderMode('visible')
    await act(async () => usePreviewStore.getState().setMode('off'))
    await renderMode('hidden')
    await renderMode('visible')
    expect(signalingConnections).toHaveLength(1)
    expect(screenshotCalls()).toHaveLength(0)
  })

  it('retries a failed snapshot without switching to live mode', async () => {
    usePreviewStore.getState().setMode('snapshot')
    await renderMode('visible')

    expect(container.querySelector('video')?.dataset.previewPhase).toBe('snapshot-error')
    const captures = screenshotCalls().length

    await act(async () => {
      retryPreview()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(usePreviewStore.getState().mode).toBe('snapshot')
    expect(screenshotCalls()).toHaveLength(captures + 1)
    expect(startCalls()).toHaveLength(0)
  })
})
