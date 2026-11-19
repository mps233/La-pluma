// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScreenMonitor from './ScreenMonitor'

afterEach(cleanup)

const availabilityMock = vi.hoisted(() => ({
  isAvailable: false,
  unavailableMessage: '正在检查后端服务，请稍候',
}))

const apiMocks = vi.hoisted(() => ({
  getWebrtcStatus: vi.fn(),
  startWebrtc: vi.fn(),
  stopWebrtc: vi.fn(),
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
  onStopPreview?: () => Promise<void> | void
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
      {props.infrastructureStatus?.serverRunning && (
        <button type="button" onClick={() => void props.onStopPreview?.()}>stop</button>
      )}
    </div>
  ),
}))

const deviceView = (container: HTMLElement) => container.firstElementChild?.firstElementChild

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ScreenMonitor preview lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    availabilityMock.isAvailable = false
    availabilityMock.unavailableMessage = '正在检查后端服务，请稍候'
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, serverRunning: false },
    })
    apiMocks.startWebrtc.mockResolvedValue({ success: true, data: { signalingUrl: '/webrtc-signaling' } })
    apiMocks.stopWebrtc.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['checking', '正在检查后端服务，请稍候'],
    ['unavailable', '后端服务暂不可用，请确认服务已启动'],
  ])('blocks API side effects while backend is %s', async (_state, message) => {
    availabilityMock.unavailableMessage = message
    const user = userEvent.setup({ delay: null })
    const { container } = render(<ScreenMonitor />)
    await flush()

    expect(deviceView(container)?.getAttribute('data-available')).toBe('false')
    expect(deviceView(container)?.getAttribute('data-message')).toBe(message)

    await user.click(screen.getByRole('button', { name: 'start' }))
    const stop = screen.queryByRole('button', { name: 'stop' })
    if (stop) await user.click(stop)

    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
    expect(apiMocks.stopWebrtc).not.toHaveBeenCalled()
  })

  it('allows preview stop while unavailable so an existing preview can recover', async () => {
    apiMocks.getWebrtcStatus.mockResolvedValueOnce({
      success: true,
      data: { installed: true, serverRunning: true },
    }).mockResolvedValueOnce({
      success: true,
      data: { installed: true, serverRunning: false },
    })
    const user = userEvent.setup({ delay: null })
    const { container } = render(<ScreenMonitor />)
    await flush()

    await user.click(screen.getByRole('button', { name: 'stop' }))

    await waitFor(() => expect(apiMocks.stopWebrtc).toHaveBeenCalledOnce())
    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
    await waitFor(() => expect(deviceView(container)?.getAttribute('data-loading')).toBe(''))
  })

  it('reports an explicit error state instead of treating an unknown status as stopped', async () => {
    availabilityMock.isAvailable = true
    apiMocks.getWebrtcStatus.mockRejectedValueOnce(new Error('状态读取失败'))
    const { container } = render(<ScreenMonitor />)

    await waitFor(() => expect(deviceView(container)?.getAttribute('data-status-state')).toBe('error'))

    const view = deviceView(container)
    expect(view?.getAttribute('data-status-state')).toBe('error')
    expect(view?.getAttribute('data-has-status')).toBe('false')
    expect(view?.getAttribute('data-error')).toBe('状态读取失败')
  })

  it('serializes preview operations so a second action cannot overtake the first', async () => {
    availabilityMock.isAvailable = true
    let resolveStop: ((value: { success: boolean }) => void) | undefined
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, serverRunning: true },
    })
    apiMocks.stopWebrtc.mockImplementationOnce(() => new Promise(resolve => {
      resolveStop = resolve
    }))
    const user = userEvent.setup({ delay: null })
    const { container } = render(<ScreenMonitor />)
    await flush()

    await user.click(screen.getByRole('button', { name: 'stop' }))
    await user.click(screen.getByRole('button', { name: 'start' }))

    expect(apiMocks.stopWebrtc).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()

    await act(async () => {
      resolveStop?.({ success: true })
    })
    await waitFor(() => expect(deviceView(container)?.getAttribute('data-loading')).toBe(''))
    await user.click(screen.getByRole('button', { name: 'start' }))

    await waitFor(() => expect(apiMocks.startWebrtc).toHaveBeenCalledOnce())
  })

  it('ignores an initial status response that resolves after preview startup', async () => {
    availabilityMock.isAvailable = true
    let resolveInitial: ((value: { success: boolean; data: { serverRunning: boolean } }) => void) | undefined
    apiMocks.getWebrtcStatus.mockImplementationOnce(() => new Promise(resolve => {
      resolveInitial = resolve
    }))
    apiMocks.startWebrtc.mockResolvedValueOnce({
      success: true,
      data: { signalingUrl: '/webrtc-signaling', serverRunning: true },
    })

    const user = userEvent.setup({ delay: null })
    const { container } = render(<ScreenMonitor />)
    await user.click(screen.getByRole('button', { name: 'start' }))
    await waitFor(() => expect(deviceView(container)?.getAttribute('data-server-running')).toBe('true'))

    await act(async () => {
      resolveInitial?.({ success: true, data: { serverRunning: false } })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(deviceView(container)?.getAttribute('data-server-running')).toBe('true')
  })
})
