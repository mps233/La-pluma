// @vitest-environment jsdom

import { act } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrcpyDeviceView from './ScrcpyDeviceView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const webrtcMock = vi.hoisted(() => ({
  status: 'idle',
  error: null as string | null,
  stats: null,
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
    webrtcMock.status = 'idle'
    webrtcMock.error = null
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
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
})
