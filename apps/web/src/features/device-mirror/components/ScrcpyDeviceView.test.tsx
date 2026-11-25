// @vitest-environment jsdom

import { Activity, act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrcpyDeviceView from './ScrcpyDeviceView'
import { PreviewSessionProvider } from './PreviewSessionProvider'
import ScreenMonitor from './ScreenMonitor'
import { getWebrtcStatus, startWebrtc } from '../api'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'
import { usePreviewStore } from '../store/previewStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const availabilityMock = vi.hoisted(() => ({ isAvailable: true }))
const toastMock = vi.hoisted(() => ({ info: vi.fn(), dismiss: vi.fn() }))
vi.mock('@/features/runtime-status', () => ({ useAutomationAvailability: () => availabilityMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../api', () => ({
  getWebrtcStatus: vi.fn().mockResolvedValue({ success: true, data: { installed: true, built: true, serverRunning: false, agentRunning: false } }),
  startWebrtc: vi.fn().mockResolvedValue({ success: true, data: { signalingUrl: '/webrtc-signaling' } }),
  captureScreen: vi.fn().mockResolvedValue({ success: true, data: { image: 'provider-snapshot' } }),
}))

const webrtcMock = vi.hoisted(() => ({
  status: 'idle',
  error: null as string | null,
  stats: null as ReturnType<typeof useScrcpyWebRTC>['stats'],
  inputReady: false,
  mediaStream: null as MediaStream | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTouch: vi.fn(),
  sendCommand: vi.fn(),
}))

const webrtcOptions = vi.hoisted(() => ({ current: null as { statsEnabled?: boolean } | null }))

vi.mock('../hooks/useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: (options: { statsEnabled?: boolean }) => {
    webrtcOptions.current = options
    return webrtcMock
  },
}))

const snapshotMock = vi.hoisted(() => ({
  image: null as string | null,
  error: null as string | null,
  retry: vi.fn(),
}))

vi.mock('../hooks/usePreviewSnapshot', () => ({
  usePreviewSnapshot: () => snapshotMock,
}))

type Infrastructure = ComponentProps<typeof ScrcpyDeviceView>['infrastructure']

const makeInfrastructure = (overrides: Partial<Infrastructure> = {}): Infrastructure => ({
  automationAvailable: true,
  automationUnavailableMessage: '后端服务暂不可用，请稍后重试',
  infrastructureStatus: { installed: true, built: true, serverRunning: false, agentRunning: false },
  infrastructureStatusState: 'ready',
  infrastructureLoading: null,
  infrastructureError: null,
  onRefreshInfrastructure: vi.fn(),
  onInstall: vi.fn(),
  onToggleServer: vi.fn(),
  onToggleAgent: vi.fn(),
  ...overrides,
})

let container: HTMLDivElement
let root: Root

const findButton = (label: string) => Array.from(container.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)
const getDialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const findDialogButton = (label: string) => Array.from(getDialog()?.querySelectorAll('button') ?? [])
  .find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)

const renderView = async (overrides: Partial<Infrastructure> = {}) => {
  await act(async () => root.render(<ScrcpyDeviceView infrastructure={makeInfrastructure(overrides)} />))
}
const openSettings = async () => {
  await act(async () => findButton('打开预览设置')?.click())
}

