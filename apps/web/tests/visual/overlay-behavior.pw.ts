import { expect, test, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok, type ApiFixture } from './fixtures'
import { installDeterministicEnvironment, themeSeedScript, waitForPageReady } from './harness'

function undoToast(page: Page) {
  return page.locator('[data-sonner-toast]').filter({
    has: page.getByRole('button', { name: '关闭移除提示', exact: true }),
  })
}

const TRAINING_QUEUE_ITEMS = [
  {
    operatorId: 'char_180_amgoat',
    operator: { name: '艾雅法拉', rarity: 6, profession: 'CASTER' },
    currentElite: 1,
    targetElite: 2,
    materials: [],
    lmd: { needed: 120000, have: 90000, stillNeeded: 30000 },
    progress: 0.35,
    settings: { useMedicine: 0, useStone: 0, autoSwitch: true, notifyOnComplete: true },
  },
  {
    operatorId: 'char_202_demkni',
    operator: { name: '塞雷娅', rarity: 6, profession: 'TANK' },
    currentElite: 0,
    targetElite: 2,
    materials: [],
    lmd: { needed: 180000, have: 40000, stillNeeded: 140000 },
    progress: 0.12,
    settings: { useMedicine: 0, useStone: 0, autoSwitch: false, notifyOnComplete: false },
  },
]

async function installTrainingQueueRoutes(page: Page) {
  let queue = structuredClone(TRAINING_QUEUE_ITEMS)
  let releaseUndo: (() => void) | null = null
  let undoGate: Promise<void> | null = null

  await page.route('**/api/agent/training/queue**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (request.method() === 'GET' && pathname === '/api/agent/training/queue') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({ queue, revision: 'overlay-behavior', flowSync: false })),
      })
      return
    }

    if (request.method() === 'DELETE') {
      const operatorId = decodeURIComponent(pathname.split('/').pop() ?? '')
      queue = queue.filter(item => item.operatorId !== operatorId)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({ queueUpdated: true, queueRevision: 'overlay-behavior-2' })),
      })
      return
    }

    if (request.method() === 'POST' && pathname === '/api/agent/training/queue') {
      if (undoGate) await undoGate
      const payload = request.postDataJSON() as { operatorId?: string; position?: number }
      const removed = TRAINING_QUEUE_ITEMS.find(item => item.operatorId === payload.operatorId)
      if (removed && !queue.some(item => item.operatorId === removed.operatorId)) {
        queue.splice(payload.position ?? queue.length, 0, structuredClone(removed))
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({ queueUpdated: true, queueRevision: 'overlay-behavior-3' })),
      })
      return
    }

    await route.fallback()
  })

  return {
    delayUndo() {
      if (!undoGate) {
        undoGate = new Promise<void>(resolve => {
          releaseUndo = resolve
        })
      }
    },
    releaseUndo() {
      releaseUndo?.()
      releaseUndo = null
      undoGate = null
    },
  }
}

const webrtcFixtures: ApiFixture[] = [
  {
    path: '/agent/webrtc/status',
    payload: ok({ installed: true, built: true, serverRunning: true, agentRunning: true }),
  },
  {
    path: '/agent/webrtc/start',
    method: 'POST',
    payload: ok({
      installed: true,
      built: true,
      serverRunning: true,
      agentRunning: true,
      signalingUrl: '/webrtc-signaling',
    }),
  },
  ...apiFixtures,
]

async function installFakeWebRTC(page: Page) {
  await page.addInitScript(() => {
    const touchMessages: unknown[] = []
    ;(window as typeof window & { __touchMessages: unknown[] }).__touchMessages = touchMessages

    class FakeWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      readyState = FakeWebSocket.CONNECTING
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null

      constructor() {
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN
          this.onopen?.()
        }, 0)
      }

      send(raw: string) {
        const message = JSON.parse(raw)
        if (message.message_type === 'connect') {
          window.setTimeout(() => {
            this.onmessage?.({
              data: JSON.stringify({ message_type: 'config', ice_servers: [] }),
            })
            this.onmessage?.({
              data: JSON.stringify({
                message_type: 'device_info',
                device_info: { displays: [{ x_res: 1280, y_res: 720 }] },
              }),
            })
          }, 0)
        }
        if (message.message_type === 'forward' && message.payload?.type === 'request-offer') {
          window.setTimeout(() => {
            this.onmessage?.({
              data: JSON.stringify({
                message_type: 'device_msg',
                payload: {
                  type: 'offer',
                  sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n',
                },
              }),
            })
          }, 0)
        }
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED
        this.onclose?.()
      }
    }

    class FakeRTCPeerConnection {
      connectionState = 'connected'
      iceConnectionState = 'connected'
      localDescription: unknown = null
      ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null
      ondatachannel: ((event: { channel: unknown }) => void) | null = null
      onicecandidate: (() => void) | null = null
      oniceconnectionstatechange: (() => void) | null = null
      onconnectionstatechange: (() => void) | null = null
      private connected = false

      setRemoteDescription() {
        return Promise.resolve()
      }

      createAnswer() {
        return Promise.resolve({
          type: 'answer',
          sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n',
        })
      }

      setLocalDescription(description: unknown) {
        this.localDescription = description
        window.setTimeout(() => this.connect(), 0)
        return Promise.resolve()
      }

      addIceCandidate() {
        return Promise.resolve()
      }

      getReceivers() {
        return []
      }

      close() {
        this.connectionState = 'closed'
      }

      private connect() {
        if (this.connected) return
        this.connected = true
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const context = canvas.getContext('2d')
        context?.fillRect(0, 0, canvas.width, canvas.height)
        const stream = canvas.captureStream(5)
        const track = stream.getVideoTracks()[0]
        if (track) this.ontrack?.({ track })
        const channel: {
          label: string
          readyState: string
          bufferedAmount: number
          bufferedAmountLowThreshold: number
          onopen: null
          onclose: null
          onerror: null
          send(data: string): void
          close(): void
        } = {
          label: 'input-channel',
          readyState: 'open',
          bufferedAmount: 0,
          bufferedAmountLowThreshold: 0,
          onopen: null,
          onclose: null,
          onerror: null,
          send(data: string) {
            touchMessages.push(JSON.parse(data))
          },
          close() {
            channel.readyState = 'closed'
          },
        }
        this.ondatachannel?.({ channel })
        this.onconnectionstatechange?.()
        this.oniceconnectionstatechange?.()
      }
    }

    Object.assign(window, {
      WebSocket: FakeWebSocket,
      RTCPeerConnection: FakeRTCPeerConnection,
    })
  })
}

