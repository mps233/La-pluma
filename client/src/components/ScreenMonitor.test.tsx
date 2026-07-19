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
  infrastructureStatus?: { serverRunning?: boolean } | null
  infrastructureStatusState?: string
  infrastructureLoading?: string | null
  infrastructureError?: string | null
}

vi.mock('./ScrcpyDeviceView', () => ({
  default: (props: MockDeviceViewProps) => (
    <div
      data-available={String(props.automationAvailable)}
      data-message={props.automationUnavailableMessage}
      data-status-state={props.infrastructureStatusState}
      data-loading={props.infrastructureLoading || ''}
      data-error={props.infrastructureError || ''}
      data-has-status={String(Boolean(props.infrastructureStatus))}
      data-server-running={String(Boolean(props.infrastructureStatus?.serverRunning))}
    >
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

  it('reports an explicit error state instead of treating an unknown status as stopped', async () => {
    availabilityMock.isAvailable = true
    apiMocks.getWebrtcStatus.mockRejectedValueOnce(new Error('状态读取失败'))
    await act(async () => root.render(<ScreenMonitor />))
    await flush()

    const view = container.firstElementChild?.firstElementChild
    expect(view?.getAttribute('data-status-state')).toBe('error')
    expect(view?.getAttribute('data-has-status')).toBe('false')
    expect(view?.getAttribute('data-error')).toBe('状态读取失败')
  })

  it('serializes service operations so a second action cannot overtake the first', async () => {
    availabilityMock.isAvailable = true
    let resolveInstall: ((value: { success: boolean }) => void) | undefined
    apiMocks.installWebrtc.mockImplementationOnce(() => new Promise(resolve => {
      resolveInstall = resolve
    }))
    await act(async () => root.render(<ScreenMonitor />))
    await flush()

    await click('install')
    await click('server')

    expect(apiMocks.installWebrtc).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()

    await act(async () => resolveInstall?.({ success: true }))
    await flush()
    await click('server')
    await flush()

    expect(apiMocks.startWebrtcServer).toHaveBeenCalledOnce()
  })

  it('does not start preview while another infrastructure action is pending', async () => {
    availabilityMock.isAvailable = true
    let resolveAgent: ((value: { success: boolean }) => void) | undefined
    apiMocks.startWebrtcAgent.mockImplementationOnce(() => new Promise(resolve => {
      resolveAgent = resolve
    }))
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    await act(async () => root.render(<ScreenMonitor />))
    await flush()

    await click('agent')
    await click('start')

    expect(apiMocks.startWebrtcAgent).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()

    await act(async () => resolveAgent?.({ success: true }))
    await flush()
  })

  it('ignores an initial status response that resolves after preview startup', async () => {
    availabilityMock.isAvailable = true
    let resolveInitial: ((value: { success: boolean; data: { serverRunning: boolean } }) => void) | undefined
    apiMocks.getWebrtcStatus.mockImplementationOnce(() => new Promise(resolve => {
      resolveInitial = resolve
    }))
    apiMocks.startWebrtc.mockResolvedValueOnce({
      success: true,
      data: { signalingUrl: '/webrtc-signaling', serverRunning: true, agentRunning: true },
    })

    await act(async () => root.render(<ScreenMonitor />))
    await click('start')
    await flush()
    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-server-running')).toBe('true')

    await act(async () => resolveInitial?.({ success: true, data: { serverRunning: false } }))
    await flush()

    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-server-running')).toBe('true')
  })
})
