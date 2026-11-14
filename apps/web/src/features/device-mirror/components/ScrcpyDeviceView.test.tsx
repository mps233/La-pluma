// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrcpyDeviceView from './ScrcpyDeviceView'
import { PreviewSessionProvider } from './PreviewSessionProvider'
import ScreenMonitor from './ScreenMonitor'
import { getWebrtcStatus, startWebrtc } from '../api'
import type { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'
import { usePreviewStore } from '../store/previewStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const availabilityMock = vi.hoisted(() => ({ isAvailable: true }))
vi.mock('@/features/runtime-status', () => ({ useAutomationAvailability: () => availabilityMock }))
vi.mock('../api', () => ({ getWebrtcStatus: vi.fn().mockResolvedValue({ success: true, data: { installed: true, built: true, serverRunning: false, agentRunning: false } }), startWebrtc: vi.fn().mockResolvedValue({ success: true, data: { signalingUrl: '/webrtc-signaling' } }) }))

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

vi.mock('../hooks/useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: () => webrtcMock,
}))

let container: HTMLDivElement
let root: Root

const findButton = (label: string) => Array.from(container.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)

describe('ScrcpyDeviceView automation availability', () => {
  beforeEach(() => {
    availabilityMock.isAvailable = true
    vi.mocked(getWebrtcStatus).mockReset().mockResolvedValue({ success: true, data: { installed: true, built: true, serverRunning: false, agentRunning: false } })
    usePreviewStore.setState({ mode: 'off', quality: 'power', fps: 15, maxSize: 640, bitrateMbps: 1.5 })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    webrtcMock.status = 'idle'
    webrtcMock.error = null
    webrtcMock.stats = null
    webrtcMock.inputReady = false
    webrtcMock.mediaStream = null
    webrtcMock.sendTouch.mockReturnValue(true)
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

  it('disables mode switching, connection, and device controls while unavailable', async () => {
    const onInstall = vi.fn()
    const onToggleServer = vi.fn()
    const onToggleAgent = vi.fn()

    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        autoConnect
        automationAvailable={false}
        automationUnavailableMessage="正在检查后端服务，请稍候"
        infrastructureStatus={{ installed: false, built: false, serverRunning: false, agentRunning: false }}
        onInstall={onInstall}
        onToggleServer={onToggleServer}
        onToggleAgent={onToggleAgent}
      />
    ))

    expect(findButton('实时')?.disabled).toBe(true)
    expect(findButton('快照')?.disabled).toBe(true)
    expect(findButton('启动服务')?.disabled).toBe(true)
    expect(findButton('连接 Agent')?.disabled).toBe(true)
    expect(findButton('安装组件')?.disabled).toBe(true)

    findButton('实时')?.click()
    findButton('启动服务')?.click()
    findButton('连接 Agent')?.click()
    findButton('安装组件')?.click()
    container.querySelector('video')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    expect(usePreviewStore.getState().mode).toBe('off')
    expect(onInstall).not.toHaveBeenCalled()
    expect(onToggleServer).not.toHaveBeenCalled()
    expect(onToggleAgent).not.toHaveBeenCalled()
    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('restores infrastructure controls after an initial status failure and backend recovery', async () => {
    availabilityMock.isAvailable = false
    vi.mocked(getWebrtcStatus).mockRejectedValueOnce(new Error('状态读取失败'))
    await act(async () => root.render(<ScreenMonitor />))

    expect(container.textContent).toContain('状态读取失败')
    expect(findButton('启动服务')?.disabled).toBe(true)
    expect(findButton('连接 Agent')?.disabled).toBe(true)
    expect(findButton('安装组件')?.disabled).toBe(true)

    vi.mocked(getWebrtcStatus).mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    availabilityMock.isAvailable = true
    await act(async () => root.render(<ScreenMonitor />))

    expect(getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(findButton('停止服务')?.disabled).toBe(false)
    expect(findButton('连接 Agent')?.disabled).toBe(false)
    expect(findButton('重装组件')?.disabled).toBe(false)
    expect(container.textContent).not.toContain('状态读取失败')
    expect(startWebrtc).not.toHaveBeenCalled()
  })

  it('keeps selected live mode connected while an Activity workspace hides and restores', async () => {
    usePreviewStore.getState().setMode('live')
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <ScrcpyDeviceView
              enabled
              autoConnect
              infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
                  />
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
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

    const frame = container.querySelector('[aria-busy]')
    expect(frame?.getAttribute('aria-busy')).toBe('true')

    webrtcMock.status = 'connected'
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

    expect(frame?.getAttribute('aria-busy')).toBe('false')
  })

  it('expands and collapses compact preview settings', async () => {
    await act(async () => root.render(
      <ScrcpyDeviceView
        variant="compact"
        enabled={false}
        infrastructureStatus={{ installed: true, built: true, serverRunning: false, agentRunning: false }}
      />
    ))

    const openSettings = findButton('打开预览设置')
    const controlsId = openSettings?.getAttribute('aria-controls')

    expect(container.querySelector('[role="radiogroup"][aria-label="预览模式"]')).not.toBeNull()
    expect(container.querySelector('[role="toolbar"][aria-label="模拟器导航"]')).not.toBeNull()
    expect(openSettings?.getAttribute('aria-expanded')).toBe('false')
    expect(controlsId).toBeTruthy()
    expect(document.getElementById(controlsId!)).toBeNull()

    await act(async () => openSettings?.click())

    const collapseSettings = findButton('收起预览设置')
    expect(collapseSettings?.getAttribute('aria-expanded')).toBe('true')
    expect(collapseSettings?.getAttribute('aria-controls')).toBe(controlsId)
    expect(document.getElementById(controlsId!)).not.toBeNull()
  })

  it('keeps recovery controls available while blocking new device actions', async () => {
    webrtcMock.status = 'connected'
    const onToggleServer = vi.fn()
    const onToggleAgent = vi.fn()

    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        automationAvailable={false}
        automationUnavailableMessage="后端服务暂不可用"
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
        onToggleServer={onToggleServer}
        onToggleAgent={onToggleAgent}
      />
    ))

    expect(findButton('停止服务')?.disabled).toBe(false)
    expect(findButton('停止 Agent')?.disabled).toBe(false)
    expect(findButton('断开')?.disabled).toBe(false)
    expect(findButton('返回')?.disabled).toBe(true)

    await act(async () => {
      findButton('停止服务')?.click()
      findButton('停止 Agent')?.click()
      findButton('断开')?.click()
      findButton('返回')?.click()
    })

    expect(onToggleServer).toHaveBeenCalledOnce()
    expect(onToggleAgent).toHaveBeenCalledOnce()
    expect(webrtcMock.disconnect).toHaveBeenCalledOnce()
    expect(webrtcMock.sendCommand).not.toHaveBeenCalled()
  })

  it('disables every infrastructure control while one operation is running', async () => {
    webrtcMock.status = 'connected'
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
        infrastructureLoading="server"
        onToggleServer={vi.fn()}
        onToggleAgent={vi.fn()}
        onInstall={vi.fn()}
      />
    ))

    expect(findButton('重连预览')?.disabled).toBe(true)
    expect(findButton('处理中')?.disabled).toBe(true)
    expect(findButton('停止 Agent')?.disabled).toBe(true)
    expect(findButton('重装组件')?.disabled).toBe(true)
  })

  it('shows input readiness and never starts a gesture while the input channel is unavailable', async () => {
    webrtcMock.status = 'connected'
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

    expect(container.textContent).toContain('触控连接中，画面暂不可操作')
    const video = container.querySelector('video')!
    const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    video.dispatchEvent(event)

    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('renders an unknown infrastructure state without calling it uninstalled', async () => {
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled={false}
        infrastructureStatus={null}
        infrastructureStatusState="error"
        infrastructureError="状态读取失败"
      />
    ))

    expect(container.textContent).toContain('组件：未知')
    expect(container.textContent).toContain('服务：未知')
    expect(container.textContent).not.toContain('组件：未安装')
  })

  it.each(['full', 'compact'] as const)('applies preset FPS and marks manual quality changes as custom in %s view', async variant => {
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled={false}
        variant={variant}
        infrastructureStatus={{ installed: true, built: true, serverRunning: false, agentRunning: false }}
      />
    ))

    if (variant === 'compact') await act(async () => findButton('打开预览设置')?.click())
    await act(async () => findButton('均衡画质')?.click())
    expect(container.textContent).toContain('最长边 1280px · 45 FPS')
    expect(findButton('均衡画质')?.textContent).toContain('1280px · 45 FPS · 8M')
    expect(findButton('均衡画质')?.title).toBe('最长边 1280px · 45 FPS · 码率 8 Mbps')
    expect(container.textContent).toContain('画质已修改，重连预览后生效')

    await act(async () => findButton('60')?.click())
    expect(container.textContent).toContain('自定义 · 最长边 1280px · 60 FPS')
    expect(container.querySelector('[role="group"][aria-label="视频帧率"]')).not.toBeNull()
    expect(findButton('60')?.getAttribute('aria-label')).toBe('60 FPS')
  })

  it('shows unknown network statistics without units and preserves measured zero values', async () => {
    webrtcMock.status = 'connected'
    const stats: NonNullable<ReturnType<typeof useScrcpyWebRTC>['stats']> = {
      fps: null, bitrate: null, rtt: null, connectionType: '--', lostCount: 0,
      jitterBufferMs: null, decodeMs: null,
      width: 640, height: 360, videoReadyState: 4, videoLive: true,
      iceState: 'connected', peerState: 'connected', signalingState: 'stable', inputReady: false,
    }
    webrtcMock.stats = stats
    const render = () => root.render(<ScrcpyDeviceView enabled />)
    await act(async () => render())

    expect(container.textContent).toContain('网络 RTT')
    expect(container.textContent).toContain('等待触控信息')
    expect(container.textContent).toMatch(/网络 RTT\s*--/)
    expect(container.textContent).toMatch(/码率\s*--/)
    expect(container.textContent).not.toContain('-- ms')
    expect(container.textContent).not.toContain('-- kbps')

    webrtcMock.stats = { ...stats, rtt: 0, bitrate: 0 }
    await act(async () => render())
    expect(container.textContent).toContain('0 ms')
    expect(container.textContent).toContain('0 kbps')
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

    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

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
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

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

    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))
    const fullscreenButton = findButton('全屏')!
    fullscreenButton.focus()
    await act(async () => fullscreenButton.click())

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog)
    expect(container.inert).toBe(true)
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(dialog?.querySelector('[aria-label="退出全屏"]')).not.toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(container.inert).toBeFalsy()
    expect(container.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(fullscreenButton)
  })

  it('binds a media stream that arrives after immersive mode opens', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    vi.spyOn(window.history, 'back').mockImplementation(() => {})

    const props = {
      enabled: true,
      infrastructureStatus: { installed: true, built: true, serverRunning: true, agentRunning: true },
    }
    await act(async () => root.render(<ScrcpyDeviceView {...props} />))
    await act(async () => findButton('全屏')?.click())
    const immersiveVideo = document.body.querySelector<HTMLVideoElement>('[aria-label="模拟器沉浸画面"]')
    expect(immersiveVideo?.srcObject == null).toBe(true)

    const lateStream = { getTracks: () => [] } as unknown as MediaStream
    webrtcMock.mediaStream = lateStream
    await act(async () => root.render(<ScrcpyDeviceView {...props} />))

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
    await act(async () => root.render(<ScrcpyDeviceView enabled />))
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
    await act(async () => root.render(<ScrcpyDeviceView enabled={false} />))
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

  it('labels the preview card as 设备画面 in both layouts', async () => {
    await act(async () => root.render(<ScrcpyDeviceView enabled />))
    expect(container.textContent).toContain('设备画面')

    await act(async () => root.render(<ScrcpyDeviceView enabled variant="compact" />))
    expect(container.textContent).toContain('设备画面')
  })

  it('exposes shared mode controls in compact view while startup is busy', async () => {
    usePreviewStore.getState().setMode('live')
    await act(async () => root.render(<ScrcpyDeviceView enabled variant="compact" infrastructureLoading="preview" />))
    const modes = container.querySelector('[role="radiogroup"][aria-label="预览模式"]')!
    const off = Array.from(modes.querySelectorAll('button')).find(button => button.textContent === '关闭')!
    expect(off.disabled).toBe(false)
    await act(async () => off.click())
    expect(usePreviewStore.getState().mode).toBe('off')
  })

})
