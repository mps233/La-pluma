// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStatusStore } from '../store/statusStore'
import Dashboard from './Dashboard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiMocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  getDeviceStats: vi.fn(),
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  executeScheduleNow: vi.fn(),
  runCurrentActivity: vi.fn(),
  getSklandStatus: vi.fn(),
  getSklandPlayerData: vi.fn(),
  getTrainingQueue: vi.fn(),
  getTodayDrops: vi.fn(),
  getOpenTodayStages: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: apiMocks.getTaskStatus,
    getDeviceStats: apiMocks.getDeviceStats,
    getActivity: apiMocks.getActivity,
    getScheduleExecutionStatus: apiMocks.getScheduleExecutionStatus,
    loadUserConfig: apiMocks.loadUserConfig,
    executeScheduleNow: apiMocks.executeScheduleNow,
    runCurrentActivity: apiMocks.runCurrentActivity,
    getErrorMessage: (result?: { message?: string; error?: string }) => result?.message || result?.error || '未知错误',
  },
  getSklandStatus: apiMocks.getSklandStatus,
  getSklandPlayerData: apiMocks.getSklandPlayerData,
  getTrainingQueue: apiMocks.getTrainingQueue,
  getTodayDrops: apiMocks.getTodayDrops,
  getOpenTodayStages: apiMocks.getOpenTodayStages,
}))

vi.mock('@/stores', () => ({
  useUIStore: (selector: (state: { setActiveTab: () => void }) => unknown) => selector({ setActiveTab: vi.fn() }),
}))

vi.mock('../hooks/useDashboardFlowLayout', () => ({
  useDashboardFlowLayout: () => ({
    flowGridRef: { current: null },
    flowCardRef: { current: null },
    flowPreviewRef: { current: null },
    flowGridStyle: undefined,
  }),
}))

vi.mock('./DashboardPreviewEntry', () => ({ default: () => <div>preview</div> }))
vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./Icons', () => {
  const Icon = () => null
  return { default: new Proxy({}, { get: () => Icon }) }
})
vi.mock('./common/Loading', () => ({ DashboardSkeleton: () => <div>loading</div> }))
vi.mock('./common', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Button: ({ children, icon: _icon, loading, loadingText, statusKey: _statusKey, variant: _variant, size: _size, className: _className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; loadingText?: React.ReactNode; statusKey?: string; variant?: string; size?: string; icon?: React.ReactNode }) => (
    <button {...props}>{loading ? loadingText : children}</button>
  ),
  IconButton: ({ icon: _icon, variant: _variant, size: _size, className: _className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; variant?: string; size?: string }) => <button {...props} />,
}))

let online = true
let container: HTMLDivElement
let root: Root

const findButton = (text: string) => Array.from(container.querySelectorAll('button'))
  .find(button => button.textContent?.includes(text))

async function flushDashboard() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Dashboard connectivity state', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    apiMocks.getTaskStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getDeviceStats.mockResolvedValue({ success: false })
    apiMocks.getActivity.mockResolvedValue({ success: true, data: { available: true, name: '测试活动' } })
    apiMocks.getScheduleExecutionStatus.mockResolvedValue({ success: true, data: { isRunning: false } })
    apiMocks.getSklandStatus.mockResolvedValue({ success: true, data: { isLoggedIn: false, phone: null } })
    apiMocks.getSklandPlayerData.mockResolvedValue({ success: false })
    apiMocks.getTrainingQueue.mockResolvedValue({ success: true, data: [] })
    apiMocks.getTodayDrops.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOpenTodayStages.mockResolvedValue({ success: true, data: { open: [], closed: [] } })
    useStatusStore.getState().setBackendStatus('unknown')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    useStatusStore.getState().setBackendStatus('unknown')
    vi.clearAllMocks()
  })

  it('disables execution actions as soon as the browser goes offline', async () => {
    await act(async () => root.render(<Dashboard />))
    await flushDashboard()

    expect(container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
    expect(findButton('打当前活动')?.disabled).toBe(false)

    online = false
    act(() => window.dispatchEvent(new Event('offline')))

    expect(container.textContent).toContain('当前网络离线')
    expect(findButton('开始今日流程')?.disabled).toBe(true)
    expect(findButton('打当前活动')?.disabled).toBe(true)
  })

  it('shows a retry action and recovers after the backend becomes available', async () => {
    apiMocks.getTaskStatus.mockRejectedValueOnce(new Error('无法连接后端服务，请确认服务已启动'))

    await act(async () => root.render(<Dashboard />))
    await flushDashboard()

    expect(container.textContent).toContain('后端服务不可用')
    expect(findButton('重试连接')).toBeDefined()
    expect(findButton('开始今日流程')?.disabled).toBe(true)
    expect(findButton('打当前活动')?.disabled).toBe(true)

    await act(async () => findButton('重试连接')?.click())
    await flushDashboard()

    expect(container.textContent).toContain('准备就绪')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
    expect(findButton('打当前活动')?.disabled).toBe(false)
  })

  it('keeps actions available while a background refresh checks the backend', async () => {
    await act(async () => root.render(<Dashboard />))
    await flushDashboard()

    let resolveBackendCheck: ((value: { success: boolean; data: { isRunning: boolean } }) => void) | undefined
    apiMocks.getTaskStatus.mockReturnValueOnce(new Promise(resolve => {
      resolveBackendCheck = resolve
    }))

    act(() => findButton('刷新数据')?.click())

    expect(useStatusStore.getState().backendStatus).toBe('available')
    expect(container.textContent).not.toContain('正在检查服务')
    expect(findButton('开始今日流程')?.disabled).toBe(false)
    expect(findButton('打当前活动')?.disabled).toBe(false)

    await act(async () => resolveBackendCheck?.({ success: true, data: { isRunning: false } }))
    await flushDashboard()
  })
})