test.describe('feature overlay behavior', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('filters keep menu semantics, single-open and keyboard focus', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/statistics')
    await waitForPageReady(page, 'statistics')

    if (test.info().project.name === 'mobile') {
      const triggers = page.locator('button[data-filter-menu]')
      await triggers.first().scrollIntoViewIfNeeded()
      const boxes = await triggers.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, y: Math.round(rect.y), width: rect.width }
      }))
      expect(boxes).toHaveLength(6)
      const rows = [...new Set(boxes.map(box => box.y))]
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(boxes.filter(box => box.y === row)).toHaveLength(3)
      }
      for (const box of boxes) {
        expect(box.width).toBeGreaterThan(70)
        expect(box.width).toBeLessThan(150)
      }
    }

    const ownership = page.getByRole('button', { name: '拥有状态', exact: true })
    await ownership.scrollIntoViewIfNeeded()
    await ownership.click()

    const menu = page.getByRole('menu', { name: '拥有状态筛选' })
    await expect(menu).toBeVisible()
    const options = menu.getByRole('menuitemradio')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(options.nth(0)).toBeFocused()
    const itemHeights = await options.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    for (const height of itemHeights) expect(height).toBeGreaterThanOrEqual(44)

    await page.keyboard.press('ArrowDown')
    await expect(options.nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(options.nth(2)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(options.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(options.nth(2)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(options.nth(0)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(ownership).toBeFocused()

    await ownership.click()
    await expect(menu).toBeVisible()
    const rarity = page.locator('button[data-filter-menu="rarity"]')
    await rarity.click()
    await expect(page.locator('[role="menu"]')).toHaveCount(1)
    await expect(page.getByRole('menu', { name: '星级筛选' })).toBeVisible()
    await expect(ownership).toHaveAttribute('aria-expanded', 'false')

    await page.getByRole('menuitemradio', { name: '6星', exact: true }).click()
    await expect(page.locator('[role="menu"]')).toHaveCount(0)
    await expect(rarity).toHaveText(/6星/)
    await expect(rarity).toBeFocused()

    await ownership.click()
    await expect(menu).toBeVisible()
    await page.getByRole('tab', { name: /仓库识别/ }).focus()
    await expect(menu).toBeHidden()

    if (test.info().project.name === 'mobile') {
      const reset = page.getByRole('button', { name: '重置', exact: true })
      await reset.scrollIntoViewIfNeeded()
      const [resetBox, rarityBox] = await Promise.all([reset.boundingBox(), rarity.boundingBox()])
      expect(Math.abs((resetBox?.width ?? 0) - (rarityBox?.width ?? 0))).toBeLessThanOrEqual(1)

      const sort = page.getByRole('button', { name: '排序', exact: true })
      await sort.scrollIntoViewIfNeeded()
      await sort.click()
      const content = page.locator('[data-slot="dropdown-menu-content"]')
      const positioner = content.locator('..')
      await expect(positioner).toHaveAttribute('data-align', 'end')
      await page.waitForTimeout(200)
      const box = await content.boundingBox()
      expect(Math.round(box?.width ?? 0)).toBe(128)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('short viewport keeps the filter menu inside the viewport and scrollable', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile short-viewport containment')
    await page.setViewportSize({ width: 390, height: 300 })
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/statistics')
    await waitForPageReady(page, 'statistics')

    const rarity = page.locator('button[data-filter-menu="rarity"]')
    await rarity.scrollIntoViewIfNeeded()
    await rarity.click()

    const content = page.locator('[data-slot="dropdown-menu-content"]')
    await expect(content).toBeVisible()
    const box = await content.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(300.5)

    const scrolling = await content.evaluate(element => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(scrolling.overflowY).toBe('auto')
    expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight)
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(page.getByRole('menuitemradio', { name: '1星', exact: true })).toBeVisible()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('immersive dialog keeps video gestures, Escape, history and background lock', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'immersive pointer behavior is captured on desktop Chromium')
    await installFakeWebRTC(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page, { fixtures: webrtcFixtures })
    await page.route('**/webrtc-signaling/api/login', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'overlay-behavior-token' }),
    }))

    await page.goto('/app/logs')
    await waitForPageReady(page, 'logs')

    await page.getByRole('radio', { name: '实时', exact: true }).click()
    const fullscreen = page.getByRole('button', { name: '全屏', exact: true })
    await expect(fullscreen).toBeEnabled({ timeout: 20_000 })

    const scrollHost = page.locator('.la-pluma-scroll-host')
    await scrollHost.evaluate(element => { element.scrollTop = 200 })
    const scrollBefore = await scrollHost.evaluate(element => element.scrollTop)

    await fullscreen.click()
    const dialog = page.locator('[data-scrcpy-immersive-layer="true"]')
    await expect(dialog).toBeVisible()
    await expect(page.locator('.la-pluma-navbar')).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => page.evaluate(() => Boolean((history.state as { scrcpyImmersive?: boolean }).scrcpyImmersive))).toBe(true)

    const video = page.getByLabel('模拟器沉浸画面')
    const box = await video.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 16, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(100)

    const gestures = await page.evaluate(() => (window as typeof window & {
      __touchMessages: Array<{ action: number; x: number; y: number; w: number; h: number }>
    }).__touchMessages)
    const actions = gestures.map(message => message.action)
    expect(actions[0]).toBe(0)
    expect(actions.at(-1)).toBe(1)
    expect(actions).toContain(2)
    for (const gesture of gestures) {
      expect(gesture.w).toBe(1280)
      expect(gesture.h).toBe(720)
      expect(gesture.x).toBeGreaterThanOrEqual(0)
      expect(gesture.y).toBeGreaterThanOrEqual(0)
    }

    await page.mouse.move(700, 300)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(100)
    expect(await scrollHost.evaluate(element => element.scrollTop)).toBe(scrollBefore)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(fullscreen).toBeFocused()
    await expect.poll(() => page.evaluate(() => Boolean((history.state as { scrcpyImmersive?: boolean }).scrcpyImmersive))).toBe(false)
    await expect(page.locator('.la-pluma-navbar')).not.toHaveAttribute('aria-hidden', 'true')

    await fullscreen.click()
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/app\/logs$/)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('undo toast expires after eight seconds, pauses on hover, and blocks dismissal while pending', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'toast timing is captured on desktop Chromium')
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)
    const queue = await installTrainingQueueRoutes(page)

    await page.goto('/app/training')
    await waitForPageReady(page, 'training')

    await page.clock.install()
    await page.getByRole('button', { name: '移除艾雅法拉', exact: true }).click()
    await page.clock.runFor(10)

    const toast = undoToast(page)
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('已移除 艾雅法拉')

    await toast.hover()
    await page.clock.fastForward(9000)
    await expect(toast).toBeVisible()

    await page.mouse.move(10, 10)
    await page.clock.runFor(10)
    await page.clock.fastForward(8500)
    await expect(toast).toBeHidden()

    queue.delayUndo()
    await page.getByRole('button', { name: '移除塞雷娅', exact: true }).click()
    await page.clock.runFor(10)
    await expect(toast).toContainText('已移除 塞雷娅')

    await toast.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(toast).toContainText('恢复中')
    await expect(toast.getByRole('button', { name: '关闭移除提示', exact: true })).toBeDisabled()
    await page.clock.fastForward(9000)
    await expect(toast).toBeVisible()

    queue.releaseUndo()
    await page.clock.runFor(250)
    await expect(toast).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('replaces the undo toast and cleans it up on close', async ({ page }) => {
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)
    await installTrainingQueueRoutes(page)

    await page.goto('/app/training')
    await waitForPageReady(page, 'training')

    const toast = undoToast(page)
    await page.getByRole('button', { name: '移除艾雅法拉', exact: true }).click()
    await expect(toast).toHaveCount(1)
    await expect(toast).toContainText('已移除 艾雅法拉')

    const card = toast.locator('[data-title] > div')
    const [toastBox, cardBox] = await Promise.all([toast.boundingBox(), card.boundingBox()])
    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(cardBox!.width).toBeLessThan(viewport!.width - 80)
    expect(Math.abs(cardBox!.x + cardBox!.width / 2 - viewport!.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(toastBox!.width - cardBox!.width)).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: '移除塞雷娅', exact: true }).click()
    await expect(toast).toHaveCount(1)
    await expect(toast).toContainText('已移除 塞雷娅')
    await expect(toast).not.toContainText('艾雅法拉')

    await toast.getByRole('button', { name: '关闭移除提示', exact: true }).click()
    await expect(toast).toHaveCount(0)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