describe('ScrcpyDeviceView', () => {
  beforeEach(() => {
    availabilityMock.isAvailable = true
    vi.mocked(getWebrtcStatus).mockReset().mockResolvedValue({ success: true, data: { installed: true, built: true, serverRunning: false, agentRunning: false } })
    usePreviewStore.setState({ mode: 'off', quality: 'smooth', customFps: 30, customMaxSize: 640, customBitrateMbps: 4 })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    webrtcMock.status = 'idle'
    webrtcMock.error = null
    webrtcMock.stats = null
    webrtcMock.inputReady = false
    webrtcMock.mediaStream = null
    webrtcMock.sendTouch.mockReturnValue(true)
    webrtcOptions.current = null
    snapshotMock.image = null
    snapshotMock.error = null
    snapshotMock.retry.mockReset()
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = createRoot(container)
    root = {
      render: children => renderer.render(<PreviewSessionProvider>{children}</PreviewSessionProvider>),
      unmount: () => renderer.unmount(),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('disables mode switching and device controls while unavailable', async () => {
    const infrastructure = makeInfrastructure({
      automationAvailable: false,
      automationUnavailableMessage: '正在检查后端服务，请稍候',
      infrastructureStatus: { installed: false, built: false, serverRunning: false, agentRunning: false },
    })
    await act(async () => root.render(<ScrcpyDeviceView infrastructure={infrastructure} />))
    await openSettings()

    expect(findButton('实时')?.disabled).toBe(true)
    expect(findButton('快照')?.disabled).toBe(true)
    expect(findDialogButton('启动服务')?.disabled).toBe(true)
    expect(findDialogButton('连接 Agent')?.disabled).toBe(true)
    expect(findDialogButton('安装组件')?.disabled).toBe(true)
    expect(findDialogButton('启动服务')?.getAttribute('title')).toBeNull()
    expect(findDialogButton('连接 Agent')?.getAttribute('title')).toBeNull()
    expect(findDialogButton('安装组件')?.getAttribute('title')).toBeNull()

    await act(async () => {
      findButton('实时')?.click()
      findDialogButton('启动服务')?.click()
      findDialogButton('连接 Agent')?.click()
      findDialogButton('安装组件')?.click()
      container.querySelector('video')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(usePreviewStore.getState().mode).toBe('off')
    expect(infrastructure.onInstall).not.toHaveBeenCalled()
    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('restores infrastructure controls after an initial status failure and backend recovery', async () => {
    availabilityMock.isAvailable = false
    vi.mocked(getWebrtcStatus).mockRejectedValueOnce(new Error('状态读取失败'))
    await act(async () => root.render(<ScreenMonitor />))
    expect(container.textContent).toContain('状态读取失败')
    await openSettings()

    expect(findDialogButton('启动服务')?.disabled).toBe(true)
    expect(findDialogButton('连接 Agent')?.disabled).toBe(true)
    expect(findDialogButton('安装组件')?.disabled).toBe(true)

    vi.mocked(getWebrtcStatus).mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    availabilityMock.isAvailable = true
    await act(async () => root.render(<ScreenMonitor />))
    await act(async () => { await Promise.resolve() })

    expect(getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(findDialogButton('停止服务')?.disabled).toBe(false)
    expect(findDialogButton('连接 Agent')?.disabled).toBe(false)
    expect(findDialogButton('重装组件')?.disabled).toBe(false)
    expect(startWebrtc).not.toHaveBeenCalled()
  })

  it('keeps selected live mode connected while an Activity workspace hides and restores', async () => {
    usePreviewStore.getState().setMode('live')
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <ScrcpyDeviceView infrastructure={makeInfrastructure()} />
          </Activity>,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    expect(webrtcMock.connect).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')

    expect(webrtcMock.connect).toHaveBeenCalledOnce()
  })

  it('marks the video frame busy only while the preview is connecting', async () => {
    webrtcMock.status = 'connecting'
    await renderView()

    const frame = container.querySelector('[aria-busy]')
    expect(frame?.getAttribute('aria-busy')).toBe('true')

    webrtcMock.status = 'connected'
    await renderView()

    expect(frame?.getAttribute('aria-busy')).toBe('false')
  })

  it('opens the preview settings dialog, samples diagnostics on demand, and closes it', async () => {
    const trigger = await renderView().then(() => findButton('打开预览设置'))
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(webrtcOptions.current?.statsEnabled).toBe(false)

    trigger?.focus()
    await openSettings()
    expect(getDialog()?.textContent).toContain('连接与服务')
    expect(getDialog()?.textContent).toContain('画质设置')
    expect(getDialog()?.textContent).toContain('连接详情')
    expect(webrtcOptions.current?.statsEnabled).toBe(true)

    await act(async () => findDialogButton('关闭对话框')?.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(getDialog()).toBeNull()
    expect(webrtcOptions.current?.statsEnabled).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the preview settings dialog with Escape', async () => {
    await renderView()
    await openSettings()
    expect(getDialog()).not.toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(getDialog()).toBeNull()
  })

  it('keeps bitrate ids unique when multiple previews open their settings', async () => {
    await act(async () => root.render(
      <>
        <ScrcpyDeviceView infrastructure={makeInfrastructure()} />
        <ScrcpyDeviceView infrastructure={makeInfrastructure()} />
      </>,
    ))
    const settingsButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.getAttribute('aria-label') === '打开预览设置')
    expect(settingsButtons).toHaveLength(2)

    await act(async () => {
      settingsButtons[0]?.click()
      settingsButtons[1]?.click()
    })

    const ranges = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="range"]'))
    expect(ranges).toHaveLength(2)
    expect(new Set(ranges.map(input => input.id)).size).toBe(2)
    expect(document.querySelectorAll('#scrcpy-bitrate')).toHaveLength(0)
  })

  it('shows diagnostics only while the settings dialog is open', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.stats = {
      fps: 45, bitrate: 0, rtt: 0, connectionType: '--', lostCount: 0,
      jitterBufferMs: null, decodeMs: null,
      width: 640, height: 360, videoReadyState: 4, videoLive: true,
      iceState: 'connected', peerState: 'connected', signalingState: 'stable', inputReady: false,
    }
    await renderView()
    expect(container.textContent).not.toContain('网络 RTT')

    await openSettings()
    const dialog = getDialog()

    expect(dialog?.textContent).toContain('网络 RTT')
    expect(dialog?.textContent).toContain('已连接')
    expect(dialog?.textContent).toContain('实时')
    expect(dialog?.textContent).toContain('等待触控信息')
    expect(dialog?.textContent).toContain('640×360')
    expect(dialog?.textContent).toContain('0 ms')
    expect(dialog?.textContent).toContain('0 kbps')

    webrtcMock.inputReady = true
    await renderView()
    expect(getDialog()?.textContent).toContain('就绪')
    expect(getDialog()?.textContent).not.toContain('等待触控信息')
  })

  it('applies presets and manual quality changes inside the settings dialog', async () => {
    await renderView()
    await openSettings()

    expect(findDialogButton('流畅画质')?.textContent).toContain('360p · 30 FPS · 4M')
    expect(findDialogButton('高清画质')?.textContent).toContain('720p · 60 FPS · 12M')
    expect(findDialogButton('超清画质')?.textContent).toContain('1080p · 60 FPS · 20M')
    expect(findDialogButton('自定义画质')).not.toBeUndefined()
    expect(findDialogButton('流畅画质')?.getAttribute('aria-pressed')).toBe('true')
    expect(findDialogButton('省电画质')).toBeUndefined()
    expect(findDialogButton('均衡画质')).toBeUndefined()
    expect(findDialogButton('清晰画质')).toBeUndefined()

    await act(async () => findDialogButton('高清画质')?.click())
    expect(getDialog()?.textContent).not.toContain('自定义 · 最长边')
    expect(findDialogButton('高清画质')?.getAttribute('aria-pressed')).toBe('true')
    expect(findDialogButton('高清画质')?.title).toBe('720p · 60 FPS · 码率 12 Mbps')
    expect(toastMock.info).toHaveBeenCalledWith(
      '画质已修改，下次连接实时预览时生效',
      expect.objectContaining({ id: 'preview-quality' }),
    )

    await act(async () => findDialogButton('30')?.click())
    expect(findDialogButton('自定义画质')?.getAttribute('aria-pressed')).toBe('true')
    expect(findDialogButton('30')?.getAttribute('aria-pressed')).toBe('true')
    expect(findDialogButton('高清画质')?.textContent).toContain('720p · 60 FPS · 12M')
    expect(getDialog()?.textContent).not.toContain('自定义 · 最长边')
    expect(getDialog()?.querySelector('[role="group"][aria-label="视频帧率"]')).not.toBeNull()
    expect(findDialogButton('30')?.getAttribute('aria-label')).toBe('30 FPS')
  })

  it('offers a reconnect action in the quality toast while live', async () => {
    usePreviewStore.getState().setMode('live')
    webrtcMock.status = 'connected'
    await renderView()
    await openSettings()

    await act(async () => findDialogButton('高清画质')?.click())
    expect(toastMock.info).toHaveBeenCalledWith(
      '画质已修改，重连后生效',
      expect.objectContaining({
        id: 'preview-quality',
        action: expect.objectContaining({ label: '重连' }),
      }),
    )

    const toastCalls = vi.mocked(toastMock.info).mock.calls
    const options = toastCalls[toastCalls.length - 1]?.[1] as {
      action?: { onClick: () => void }
    } | undefined
    const connectCalls = webrtcMock.connect.mock.calls.length
    await act(async () => options?.action?.onClick())

    expect(webrtcMock.connect.mock.calls.length).toBe(connectCalls + 1)
    expect(toastMock.dismiss).toHaveBeenCalledWith('preview-quality')
  })

  it('keeps recovery controls available while blocking new device actions', async () => {
    webrtcMock.status = 'connected'
    const infrastructure = makeInfrastructure({
      automationAvailable: false,
      automationUnavailableMessage: '后端服务暂不可用',
      infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true },
    })
    await act(async () => root.render(<ScrcpyDeviceView infrastructure={infrastructure} />))
    await openSettings()

    expect(findDialogButton('停止服务')?.disabled).toBe(false)
    expect(findDialogButton('停止 Agent')?.disabled).toBe(false)
    expect(findDialogButton('断开')?.disabled).toBe(false)
    expect(findButton('返回')?.disabled).toBe(true)

    await act(async () => {
      findDialogButton('停止服务')?.click()
      findDialogButton('停止 Agent')?.click()
      findDialogButton('断开')?.click()
      findButton('返回')?.click()
    })

    expect(infrastructure.onToggleServer).toHaveBeenCalledOnce()
    expect(infrastructure.onToggleAgent).toHaveBeenCalledOnce()
    expect(webrtcMock.disconnect).toHaveBeenCalledOnce()
    expect(webrtcMock.sendCommand).not.toHaveBeenCalled()
  })

  it('disables every infrastructure control while one operation is running', async () => {
    webrtcMock.status = 'connected'
    await renderView({
      infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true },
      infrastructureLoading: 'server',
    })
    await openSettings()

    expect(findDialogButton('重连预览')?.disabled).toBe(true)
    expect(findDialogButton('处理中')?.disabled).toBe(true)
    expect(findDialogButton('停止 Agent')?.disabled).toBe(true)
    expect(findDialogButton('重装组件')?.disabled).toBe(true)
  })

  it('shows input readiness and never starts a gesture while the input channel is unavailable', async () => {
    usePreviewStore.getState().setMode('live')
    webrtcMock.status = 'connected'
    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })

    expect(container.textContent).toContain('触控连接中，画面暂不可操作')
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    const video = container.querySelector('video')!
    const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    video.dispatchEvent(event)

    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('renders an unknown infrastructure state without calling it uninstalled', async () => {
    await renderView({
      infrastructureStatus: null,
      infrastructureStatusState: 'error',
      infrastructureError: '状态读取失败',
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('状态读取失败')

    await openSettings()
    expect(getDialog()?.textContent).not.toContain('未安装')
    expect(findDialogButton('启动服务')?.disabled).toBe(true)
    expect(findDialogButton('安装组件')?.disabled).toBe(true)
  })

  it('tracks pointers independently, coalesces moves per frame, and releases every pointer', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    let frameCallback: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })

    const video = container.querySelector('video')!
    Object.assign(video, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    const dispatchPointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      video.dispatchEvent(event)
    }

    act(() => {
      dispatchPointer('pointerdown', 1, 10, 20)
      dispatchPointer('pointerdown', 2, 30, 40)
      dispatchPointer('pointermove', 1, 11, 21)
      dispatchPointer('pointermove', 1, 12, 22)
      dispatchPointer('pointermove', 2, 32, 42)
    })

    expect(webrtcMock.sendTouch).toHaveBeenCalledTimes(2)
    act(() => frameCallback?.(16))
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(2, 12, 22, 1, video)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(2, 32, 42, 2, video)

    act(() => {
      dispatchPointer('pointerup', 1, 13, 23)
      dispatchPointer('pointercancel', 2, 33, 43)
    })
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(1, 13, 23, 1, video)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(3, 32, 42, 2, video)
  })

  it('does not track a pointer when the initial touch is rejected', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    webrtcMock.sendTouch.mockReturnValueOnce(false)
    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })

    const video = container.querySelector('video')!
    Object.assign(video, { setPointerCapture: vi.fn() })
    const dispatchPointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 2, clientY: 2, button: 0 })
      Object.defineProperty(event, 'pointerId', { value: 7 })
      video.dispatchEvent(event)
    }
    act(() => {
      dispatchPointer('pointerdown')
      dispatchPointer('pointermove')
      dispatchPointer('pointerup')
    })

    expect(webrtcMock.sendTouch).toHaveBeenCalledTimes(1)
  })

  it('opens an accessible immersive dialog, locks scrolling, and closes with Escape', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(window.history, 'back').mockImplementation(() => {})

    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })
    const fullscreenButton = findButton('全屏')!
    await act(async () => fullscreenButton.focus())
    await act(async () => fullscreenButton.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.getElementById(dialog!.getAttribute('aria-labelledby')!)?.textContent).toBe('模拟器沉浸预览')
    expect(dialog!.contains(document.activeElement)).toBe(true)
    expect(document.body.style.overflowY).toBe('hidden')
    expect(dialog?.querySelector('[aria-label="退出全屏"]')).not.toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.style.overflowY).toBe('')
    expect(document.activeElement).toBe(fullscreenButton)
  })

  it('binds a media stream that arrives after immersive mode opens', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    vi.spyOn(window.history, 'back').mockImplementation(() => {})

    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })
    await act(async () => findButton('全屏')?.click())
    const immersiveVideo = document.body.querySelector<HTMLVideoElement>('[aria-label="模拟器沉浸画面"]')
    expect(immersiveVideo?.srcObject == null).toBe(true)

    const lateStream = { getTracks: () => [] } as unknown as MediaStream
    webrtcMock.mediaStream = lateStream
    await renderView({ infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true } })

    expect(immersiveVideo?.srcObject).toBe(lateStream)
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="退出全屏"]')?.click())
  })

  it('cancels immersive pointers once on Escape without releasing another video gesture', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    let frameCallback: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await renderView()
    const mainVideo = container.querySelector('video')!
    const dispatchPointer = (video: HTMLVideoElement, type: string, id: number, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY })
      Object.defineProperty(event, 'pointerId', { value: id })
      video.dispatchEvent(event)
    }
    Object.assign(mainVideo, { setPointerCapture: vi.fn() })
    act(() => dispatchPointer(mainVideo, 'pointerdown', 1, 10, 20))
    await act(async () => findButton('全屏')?.click())
    const immersiveVideo = document.body.querySelector<HTMLVideoElement>('[aria-label="模拟器沉浸画面"]')!
    const releaseCapture = vi.fn((id: number) => dispatchPointer(immersiveVideo, 'lostpointercapture', id, 0, 0))
    Object.assign(immersiveVideo, {
      setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: releaseCapture,
    })
    act(() => {
      dispatchPointer(immersiveVideo, 'pointerdown', 2, 30, 40)
      dispatchPointer(immersiveVideo, 'pointermove', 2, 31, 41)
      dispatchPointer(mainVideo, 'pointermove', 1, 11, 21)
    })

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(webrtcMock.sendTouch.mock.calls.filter(([action]) => action === 3)).toEqual([[3, 31, 41, 2, immersiveVideo]])
    expect(releaseCapture).toHaveBeenCalledExactlyOnceWith(2)
    act(() => {
      frameCallback?.(0)
      dispatchPointer(mainVideo, 'pointerup', 2, 32, 42)
      dispatchPointer(mainVideo, 'pointerup', 1, 12, 22)
    })
    expect(webrtcMock.sendTouch).not.toHaveBeenCalledWith(2, 31, 41, 2, immersiveVideo)
    expect(webrtcMock.sendTouch).not.toHaveBeenCalledWith(1, 32, 42, 2, immersiveVideo)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(2, 11, 21, 1, mainVideo)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(1, 12, 22, 1, mainVideo)
    expect(webrtcMock.sendTouch.mock.calls.filter(([action]) => action === 3)).toHaveLength(1)
  })

  it('can cancel startup before infrastructure responds and ignores the late result', async () => {
    let resolveStart: ((value: Awaited<ReturnType<typeof startWebrtc>>) => void) | undefined
    vi.mocked(startWebrtc).mockImplementationOnce(() => new Promise(resolve => { resolveStart = resolve }))
    await renderView()
    await act(async () => {
      findButton('实时')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(startWebrtc).toHaveBeenCalledOnce()
    await act(async () => findButton('关闭')?.click())
    await act(async () => resolveStart?.({ success: true, data: { signalingUrl: '/webrtc-signaling' } } as Awaited<ReturnType<typeof startWebrtc>>))
    expect(usePreviewStore.getState().mode).toBe('off')
    expect(webrtcMock.connect).not.toHaveBeenCalled()
  })

  it('labels the preview card as 设备画面', async () => {
    await renderView()
    expect(container.textContent).toContain('设备画面')
  })

  it('hides the header status text while the preview is off and restores it otherwise', async () => {
    await renderView()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('预览已关闭')

    await act(async () => usePreviewStore.getState().setMode('live'))
    webrtcMock.status = 'connecting'
    await renderView()

    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在连接实时画面')
  })

  it('keeps the shared mode controls interactive in the shared view while startup is busy', async () => {
    usePreviewStore.getState().setMode('live')
    await renderView({ infrastructureLoading: 'preview' })
    const modes = container.querySelector('[role="group"][aria-label="预览模式"]')!
    const off = Array.from(modes.querySelectorAll('button')).find(button => button.textContent === '关闭')!
    expect(off.disabled).toBe(false)
    await act(async () => off.click())
    expect(usePreviewStore.getState().mode).toBe('off')
  })

  it('keeps one status live region and surfaces live failures with a retry', async () => {
    usePreviewStore.getState().setMode('live')
    webrtcMock.status = 'error'
    webrtcMock.error = '启动失败'
    await renderView()
    await act(async () => { await Promise.resolve() })

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.textContent).toContain('实时预览失败')
    expect(container.textContent).toContain('启动失败')
    const retry = findButton('重试')
    expect(retry).not.toBeUndefined()
    const starts = vi.mocked(startWebrtc).mock.calls.length

    await act(async () => {
      retry?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(vi.mocked(startWebrtc).mock.calls.length).toBe(starts + 1)
    expect(usePreviewStore.getState().mode).toBe('live')
  })

  it('offers an immediate reconnect after the live connection drops', async () => {
    usePreviewStore.getState().setMode('live')
    webrtcMock.status = 'disconnected'
    await renderView()
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('实时预览已断开')
    const reconnect = findButton('重新连接')
    expect(reconnect).not.toBeUndefined()
    const starts = vi.mocked(startWebrtc).mock.calls.length

    await act(async () => {
      reconnect?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(vi.mocked(startWebrtc).mock.calls.length).toBe(starts + 1)
  })

  it('keeps the previous snapshot visible but marks it stale when capture fails', async () => {
    usePreviewStore.getState().setMode('snapshot')
    snapshotMock.image = 'data:image/png;base64,stale'
    snapshotMock.error = '截图超时'
    await renderView()

    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,stale')
    expect(container.textContent).toContain('上次成功画面 · 可能已过期')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('截图超时')
    expect(container.textContent).not.toContain('画面快照 · 10s')

    await act(async () => findButton('重试')?.click())
    expect(snapshotMock.retry).toHaveBeenCalledOnce()
  })

  it('opens the preview settings dialog for infrastructure failures with no frame', async () => {
    await renderView({
      infrastructureStatus: null,
      infrastructureStatusState: 'error',
      infrastructureError: '状态读取失败',
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('状态读取失败')
    await act(async () => findButton('打开设置')?.click())
    expect(getDialog()).not.toBeNull()
    expect(getDialog()?.textContent).toContain('状态读取失败')
  })

  it('disables the already-selected mode when the backend is unavailable', async () => {
    usePreviewStore.getState().setMode('live')
    await renderView({ automationAvailable: false, automationUnavailableMessage: '后端服务暂不可用' })

    expect(findButton('实时')?.disabled).toBe(true)
    expect(findButton('快照')?.disabled).toBe(true)
    expect(findButton('关闭')?.disabled).toBe(false)
    expect(container.textContent).toContain('自动化服务不可用')
  })
})
