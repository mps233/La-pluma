// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScreenMonitor from './ScreenMonitor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const availabilityMock = vi.hoisted(() => ({
  isAvailable: false,
  unavailableMessage: '正在检查后端服务，请稍候',
}))

const apiMocks = vi.hoisted(() => ({
  getWebrtcStatus: vi.fn(),
  startWebrtc: vi.fn(),
  installWebrtc: vi.fn(),
  startWebrtcServer: vi.fn(),
  stopWebrtcServer: vi.fn(),
  startWebrtcAgent: vi.fn(),
  stopWebrtcAgent: vi.fn(),
}))

vi.mock('../hooks/useBackendStatusMonitor', () => ({
  useAutomationAvailability: () => availabilityMock,
}))

vi.mock('../services/api', () => ({
  maaApi: {
    ...apiMocks,
    getErrorMessage: (result?: { message?: string }) => result?.message || '预览操作失败',
  },
}))

interface MockDeviceViewProps {
  automationAvailable?: boolean
  automationUnavailableMessage?: string
  onStartInfrastructure?: () => Promise<string | undefined> | string | undefined
  onInstall?: () => Promise<void> | void
  onToggleServer?: () => Promise<void> | void
  onToggleAgent?: () => Promise<void> | void
}

vi.mock('./ScrcpyDeviceView', () => ({
  default: (props: MockDeviceViewProps) => (
    <div data-available={String(props.automationAvailable)} data-message={props.automationUnavailableMessage}>
      <button type="button" onClick={() => void props.onStartInfrastructure?.()}>start</button>
      <button type="button" onClick={() => void props.onInstall?.()}>install</button>
      <button type="button" onClick={() => void props.onToggleServer?.()}>server</button>
      <button type="button" onClick={() => void props.onToggleAgent?.()}>agent</button>
    </div>
  ),
}))

let container: HTMLDivElement
let root: Root

const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent === label)
  await act(async () => button?.click())
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ScreenMonitor automation availability guard', () => {
  beforeEach(() => {
    availabilityMock.isAvailable = false
    availabilityMock.unavailableMessage = '正在检查后端服务，请稍候'
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: false, agentRunning: false },
    })
    apiMocks.startWebrtc.mockResolvedValue({ success: true, data: { signalingUrl: '/webrtc-signaling' } })
    apiMocks.installWebrtc.mockResolvedValue({ success: true })
    apiMocks.startWebrtcServer.mockResolvedValue({ success: true })
    apiMocks.stopWebrtcServer.mockResolvedValue({ success: true })
    apiMocks.startWebrtcAgent.mockResolvedValue({ success: true })
    apiMocks.stopWebrtcAgent.mockResolvedValue({ success: true })
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each([
    ['checking', '正在检查后端服务，请稍候'],
    ['unavailable', '后端服务暂不可用，请确认服务已启动'],
  ])('blocks API side effects while backend is %s', async (_state, message) => {
    availabilityMock.unavailableMessage = message
    await act(async () => root.render(<ScreenMonitor />))
    await flush()

    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-available')).toBe('false')
    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-message')).toBe(message)

    await click('start')
    await click('install')
    await click('agent')
    await click('server')

    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
    expect(apiMocks.installWebrtc).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcAgent).not.toHaveBeenCalled()
  })

  it('allows stop actions while unavailable so an existing preview can recover', async () => {
    apiMocks.getWebrtcStatus.mockResolvedValueOnce({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: true },
    }).mockResolvedValueOnce({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    await act(async () => root.render(<ScreenMonitor />))
    await flush()

    await click('agent')
    await click('server')

    expect(apiMocks.stopWebrtcServer).toHaveBeenCalledOnce()
    expect(apiMocks.stopWebrtcAgent).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcAgent).not.toHaveBeenCalled()
  })
})
