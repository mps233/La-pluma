// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { userConfigCoordinator } from '@/features/user-config'
import { publishResourceInvalidation } from '@/features/resource-invalidation'
import AutomationTasks from './AutomationTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  getTaskStatus: vi.fn(),
  generateTrainingPlan: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
  testConnection: vi.fn(),
  executeScheduleNow: vi.fn(),
  setActive: vi.fn(),
  setMessage: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, layout: _layout, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/features/automation/api', () => ({
  getActivity: mocks.getActivity,
  getScheduleExecutionStatus: mocks.getScheduleExecutionStatus,
  setupSchedule: mocks.setupSchedule,
  stopSchedule: mocks.stopSchedule,
  executeScheduleNow: mocks.executeScheduleNow,
}))

vi.mock('@/features/task-execution', async () => {
  const actual = await vi.importActual<typeof import('@/features/task-execution')>('@/features/task-execution')
  const state = {
    phase: 'live' as const,
    identity: 'none' as const,
    submission: 'idle' as const,
    snapshot: null,
    trackedRunId: null,
    trackedScope: null,
    trackedRun: null,
    lastError: null,
    lastSyncedAt: null,
    hasActiveRun: false,
    occupancy: null,
  }
  const controller = {
    getState: () => state,
    subscribe: () => () => {},
    submitExecution: vi.fn(),
    stopTrackedRun: vi.fn(),
    observeRun: vi.fn(),
    refresh: vi.fn(),
  }
  return {
    ...actual,
    executionController: controller,
    useExecutionSnapshot: () => state,
  }
})

vi.mock('@/features/user-config', async () => {
  const actual = await vi.importActual<typeof import('@/features/user-config')>('@/features/user-config')
  return {
    ...actual,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
  }
})

vi.mock('@/features/settings', () => ({ testConnection: mocks.testConnection }))
vi.mock('@/features/training', () => ({ generateTrainingPlan: mocks.generateTrainingPlan }))

vi.mock('@/features/runtime-status', () => ({
  useStatusStore: (selector?: (state: { setMessage: typeof mocks.setMessage; setActive: typeof mocks.setActive }) => unknown) => {
    if (!selector) throw new Error('useStatusStore must be called with a selector')
    return selector({ setMessage: mocks.setMessage, setActive: mocks.setActive })
  },
  FloatingStatusIndicator: () => null,
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('@/features/device-mirror', () => ({ DeviceMonitorPanel: () => <div data-testid="screen-monitor" /> }))
vi.mock('@/features/automation/components/NotificationSettings', () => ({ default: () => <div /> }))

class IntersectionObserverMock {
  observe() {}
  disconnect() {}
}

const taskFlowFixture = [
  {
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    description: '启动游戏并进入主界面',
    enabled: true,
    params: { clientType: 'Official', accountName: '' },
  },
  {
    id: 'fight-1',
    commandId: 'fight',
    name: '理智作战',
    description: '自动刷关卡消耗理智',
    enabled: true,
    params: { stages: [{ stage: '1-7', times: '1' }], drops: '', medicine: 0, medicineExpireDays: 0, stone: 0, series: '1', clientType: '' },
  },
]

let container: HTMLDivElement
let root: Root
let queryClient: ReturnType<typeof createQueryClient>
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  })
}

const settleDebouncedDraft = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300))
  })
  await settle()
}

const click = async (element: HTMLElement) => {
  await act(async () => element.click())
  // 协调器对本地草稿（250ms）与完整提交（300ms）都做了去抖，等待最后一次编辑落盘。
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 350))
  })
  await settle()
}

const scheduleSwitch = () => container.querySelector<HTMLElement>('[role="switch"][aria-label="启用定时执行"]')!
const pendingDraft = () => localStorage.getItem('automationConfigSyncPending')

const renderAutomation = async () => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <AutomationTasks />
    </QueryClientProvider>,
  ))
  await settle()
}

