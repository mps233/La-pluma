// @vitest-environment jsdom

import { Activity } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrcpyDeviceView from './ScrcpyDeviceView'

afterEach(cleanup)

const webrtcMock = vi.hoisted(() => ({
  status: 'idle',
  error: null as string | null,
  stats: null,
  inputReady: false,
  mediaStream: null as MediaStream | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTouch: vi.fn(),
  sendScroll: vi.fn(),
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
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TruncatedText: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  IconButton: ({
    icon: _icon,
    variant: _variant,
    size,
    tooltip: _tooltip,
    tooltipSide: _tooltipSide,
    className = '',
    ...props
  }: Omit<MockButtonProps, 'loading' | 'loadingText' | 'fullWidth' | 'statusKey'> & {
    tooltip?: ReactNode
    tooltipSide?: string
  }) => (
    <button {...props} data-size={size} className={className} />
  ),
}))

const findButton = (label: string) => screen.queryAllByRole('button', { hidden: true })
  .find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label) as
  | HTMLButtonElement
  | undefined

const pointerEvent = (type: string, pointerId: number, clientX: number, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ScrcpyDeviceView automation availability', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    webrtcMock.status = 'idle'
    webrtcMock.error = null
    webrtcMock.inputReady = false
    webrtcMock.mediaStream = null
    webrtcMock.sendTouch.mockReturnValue(true)
    webrtcMock.sendCommand.mockResolvedValue({ requestId: 'test-command', success: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('disables preview startup and device controls while unavailable', async () => {
    const onStartInfrastructure = vi.fn().mockResolvedValue('/webrtc-signaling')
    const user = userEvent.setup({ delay: null })

    const { container } = render(
      <ScrcpyDeviceView
        enabled
        autoConnect
        automationAvailable={false}
        automationUnavailableMessage="正在检查后端服务，请稍候"
        infrastructureStatus={{ installed: true, serverRunning: false }}
        onStartInfrastructure={onStartInfrastructure}
      />,
    )

    expect(findButton('启动预览')?.disabled).toBe(true)
    expect(findButton('启动预览')?.title).toBe('正在检查后端服务，请稍候')

    await user.click(findButton('启动预览')!)
    fireEvent(container.querySelector('video')!, pointerEvent('pointerdown', 1, 20, 20))

    expect(onStartInfrastructure).not.toHaveBeenCalled()
    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('restarts auto-connect after an Activity workspace is restored', async () => {
    const onStartInfrastructure = vi.fn().mockResolvedValue('/webrtc-signaling')
    const props = {
      enabled: true,
      autoConnect: true,
      infrastructureStatus: { installed: true, serverRunning: true },
      onStartInfrastructure,
    }
    const { rerender } = render(
      <Activity mode="visible">
        <ScrcpyDeviceView {...props} />
      </Activity>,
    )
    await flush()
    expect(webrtcMock.connect).toHaveBeenCalledOnce()

    rerender(
      <Activity mode="hidden">
        <ScrcpyDeviceView {...props} />
      </Activity>,
    )
    rerender(
      <Activity mode="visible">
        <ScrcpyDeviceView {...props} />
      </Activity>,
    )
    await flush()

    expect(onStartInfrastructure).toHaveBeenCalledTimes(2)
    expect(webrtcMock.connect).toHaveBeenCalledTimes(2)
  })

  it('shows the status beam only while the preview is connecting', () => {
    webrtcMock.status = 'connecting'
    const props = {
      enabled: true,
      infrastructureStatus: { installed: true, serverRunning: true },
    }
    const { container, rerender } = render(<ScrcpyDeviceView {...props} />)

    const frame = container.querySelector('.scrcpy-video-frame')
    expect(frame?.classList.contains('status-border-beam')).toBe(true)
    expect(frame?.classList.contains('is-active')).toBe(true)
    expect(frame?.getAttribute('aria-busy')).toBe('true')

    webrtcMock.status = 'connected'
    rerender(<ScrcpyDeviceView {...props} />)

    expect(frame?.classList.contains('is-active')).toBe(false)
    expect(frame?.getAttribute('aria-busy')).toBe('false')
  })

  it('shows a command failure returned by the preview channel', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.sendCommand.mockResolvedValueOnce({
      requestId: 'failed-command',
      success: false,
      error: '命令执行失败',
    })
    const user = userEvent.setup({ delay: null })

    const { container } = render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
      />,
    )

    await user.click(findButton('返回')!)

    await waitFor(() => expect(container.textContent).toContain('命令执行失败'))
  })

  it('keeps compact preview controls outside the video and expands settings below them', async () => {
    const user = userEvent.setup({ delay: null })
    const { container } = render(
      <ScrcpyDeviceView
        variant="compact"
        enabled={false}
        infrastructureStatus={{ installed: true, serverRunning: false }}
      />,
    )

    const frame = container.querySelector('.scrcpy-video-frame')
    const toolbar = container.querySelector('.scrcpy-preview-toolbar')
    const openSettings = findButton('打开预览设置')

    expect(frame?.nextElementSibling).toBe(toolbar)
    expect(toolbar?.contains(frame)).toBe(false)
    expect(container.querySelector('.scrcpy-control-rail')).toBeNull()
    expect(openSettings?.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar?.getAttribute('role')).toBe('toolbar')
    expect(Array.from(toolbar?.querySelectorAll('button') || []).every(button => (
      button.className.includes('scrcpy-preview-control') && button.getAttribute('data-size') === 'md'
    ))).toBe(true)

    await user.click(openSettings!)

    const rail = container.querySelector('.scrcpy-control-rail.is-compact')
    expect(rail).not.toBeNull()
    expect(toolbar?.parentElement?.nextElementSibling).toBe(rail)
    expect(findButton('收起预览设置')?.getAttribute('aria-expanded')).toBe('true')
    expect(findButton('收起预览设置')?.getAttribute('aria-controls')).toBe(rail?.id)
  })

  it('keeps preview recovery controls available while blocking new device actions', async () => {
    webrtcMock.status = 'connected'
    const onStopPreview = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(
      <ScrcpyDeviceView
        enabled
        automationAvailable={false}
        automationUnavailableMessage="后端服务暂不可用"
        infrastructureStatus={{ installed: true, serverRunning: true }}
        onStopPreview={onStopPreview}
      />,
    )

    expect(findButton('停止预览')?.disabled).toBe(false)
    expect(findButton('断开')?.disabled).toBe(false)
    expect(findButton('返回')?.disabled).toBe(true)

    await user.click(findButton('停止预览')!)
    await user.click(findButton('断开')!)
    fireEvent.click(findButton('返回')!)

    expect(onStopPreview).toHaveBeenCalledOnce()
    expect(webrtcMock.disconnect).toHaveBeenCalledOnce()
    expect(webrtcMock.sendCommand).not.toHaveBeenCalled()
  })

  it('disables preview controls while an operation is running', () => {
    webrtcMock.status = 'connected'
    render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
        infrastructureLoading="stop"
        onStopPreview={vi.fn()}
      />,
    )

    expect(findButton('重连预览')?.disabled).toBe(true)
    expect(findButton('处理中')?.disabled).toBe(true)
  })

  it('shows input readiness and never starts a gesture while the input channel is unavailable', () => {
    webrtcMock.status = 'connected'
    const { container } = render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
      />,
    )

    expect(container.textContent).toContain('触控连接中，画面暂不可操作')
    const video = container.querySelector('video')!
    fireEvent(video, pointerEvent('pointerdown', 1, 20, 20))

    expect(webrtcMock.sendTouch).not.toHaveBeenCalled()
  })

  it('renders an unknown infrastructure state without calling it uninstalled', () => {
    const { container } = render(
      <ScrcpyDeviceView
        enabled={false}
        infrastructureStatus={null}
        infrastructureStatusState="error"
        infrastructureError="状态读取失败"
      />,
    )

    expect(container.textContent).toContain('预览服务：未知')
    expect(container.textContent).not.toContain('未安装')
  })

  it('applies preset FPS and marks manual quality changes as custom', async () => {
    const user = userEvent.setup({ delay: null })
    const { container } = render(
      <ScrcpyDeviceView
        enabled={false}
        infrastructureStatus={{ installed: true, serverRunning: false }}
      />,
    )

    await user.click(findButton('均衡画质')!)
    expect(container.textContent).toContain('1280p · 45 FPS')
    expect(container.textContent).toContain('画质已修改，重连预览后生效')

    await user.click(findButton('60')!)
    expect(container.textContent).toContain('自定义 · 1280p · 60 FPS')
    expect(screen.getByRole('group', { name: '视频帧率' })).not.toBeNull()
    expect(findButton('60')?.getAttribute('aria-label')).toBe('60 FPS')
    expect(findButton('60')?.className).toContain('min-h-11')
    expect(Array.from(container.querySelectorAll('.scrcpy-service-action, .scrcpy-utility-action')).every(button => (
      button.className.includes('min-h-11')
    ))).toBe(true)
    expect(container.querySelector('.scrcpy-bitrate-slider')?.className).toContain('min-h-11')
  })

  it('tracks pointers independently, coalesces moves per frame, and releases every pointer', () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    let frameCallback: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { container } = render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
      />,
    )

    const video = container.querySelector('video')!
    Object.assign(video, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    const dispatchPointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
      fireEvent(video, pointerEvent(type, pointerId, clientX, clientY))
    }

    dispatchPointer('pointerdown', 1, 10, 20)
    dispatchPointer('pointerdown', 2, 30, 40)
    dispatchPointer('pointermove', 1, 11, 21)
    dispatchPointer('pointermove', 1, 12, 22)
    dispatchPointer('pointermove', 2, 32, 42)

    expect(webrtcMock.sendTouch).toHaveBeenCalledTimes(2)
    act(() => frameCallback?.(16))
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(2, 12, 22, 1, video)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(2, 32, 42, 2, video)

    dispatchPointer('pointerup', 1, 13, 23)
    dispatchPointer('pointercancel', 2, 33, 43)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(1, 13, 23, 1, video)
    expect(webrtcMock.sendTouch).toHaveBeenCalledWith(3, 32, 42, 2, video)
  })

  it('does not track a pointer when the initial touch is rejected', () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    webrtcMock.sendTouch.mockReturnValueOnce(false)
    const { container } = render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
      />,
    )

    const video = container.querySelector('video')!
    Object.assign(video, { setPointerCapture: vi.fn() })
    const dispatchPointer = (type: string) => {
      fireEvent(video, pointerEvent(type, 7, 2, 2))
    }
    dispatchPointer('pointerdown')
    dispatchPointer('pointermove')
    dispatchPointer('pointerup')

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
    const user = userEvent.setup({ delay: null })

    const { container } = render(
      <ScrcpyDeviceView
        enabled
        infrastructureStatus={{ installed: true, serverRunning: true }}
      />,
    )
    const fullscreenButton = findButton('全屏')!
    fullscreenButton.focus()
    await user.click(fullscreenButton)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog)
    expect(container.inert).toBe(true)
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    const exitFullscreen = within(dialog).getByRole('button', { name: '退出全屏' })
    expect(exitFullscreen.className).toContain('scrcpy-immersive-control')
    expect(exitFullscreen.getAttribute('data-size')).toBe('md')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(container.inert).toBeFalsy()
    expect(container.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(fullscreenButton)
  })

  it('binds a media stream that arrives after immersive mode opens', async () => {
    webrtcMock.status = 'connected'
    webrtcMock.inputReady = true
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const user = userEvent.setup({ delay: null })

    const props = {
      enabled: true,
      infrastructureStatus: { installed: true, serverRunning: true },
    }
    const { rerender } = render(<ScrcpyDeviceView {...props} />)
    await user.click(findButton('全屏')!)
    const immersiveVideo = document.body.querySelector<HTMLVideoElement>('[aria-label="模拟器沉浸画面"]')
    expect(immersiveVideo?.srcObject == null).toBe(true)

    const lateStream = { getTracks: () => [] } as unknown as MediaStream
    webrtcMock.mediaStream = lateStream
    rerender(<ScrcpyDeviceView {...props} />)

    expect(immersiveVideo?.srcObject).toBe(lateStream)
    await user.click(screen.getByRole('button', { name: '退出全屏' }))
  })
})
