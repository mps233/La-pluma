// @vitest-environment jsdom

import { Activity, act } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrcpyDeviceView from './ScrcpyDeviceView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const webrtcMock = vi.hoisted(() => ({
  status: 'idle',
  error: null as string | null,
  stats: null,
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

interface MockButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  loading?: boolean
  loadingText?: ReactNode
  variant?: string
  size?: string
  fullWidth?: boolean
  statusKey?: string | number
}

vi.mock('./common', () => ({
  Button: ({
    children,
    icon: _icon,
    loading = false,
    loadingText,
    variant: _variant,
    size: _size,
    fullWidth: _fullWidth,
    statusKey: _statusKey,
    ...props
  }: MockButtonProps) => (
    <button {...props} disabled={props.disabled || loading}>
      {loading ? loadingText : children}
    </button>
  ),
}))

let container: HTMLDivElement
let root: Root

const findButton = (label: string) => Array.from(container.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)

describe('ScrcpyDeviceView automation availability', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    webrtcMock.status = 'idle'
    webrtcMock.error = null
    webrtcMock.inputReady = false
    webrtcMock.mediaStream = null
    webrtcMock.sendTouch.mockReturnValue(true)
    vi.clearAllMocks()
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

  it('disables startup, installation, connection, and device controls while unavailable', async () => {
    const onStartInfrastructure = vi.fn().mockResolvedValue('/webrtc-signaling')
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
        onStartInfrastructure={onStartInfrastructure}
        onInstall={onInstall}
        onToggleServer={onToggleServer}
        onToggleAgent={onToggleAgent}
      />
    ))

    expect(findButton('安装预览组件')?.disabled).toBe(true)
    expect(findButton('启动服务')?.disabled).toBe(true)
    expect(findButton('连接 Agent')?.disabled).toBe(true)
    expect(findButton('安装组件')?.disabled).toBe(true)
    expect(findButton('安装预览组件')?.title).toBe('正在检查后端服务，请稍候')

    findButton('安装预览组件')?.click()
    findButton('启动服务')?.click()
    findButton('连接 Agent')?.click()
    findButton('安装组件')?.click()
    container.querySelector('video')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    expect(onStartInfrastructure).not.toHaveBeenCalled()
    expect(onInstall).not.toHaveBeenCalled()
    expect(onToggleServer).not.toHaveBeenCalled()
    expect(onToggleAgent).not.toHaveBeenCalled()
    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('restarts auto-connect after an Activity workspace is restored', async () => {
    const onStartInfrastructure = vi.fn().mockResolvedValue('/webrtc-signaling')
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <ScrcpyDeviceView
              enabled
              autoConnect
              infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
              onStartInfrastructure={onStartInfrastructure}
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

    expect(onStartInfrastructure).toHaveBeenCalledTimes(2)
    expect(webrtcMock.connect).toHaveBeenCalledTimes(2)
  })

  it('shows the status beam only while the preview is connecting', async () => {
    webrtcMock.status = 'connecting'
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

    const frame = container.querySelector('.scrcpy-video-frame')
    expect(frame?.classList.contains('status-border-beam')).toBe(true)
    expect(frame?.classList.contains('is-active')).toBe(true)
    expect(frame?.getAttribute('aria-busy')).toBe('true')

    webrtcMock.status = 'connected'
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, built: true, serverRunning: true, agentRunning: true }}
      />
    ))

    expect(frame?.classList.contains('is-active')).toBe(false)
    expect(frame?.getAttribute('aria-busy')).toBe('false')
  })

  it('keeps compact preview controls outside the video and expands settings below them', async () => {
    await act(async () => root.render(
      <ScrcpyDeviceView
        variant="compact"
        enabled={false}
        infrastructureStatus={{ installed: true, built: true, serverRunning: false, agentRunning: false }}
      />
    ))

    const frame = container.querySelector('.scrcpy-video-frame')
    const toolbar = container.querySelector('.scrcpy-preview-toolbar')
    const openSettings = findButton('打开预览设置')

    expect(frame?.nextElementSibling).toBe(toolbar)
    expect(toolbar?.contains(frame)).toBe(false)
    expect(container.querySelector('.scrcpy-control-rail')).toBeNull()
    expect(openSettings?.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar?.getAttribute('role')).toBe('toolbar')
    expect(Array.from(toolbar?.querySelectorAll('button') || []).every(button => (
      button.className.includes('h-11') && button.className.includes('w-11')
    ))).toBe(true)

    await act(async () => openSettings?.click())

    const rail = container.querySelector('.scrcpy-control-rail.is-compact')
    expect(rail).not.toBeNull()
    expect(toolbar?.parentElement?.nextElementSibling).toBe(rail)
    expect(findButton('收起预览设置')?.getAttribute('aria-expanded')).toBe('true')
    expect(findButton('收起预览设置')?.getAttribute('aria-controls')).toBe(rail?.id)
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

  it('applies preset FPS and marks manual quality changes as custom', async () => {
    await act(async () => root.render(
      <ScrcpyDeviceView
        enabled={false}
        infrastructureStatus={{ installed: true, built: true, serverRunning: false, agentRunning: false }}
      />
    ))

    await act(async () => findButton('均衡画质')?.click())
    expect(container.textContent).toContain('1280p · 45 FPS')
    expect(container.textContent).toContain('画质已修改，重连预览后生效')

    await act(async () => findButton('60')?.click())
    expect(container.textContent).toContain('自定义 · 1280p · 60 FPS')
    expect(container.querySelector('[role="group"][aria-label="视频帧率"]')).not.toBeNull()
    expect(findButton('60')?.getAttribute('aria-label')).toBe('60 FPS')
    expect(findButton('60')?.className).toContain('min-h-11')
    expect(Array.from(container.querySelectorAll('.scrcpy-service-action, .scrcpy-utility-action')).every(button => (
      button.className.includes('min-h-11')
    ))).toBe(true)
    expect(container.querySelector('.scrcpy-bitrate-slider')?.className).toContain('min-h-11')
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
    expect(dialog?.querySelector('[aria-label="退出全屏"]')?.className).toContain('h-11')

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
})