const renderAutomationWithActivity = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Activity mode={mode}>
          <AutomationTasks />
        </Activity>
      </QueryClientProvider>,
    )
  })
  await settle()
}

const publishPlanApplied = (stageCount = 3) => {
  publishResourceInvalidation({
    resources: ['automation-config', 'automation-schedule', 'dashboard-snapshot'],
    cause: 'plan-applied',
    detail: { stageCount },
  })
}

describe('AutomationTasks config persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    localStorage.clear()
    // 协调器是应用级单例：每个用例从空通道与空存储开始，避免跨用例沿用草稿/队列。
    userConfigCoordinator.dispose()
    // 活动读取走 Query：每个用例独立客户端，避免复用上一个用例的 mock 结果。
    queryClient = createQueryClient()
    mocks.getActivity.mockReset().mockResolvedValue({ success: false })
    mocks.getScheduleExecutionStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: false })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: true, data: { taskFlow: [] } })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.stopSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.testConnection.mockReset().mockResolvedValue({ success: true })
    mocks.executeScheduleNow.mockReset()
    mocks.setActive.mockReset()
    mocks.setMessage.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })

  it('clears the pending draft only after the config and enabled schedule both succeed', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: false, times: ['08:00'] } },
    })

    await renderAutomation()
    await click(scheduleSwitch())

    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    const [configType, payload] = mocks.saveUserConfig.mock.calls[0] as [string, {
      taskFlow: unknown[]
      schedule: { enabled: boolean; times: string[] }
    }]
    expect(configType).toBe('automation-tasks')
    expect(payload.schedule).toEqual({ enabled: true, times: ['08:00'] })
    expect(payload.taskFlow).toHaveLength(2)
    expect(mocks.setupSchedule).toHaveBeenCalledWith('default', ['08:00'], payload.taskFlow)
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
    expect(pendingDraft()).toBeNull()
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['08:00'],
    })
  })

  it('does not touch the server schedule when the config save fails', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.saveUserConfig.mockResolvedValueOnce({ success: false, message: '配置存储暂不可用' })

    await renderAutomation()
    await click(scheduleSwitch())

    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
    expect(pendingDraft()).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('配置已保存在此设备，但尚未同步到服务器：配置存储暂不可用')
    expect(mocks.setMessage).not.toHaveBeenCalled()
  })

  it('keeps the pending draft when the schedule step fails after the config save, then clears it on a later full success', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: false, times: ['08:00'] } },
    })
    mocks.setupSchedule.mockResolvedValueOnce({ success: false, message: '排班设置失败' })

    await renderAutomation()
    await click(scheduleSwitch())

    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.setupSchedule).toHaveBeenCalledOnce()
    expect(pendingDraft()).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('配置已保存在此设备，但尚未同步到服务器：排班设置失败')

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.loadUserConfig.mockClear()
    await renderAutomation()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(pendingDraft()).not.toBeNull()
    expect(container.textContent).toContain('理智作战')
    expect(container.textContent).toContain('配置已保存在此设备，但尚未同步到服务器：排班设置失败')

    await click(scheduleSwitch())
    await settle()

    expect(mocks.stopSchedule).toHaveBeenCalledWith('default')
    expect(pendingDraft()).toBeNull()
  })

  it('bounds the complete unit with a server stop when the schedule is disabled', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: true, times: ['08:00'] } },
    })

    await renderAutomation()
    await click(scheduleSwitch())

    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    const [, payload] = mocks.saveUserConfig.mock.calls[0] as [string, {
      schedule: { enabled: boolean; times: string[] }
    }]
    expect(payload.schedule).toEqual({ enabled: false, times: ['08:00'] })
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).toHaveBeenCalledWith('default')
    expect(pendingDraft()).toBeNull()
  })

  it('stops the server schedule when every entry is disabled', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: { enabled: true, entries: [{ time: '08:00', enabled: false }] },
      },
    })

    await renderAutomation()
    const entrySwitch = container.querySelector<HTMLElement>('[role="switch"][aria-label="08:00 启用"]')!
    await click(entrySwitch)
    mocks.setupSchedule.mockClear()
    await click(entrySwitch)

    const calls = mocks.saveUserConfig.mock.calls
    const [, payload] = calls[calls.length - 1] as [string, {
      schedule: { enabled: boolean; times: string[] }
    }]
    expect(payload.schedule).toEqual({ enabled: true, times: [] })
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).toHaveBeenCalledWith('default')
    expect(pendingDraft()).toBeNull()
  })

  const seedPendingDisabledScheduleEntry = () => {
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowFixture))
    localStorage.setItem('maa-schedule', JSON.stringify({
      enabled: true,
      times: ['08:00'],
      entries: [
        { time: '08:00', enabled: true },
        { time: '14:00', enabled: false },
      ],
    }))
    localStorage.setItem('automationConfigSyncPending', 'pending-local-draft')
  }

  it('persists an edit to a disabled schedule entry locally even though the wire times stay the same', async () => {
    const pendingSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(pendingSave.promise)
    seedPendingDisabledScheduleEntry()

    await renderAutomation()
    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    const timeInput = container.querySelector<HTMLInputElement>('#automation-schedule-time-1')
    expect(timeInput?.value).toBe('14:00')

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      inputValueSetter?.call(timeInput, '15:00')
      timeInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settleDebouncedDraft()

    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-1')?.value).toBe('15:00')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      entries: [
        { time: '08:00', enabled: true },
        { time: '15:00', enabled: false },
      ],
    })
    expect(pendingDraft()).not.toBeNull()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    expect(mocks.saveUserConfig.mock.calls[0]?.[1]).toMatchObject({
      schedule: { enabled: true, times: ['08:00'] },
    })

    await act(async () => pendingSave.resolve({ success: true }))
    await settle()
    expect(pendingDraft()).toBeNull()
  })

  it('persists deleting a disabled schedule entry locally even though the wire times stay the same', async () => {
    const pendingSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(pendingSave.promise)
    seedPendingDisabledScheduleEntry()

    await renderAutomation()
    expect(container.querySelector('[aria-label="已设置 2 个执行时间"]')).not.toBeNull()

    await click(container.querySelector<HTMLButtonElement>('[aria-label="删除 14:00"]')!)
    await settle()

    expect(container.querySelector('[aria-label="已设置 1 个执行时间"]')).not.toBeNull()
    expect(container.querySelector('#automation-schedule-time-1')).toBeNull()
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      entries: [{ time: '08:00', enabled: true }],
    })
    expect(pendingDraft()).not.toBeNull()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await act(async () => pendingSave.resolve({ success: true }))
    await settle()
    expect(pendingDraft()).toBeNull()
  })

  it('serializes saves across mounts and never lets an older save clear the newer draft', async () => {
    const olderSave = deferred<{ success: boolean }>()
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: false } },
    })
    mocks.saveUserConfig.mockReturnValueOnce(olderSave.promise)

    await renderAutomation()
    await click(scheduleSwitch())
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderAutomation()

    const newerSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(newerSave.promise)
    await click(scheduleSwitch())
    const newerSyncToken = pendingDraft()
    expect(newerSyncToken).not.toBeNull()
    // 协调器按 key 串行：重挂载后的提交排在旧请求之后，不会立刻发出第二个请求。
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await act(async () => olderSave.resolve({ success: true }))
    await settle()
    expect(pendingDraft()).toBe(newerSyncToken)
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)

    await act(async () => newerSave.resolve({ success: true }))
    await settle()
    expect(mocks.stopSchedule).toHaveBeenCalledWith('default')
    expect(pendingDraft()).toBeNull()
  })

  it('ignores a server load that settles after the user edits the schedule', async () => {
    const serverLoad = deferred<{
      success: boolean
      data: { taskFlow: typeof taskFlowFixture }
    }>()
    mocks.loadUserConfig.mockReturnValueOnce(serverLoad.promise)

    await renderAutomation()
    await click(scheduleSwitch())

    await act(async () => serverLoad.resolve({ success: true, data: { taskFlow: taskFlowFixture } }))
    await settle()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('理智作战')
    expect(JSON.parse(localStorage.getItem('maa-task-flow') || '[]')).toEqual([])
  })

  it('loads the server copy when a pending marker has no local draft', async () => {
    localStorage.setItem('automationConfigSyncPending', 'stale-token')
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderAutomation()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(pendingDraft()).toBeNull()
    expect(container.textContent).toContain('理智作战')
  })

  it('retries the whole commit from the page alert after the schedule step fails', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: false, times: ['08:00'] } },
    })
    mocks.setupSchedule.mockResolvedValueOnce({ success: false, message: '排班设置失败' })

    await renderAutomation()
    await click(scheduleSwitch())

    expect(pendingDraft()).not.toBeNull()
    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('重新同步'))
    expect(retryButton).toBeDefined()

    await click(retryButton!)
    await settle()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.setupSchedule).toHaveBeenCalledTimes(2)
    expect(pendingDraft()).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.setMessage).toHaveBeenCalledWith('自动化配置已同步', 'success')
  })

  it('does not confirm a newer revision when an older commit finishes late', async () => {
    const firstSave = deferred<{ success: boolean }>()
    const secondSave = deferred<{ success: boolean }>()
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: false, times: ['08:00'] } },
    })
    mocks.saveUserConfig
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise)

    await renderAutomation()
    await click(scheduleSwitch())
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await click(scheduleSwitch())
    const newerSyncToken = pendingDraft()
    expect(newerSyncToken).not.toBeNull()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await act(async () => firstSave.resolve({ success: true }))
    await settle()
    expect(pendingDraft()).toBe(newerSyncToken)
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)

    await act(async () => secondSave.resolve({ success: true }))
    await settle()
    expect(mocks.stopSchedule).toHaveBeenCalledWith('default')
    expect(pendingDraft()).toBeNull()
  })

  it('waits for an in-flight save before adopting the applied plan and keeps the saved edit', async () => {
    const pendingSave = deferred<{ success: boolean }>()
    const initialConfig = { taskFlow: taskFlowFixture, schedule: { enabled: false } }
    let savedPayload: unknown = null
    mocks.loadUserConfig.mockImplementation(async () => ({
      success: true,
      data: savedPayload ?? initialConfig,
    }))
    mocks.saveUserConfig.mockImplementationOnce(async (_key: string, payload: unknown) => {
      savedPayload = payload
      await pendingSave.promise
      return { success: true }
    })

    await renderAutomation()
    await click(scheduleSwitch())
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(pendingDraft()).not.toBeNull()
    expect(scheduleSwitch().getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      publishPlanApplied()
    })
    await settle()

    // 同一配置协议：计划失效先等本页的在途保存落盘，不抢先读取更旧的服务端副本。
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(pendingDraft()).not.toBeNull()

    await act(async () => pendingSave.resolve({ success: true }))
    await settle()

    expect(mocks.loadUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.setupSchedule).toHaveBeenCalledWith(
      'default',
      ['08:00', '14:00', '20:00'],
      expect.any(Array),
    )
    expect(pendingDraft()).toBeNull()
    expect(scheduleSwitch().getAttribute('aria-checked')).toBe('true')
    expect(mocks.setMessage).toHaveBeenCalledWith('智能养成计划已更新：3 个关卡', 'success')
  })

  it('keeps local-only disabled schedule entries when adopting an applied plan', async () => {
    localStorage.setItem('maa-schedule', JSON.stringify({
      enabled: true,
      entries: [
        { time: '08:00', enabled: true },
        { time: '14:00', enabled: false },
      ],
    }))
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { taskFlow: taskFlowFixture, schedule: { enabled: true, times: ['08:00'] } },
    })

    await renderAutomation()
    expect(container.querySelector('[aria-label="已设置 2 个执行时间"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-1')?.value).toBe('14:00')

    await act(async () => {
      publishPlanApplied()
    })
    await settle()

    expect(container.querySelector('[aria-label="已设置 2 个执行时间"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-1')?.value).toBe('14:00')
  })

  it('applies a plan invalidation missed while the page is hidden after Activity resumes', async () => {
    const updatedTaskFlow = [
      ...taskFlowFixture,
      {
        id: 'mall-1',
        commandId: 'mall',
        name: '信用收支',
        description: '访问好友、收取信用',
        enabled: true,
        params: { visit_friends: true, shopping: true },
      },
    ]
    mocks.loadUserConfig
      .mockResolvedValueOnce({ success: true, data: { taskFlow: taskFlowFixture, schedule: { enabled: false } } })
      .mockResolvedValueOnce({ success: true, data: { taskFlow: updatedTaskFlow, schedule: { enabled: false } } })

    await renderAutomationWithActivity('visible')
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()

    await renderAutomationWithActivity('hidden')
    await act(async () => {
      publishPlanApplied()
    })
    await settle()
    // 隐藏期间 Effect 已注销，不直接刷新。
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()

    await renderAutomationWithActivity('visible')
    await settle()

    expect(mocks.loadUserConfig).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('信用收支')
    expect(mocks.setMessage).toHaveBeenCalledWith('智能养成计划已更新', 'success')
  })

  it('refuses a forced server reload while a pending local draft is restored', async () => {
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowFixture))
    localStorage.setItem('maa-schedule', JSON.stringify({ enabled: false, times: ['14:00'] }))
    localStorage.setItem('automationConfigSyncPending', 'pending-local-draft')
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: [] } })

    await renderAutomation()
    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.textContent).toContain('理智作战')

    await act(async () => {
      publishPlanApplied()
    })
    await settle()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(mocks.setMessage).toHaveBeenCalledWith(
      '检测到本设备有未同步的流程编辑，已保留本地草稿；养成计划更新未覆盖本地配置',
      'warning',
    )
    expect(container.textContent).toContain('理智作战')
  })

  it('warns when an applied plan cannot be reloaded and no local copy remains', async () => {
    mocks.loadUserConfig
      .mockResolvedValueOnce({ success: true, data: { taskFlow: taskFlowFixture, schedule: { enabled: false } } })
      .mockResolvedValueOnce({ success: false, message: '服务暂不可用' })

    await renderAutomation()
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()

    localStorage.clear()
    await act(async () => {
      publishPlanApplied()
    })
    await settle()

    expect(mocks.loadUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.setMessage).toHaveBeenCalledWith('自动化配置刷新失败，请稍后重试', 'warning')
  })

  it('reloads the automation flow when training applies a plan', async () => {
    const updatedTaskFlow = [
      ...taskFlowFixture,
      {
        id: 'mall-1',
        commandId: 'mall',
        name: '信用收支',
        description: '访问好友、收取信用',
        enabled: true,
        params: { visit_friends: true, shopping: true },
      },
    ]
    mocks.loadUserConfig
      .mockResolvedValueOnce({ success: true, data: { taskFlow: taskFlowFixture } })
      .mockResolvedValueOnce({ success: true, data: { taskFlow: updatedTaskFlow } })

    await renderAutomation()
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('信用收支')

    await act(async () => {
      publishPlanApplied()
    })
    await settle()

    expect(mocks.loadUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.setMessage).toHaveBeenCalledWith('智能养成计划已更新：3 个关卡', 'success')
    expect(container.textContent).toContain('信用收支')
  })
})
