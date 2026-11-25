import { expect, test, type Page } from '@playwright/test'
import {
  createScenarioState,
  expectScenarioHealthy,
  gotoScenario,
  installIntegrationScenario,
  ok,
} from './harness'

interface PreviewTransportState {
  peers: number
  closedPeers: number
  stoppedTracks: number
}

async function installPreviewPeer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { peers: 0, closedPeers: 0, stoppedTracks: 0 }
    Object.assign(window, { previewTransportState: state })

    // Keep the signaling and application code real while replacing the remote
    // device with a native canvas track that Chromium can actually play.
    class PreviewPeer extends EventTarget {
      connectionState = 'connected'
      iceConnectionState = 'connected'
      iceGatheringState = 'complete'
      signalingState = 'stable'
      localDescription: RTCSessionDescriptionInit | null = null
      ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null
      onicecandidate = null
      ondatachannel = null
      oniceconnectionstatechange = null
      onconnectionstatechange = null
      track: MediaStreamTrack
      timer: number

      constructor() {
        super()
        state.peers += 1
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const context = canvas.getContext('2d')!
        const paint = () => {
          context.fillStyle = '#1c1c1e'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = '#0a84ff'
          context.fillRect(0, 0, 80, 80)
        }
        paint()
        this.track = canvas.captureStream(10).getVideoTracks()[0]!
        this.timer = window.setInterval(paint, 100)
        const stop = this.track.stop.bind(this.track)
        this.track.stop = () => {
          state.stoppedTracks += 1
          window.clearInterval(this.timer)
          stop()
        }
      }

      async setRemoteDescription() {}
      async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' } }
      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description
        this.ontrack?.({ track: this.track })
      }
      async addIceCandidate() {}
      async getStats() { return new Map() }
      getReceivers() { return [{ track: this.track }] }
      close() {
        state.closedPeers += 1
        this.connectionState = 'closed'
      }
    }

    Object.defineProperty(window, 'RTCPeerConnection', { value: PreviewPeer, configurable: true })
  })
}

async function navigatePreviewPage(page: Page, tab: string): Promise<void> {
  await page.locator(`[data-app-tab="${tab}"]:visible`).click()
  await expect(page).toHaveURL(new RegExp(`/app/${tab}$`))
  await expect(page.locator(`[data-app-tab="${tab}"]:visible`)).toHaveAttribute('aria-current', 'page')
}

async function transportState(page: Page): Promise<PreviewTransportState> {
  return page.evaluate(() => (window as unknown as { previewTransportState: PreviewTransportState }).previewTransportState)
}

async function visibleStreamId(page: Page): Promise<string | undefined> {
  return page.locator('video:visible').first().evaluate(video => {
    const element = video as HTMLVideoElement
    return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ? (element.srcObject as MediaStream | null)?.id
      : undefined
  })
}

test('实时预览启动中及连接后切换工作区共用同一视频会话，关闭才释放连接', async ({ page }) => {
  const scenario = createScenarioState()
  scenario.runState = 'succeeded'
  await installIntegrationScenario(page, scenario)
  await installPreviewPeer(page)

  let startups = 0
  let logins = 0
  let sockets = 0
  let closedSockets = 0
  let finishStartup!: () => void
  const startupGate = new Promise<void>(resolve => { finishStartup = resolve })
  await page.route('**/api/agent/webrtc/start', async route => {
    startups += 1
    await startupGate
    await route.fulfill({ json: ok({ installed: true, built: true, serverRunning: true, agentRunning: true, signalingUrl: '/webrtc-signaling' }) })
  })
  await page.route('**/webrtc-signaling/api/login', async route => {
    logins += 1
    await route.fulfill({ json: { token: 'preview-integration-token' } })
  })
  await page.routeWebSocket('**/webrtc-signaling/connect_client?*', socket => {
    sockets += 1
    socket.onClose(() => { closedSockets += 1 })
    socket.onMessage(message => {
      const data = JSON.parse(String(message)) as { message_type?: string; payload?: { type?: string } }
      if (data.message_type === 'connect') socket.send(JSON.stringify({ message_type: 'config' }))
      if (data.payload?.type === 'request-offer') {
        socket.send(JSON.stringify({ message_type: 'device_msg', payload: { type: 'offer', sdp: 'v=0\r\n' } }))
      }
    })
  })

  try {
    await gotoScenario(page, 'automation')
    await page.getByRole('button', { name: '实时', exact: true }).click()
    await expect.poll(() => startups).toBe(1)

    // Hiding the initiating page must leave its in-flight startup intact.
    for (const tab of ['roguelike', 'combat', 'training']) {
      await navigatePreviewPage(page, tab)
      await expect(page.getByRole('button', { name: '实时', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(startups).toBe(1)
    }
    finishStartup()
    await expect.poll(() => visibleStreamId(page)).toBeTruthy()
    const streamId = await visibleStreamId(page)

    // Each page binds the established stream to its own visible video; neither
    // Activity cleanup nor entering a page without a preview releases it.
    for (const tab of ['statistics', 'logs', 'dashboard', 'automation', 'roguelike', 'combat', 'training']) {
      await navigatePreviewPage(page, tab)
      await expect.poll(() => visibleStreamId(page)).toBe(streamId)
      expect(await transportState(page)).toEqual({ peers: 1, closedPeers: 0, stoppedTracks: 0 })
      expect({ startups, logins, sockets, closedSockets }).toEqual({ startups: 1, logins: 1, sockets: 1, closedSockets: 0 })
    }
    await navigatePreviewPage(page, 'config')
    expect(await transportState(page)).toEqual({ peers: 1, closedPeers: 0, stoppedTracks: 0 })
    await navigatePreviewPage(page, 'automation')
    await expect.poll(() => visibleStreamId(page)).toBe(streamId)

    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await expect.poll(() => transportState(page)).toEqual({ peers: 1, closedPeers: 1, stoppedTracks: 1 })
    await expect.poll(() => closedSockets).toBe(1)
    expect({ startups, logins, sockets }).toEqual({ startups: 1, logins: 1, sockets: 1 })
    await expectScenarioHealthy(page)
  } finally {
    finishStartup()
  }
})
