// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { userConfigCoordinator } from '@/features/user-config'
import AutomationTasks from './AutomationTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const checkboxRowLabel = (id: string) => {
  const control = container.querySelector(`[id="${id}"]`)
  const label = control?.closest('label') ?? container.querySelector(`label[for="${id}"]`)
  expect(label, `label row for ${id}`).not.toBeNull()
  return label as HTMLLabelElement
}

const selectOptionLabels = async (trigger: HTMLElement) => {
  await act(async () => trigger.click())
  const popupId = trigger.getAttribute('aria-controls')
  const labels = popupId
    ? [...(document.getElementById(popupId)?.querySelectorAll('[role="option"]') ?? [])].map(node => node.textContent?.trim())
    : []
  await act(async () => {
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await act(async () => {})
  return labels
}

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  getTaskStatus: vi.fn(),
  generateTrainingPlan: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setActive: vi.fn(),
  setMessage: vi.fn(),
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
  testConnection: vi.fn(),
  executeScheduleNow: vi.fn(),
  scrollIntoView: vi.fn(),
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

vi.mock('@/features/settings', () => ({
  testConnection: mocks.testConnection,
}))

vi.mock('@/features/training', () => ({
  generateTrainingPlan: mocks.generateTrainingPlan,
}))

vi.mock('@/features/runtime-status', () => ({
  useStatusStore: (selector?: (state: { setMessage: typeof mocks.setMessage; setActive: typeof mocks.setActive }) => unknown) => {
    if (!selector) throw new Error('useStatusStore must be called with a selector')
    return selector({ setMessage: mocks.setMessage, setActive: mocks.setActive })
  },
  FloatingStatusIndicator: () => null,
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('@/features/device-mirror', () => ({
  DeviceMonitorPanel: () => (
    <div data-testid="screen-monitor" data-variant="compact" />
  ),
}))

vi.mock('@/features/automation/components/NotificationSettings', () => ({ default: () => <div data-testid="notification-settings" /> }))

class IntersectionObserverMock {
  observe() {}
  disconnect() {}
}

let container: HTMLDivElement
let root: Root
let queryClient: ReturnType<typeof createQueryClient>
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

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
    params: {
      stages: [
        { stage: '1-7', times: '1' },
        { stage: 'CE-6', times: '2' },
      ],
      drops: '',
      medicine: 0,
      medicineExpireDays: 0,
      stone: 0,
      series: '1',
      clientType: '',
    },
  },
  {
    id: 'recruit-1',
    commandId: 'recruit',
    name: '自动公招',
    description: '自动公开招募',
    enabled: true,
    params: {
      refresh: true,
      force_refresh: true,
      select: [4, 5, 6],
      confirm: [3, 4],
      times: '4',
      set_time: true,
      expedite: false,
      expedite_times: 0,
      preserve_tags: '支援机械',
      first_tags: '',
      extra_tags_mode: 0,
      recruitment_time: { '3': 540, '4': 540 },
    },
  },
]

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    // 本地草稿写入按 250ms 去抖；等待最后一次编辑落盘后再断言 localStorage。
    await new Promise(resolve => setTimeout(resolve, 260))
  })
}

const renderPage = async () => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <AutomationTasks />
    </QueryClientProvider>,
  ))
  await flush()
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes(label))

const findStageEditor = () => Array.from(container.querySelectorAll('fieldset'))
  .find(fieldset => fieldset.querySelector('legend')?.textContent === '关卡计划')

const clickSequenceTask = async (taskName: string) => {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-controls="automation-task-editor"]'))
    .find(candidate => candidate.textContent?.includes(taskName))

  expect(button).toBeDefined()
  await act(async () => button?.click())
  await flush()
  return button
}

const sequenceOrder = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label^="调整"]'))
  .map(button => button.getAttribute('aria-label')?.match(/^调整(.+)顺序，当前第 \d+ 位$/)?.[1] ?? '')

const pointerEvent = (
  type: string,
  init: { clientY: number; clientX?: number; pointerId?: number },
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  return event
}

const stubSequenceRects = () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rows = Array.from(container.querySelectorAll('[data-execution-state]'))
    const index = rows.indexOf(this)
    const top = index * 100
    return {
      top,
      bottom: top + 80,
      height: 80,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  })
}

const savedFlowIds = () => (
  JSON.parse(localStorage.getItem('maa-task-flow') || '[]') as Array<{ id: string }>
).map(task => task.id)

describe('AutomationTasks layout surfaces', () => {
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
      value: mocks.scrollIntoView,
    })
    localStorage.clear()
    // 协调器是应用级单例：每个用例从空通道与空存储开始，避免跨用例沿用草稿/队列。
    userConfigCoordinator.dispose()
    // Query 客户端每个用例独立，避免复用上一个用例的缓存结果。
    queryClient = createQueryClient()
    mocks.getActivity.mockReset().mockResolvedValue({ success: false })
    mocks.getScheduleExecutionStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: false })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: true, data: { taskFlow: [] } })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.stopSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.testConnection.mockReset().mockResolvedValue({ success: true, data: { success: true, message: '连接正常' } })
    mocks.executeScheduleNow.mockReset()
    mocks.scrollIntoView.mockReset()
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

  it('uses the compact device monitor in the automation workspace', async () => {
    await renderPage()

    expect(container.querySelector('[data-testid="screen-monitor"]')?.getAttribute('data-variant')).toBe('compact')
  })

  it('hydrates an enabled schedule without rebuilding the server schedule', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: { enabled: true, times: ['08:00'] },
      },
    })

    await renderPage()

    expect(container.querySelector('[role="switch"][aria-label="启用定时执行"]')?.getAttribute('aria-checked')).toBe('true')
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
  })

  it('states that schedule times follow the game service time zone', async () => {
    await renderPage()

    expect(container.textContent).toContain('游戏服务区时区 · 每日 04:00 刷新游戏日')
  })

  it('summarizes paused schedule times while the schedule is disabled', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: {
          enabled: false,
          entries: [
            { time: '08:00', enabled: true },
            { time: '14:00', enabled: false },
          ],
        },
      },
    })

    await renderPage()

    expect(container.querySelector('[role="switch"][aria-label="启用定时执行"]')?.getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).toContain('已暂停')
    expect(container.textContent).toContain('08:00 / 14:00')
    expect(container.querySelector('[aria-label="第 1 个执行时间"]')).toBeNull()
  })

  it('adds schedule times from the noon-first candidate list up to the row limit', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: {
          enabled: true,
          entries: ['08:00', '12:00', '13:00', '14:00', '15:00'].map(time => ({ time, enabled: true })),
        },
      },
    })

    await renderPage()

    expect(container.querySelector('[aria-label="已设置 5 个执行时间"]')).not.toBeNull()
    const addTimeButton = findButton('新增时间')
    expect(addTimeButton).toBeDefined()

    await act(async () => addTimeButton?.click())
    await flush()

    expect(container.querySelector('[aria-label="已设置 6 个执行时间"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-5')?.value).toBe('16:00')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['08:00', '12:00', '13:00', '14:00', '15:00', '16:00'],
    })
    expect(container.textContent).toContain('最多 6 个')
    expect(findButton('新增时间')?.disabled).toBe(true)
  })

  it('masks typed digits into HH:MM and commits once four digits are entered', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: {
          enabled: true,
          entries: ['08:30', '12:45'].map(time => ({ time, enabled: true })),
        },
      },
    })

    await renderPage()

    const timeInput = container.querySelector<HTMLInputElement>('#automation-schedule-time-0')!
    expect(timeInput.getAttribute('type')).toBe('text')
    expect(timeInput.getAttribute('placeholder')).toBe('HH:MM')
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const typeValue = async (value: string) => {
      await act(async () => {
        inputValueSetter?.call(timeInput, value)
        timeInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await flush()
    }

    await typeValue('1')
    expect(timeInput.value).toBe('1')
    await typeValue('18')
    expect(timeInput.value).toBe('18')
    await typeValue('183')
    expect(timeInput.value).toBe('18:3')
    await typeValue('1830')
    expect(timeInput.value).toBe('18:30')

    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['18:30', '12:45'],
    })
  })

  it('normalizes a short time draft on blur and rejects an invalid time', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: {
          enabled: true,
          entries: ['08:30', '12:45'].map(time => ({ time, enabled: true })),
        },
      },
    })

    await renderPage()

    const timeInput = container.querySelector<HTMLInputElement>('#automation-schedule-time-0')!
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

    timeInput.focus()
    await act(async () => {
      inputValueSetter?.call(timeInput, '9')
      timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(timeInput.value).toBe('9')

    await act(async () => timeInput.blur())
    await flush()

    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-0')?.value).toBe('09:00')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['09:00', '12:45'],
    })

    timeInput.focus()
    await act(async () => {
      inputValueSetter?.call(timeInput, '99')
      timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => timeInput.blur())
    await flush()

    expect(mocks.setMessage).toHaveBeenCalledWith('请输入 00:00–23:59 的时间', 'error')
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-0')?.value).toBe('09:00')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['09:00', '12:45'],
    })
  })

  it('rejects a duplicate schedule time without writing the draft', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: {
          enabled: true,
          entries: ['08:30', '12:45'].map(time => ({ time, enabled: true })),
        },
      },
    })

    await renderPage()

    const firstTime = container.querySelector<HTMLInputElement>('#automation-schedule-time-0')!
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

    await act(async () => {
      inputValueSetter?.call(firstTime, '12:45')
      firstTime.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(mocks.setMessage).toHaveBeenCalledWith('该执行时间已经存在', 'error')
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-0')?.value).toBe('08:30')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['08:30', '12:45'],
    })
  })

  it('keeps the hydrated task flow without reloading after Activity restore', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Activity mode={mode}>
              <AutomationTasks />
            </Activity>
          </QueryClientProvider>,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('理智作战')

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('理智作战')
  })

  it('prefers a pending local draft and never replaces it with a server copy', async () => {
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowFixture))
    localStorage.setItem('maa-schedule', JSON.stringify({ enabled: false, times: ['14:00'] }))
    localStorage.setItem('automationConfigSyncPending', 'pending-local-draft')

    await renderPage()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.textContent).toContain('理智作战')
    expect(JSON.parse(localStorage.getItem('maa-task-flow') || '[]')).toEqual(taskFlowFixture)
  })

  it('ignores an in-flight server response once a newer local draft exists', async () => {
    const serverLoad = deferred<{ success: boolean; data: { taskFlow: typeof taskFlowFixture } }>()
    mocks.loadUserConfig.mockReturnValueOnce(serverLoad.promise)
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Activity mode={mode}>
              <AutomationTasks />
            </Activity>
          </QueryClientProvider>,
        )
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowFixture))
    localStorage.setItem('automationConfigSyncPending', 'newer-local-draft')
    await act(async () => serverLoad.resolve({ success: true, data: { taskFlow: [] } }))
    await flush()

    expect(JSON.parse(localStorage.getItem('maa-task-flow') || '[]')).toEqual(taskFlowFixture)

    await renderMode('hidden')
    await renderMode('visible')
    expect(container.textContent).toContain('理智作战')
  })

  it('clears an interrupted connection-test loading state after Activity restore', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.testConnection.mockImplementation((_adbPath, _address, signal: AbortSignal) => (
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    ))
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Activity mode={mode}>
              <AutomationTasks />
            </Activity>
          </QueryClientProvider>,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    const testButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('测试连接'))
    expect(testButton).toBeDefined()
    await act(async () => testButton?.click())
    expect(container.textContent).toContain('正在检查')

    await renderMode('hidden')
    await renderMode('visible')

    const restoredButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('测试连接'))
    expect(container.textContent).not.toContain('正在检查')
    expect(restoredButton?.disabled).toBe(false)
  })

  it('scrolls the selected task editor into view on narrow screens', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()

    const selectedButton = await clickSequenceTask('理智作战')
    const editor = container.querySelector('#automation-task-editor')

    expect(selectedButton?.getAttribute('aria-controls')).toBe('automation-task-editor')
    expect(selectedButton?.getAttribute('aria-pressed')).toBe('true')
    expect(editor?.textContent).toContain('理智作战')
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('associates dynamic labels and names compact destructive controls', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: { enabled: true, times: ['08:30', '12:45'] },
      },
    })

    await renderPage()

    const clientTypeLabel = container.querySelector<HTMLLabelElement>('label[for="automation-startup-1-clientType"]')
    expect(clientTypeLabel?.textContent).toContain('客户端类型')
    expect(container.querySelector('#automation-startup-1-clientType')?.getAttribute('role')).toBe('combobox')
    const accountNameLabel = container.querySelector<HTMLLabelElement>('label[for="automation-startup-1-accountName"]')
    expect(accountNameLabel?.textContent).toContain('切换账号')

    expect(checkboxRowLabel('automation-startup-1-start_game_enabled')?.textContent)
      .toContain('启动游戏客户端')

    const taskDeleteButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="删除启动游戏"]')
    expect(taskDeleteButtons).toHaveLength(1)
    expect(container.querySelector('#automation-task-editor [aria-label="删除启动游戏"]')).toBeNull()

    const firstTimeInput = container.querySelector<HTMLInputElement>('#automation-schedule-time-0')
    expect(firstTimeInput?.value).toBe('08:30')
    expect(firstTimeInput?.getAttribute('aria-label')).toBe('第 1 个执行时间')
    expect(container.querySelector('[aria-label="08:30 启用"]')).not.toBeNull()

    const deleteTimeButton = container.querySelector<HTMLButtonElement>('[aria-label="删除 08:30"]')
    expect(deleteTimeButton).not.toBeNull()
    expect(findButton('新增时间')).toBeDefined()
    expect(container.querySelector('[aria-label="启用定时执行"]')).not.toBeNull()

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      inputValueSetter?.call(firstTimeInput, '09:15')
      firstTimeInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-0')?.value).toBe('09:15')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['09:15', '12:45'],
    })

    await act(async () => deleteTimeButton?.click())
    await flush()

    expect(container.querySelector('[aria-label="已设置 1 个执行时间"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-time-0')?.value).toBe('12:45')
    expect(container.querySelector('[aria-label="删除 12:45"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['12:45'],
    })

    await clickSequenceTask('理智作战')
    expect(container.querySelector('label[for="automation-fight-1-stages-0"]')?.textContent).toContain('关卡')
    expect(container.querySelector('[aria-label="关卡 2"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="关卡 2 执行次数"]')).not.toBeNull()
    expect(container.querySelector('label[for="automation-fight-1-medicineExpireDays"]')?.textContent)
      .toContain('临期药天数')

    const series = container.querySelector<HTMLElement>('#automation-fight-1-series')
    expect(await selectOptionLabels(series!)).toHaveLength(12)

    const stageLabel = container.querySelector<HTMLLabelElement>('label[for="automation-fight-1-stages-0"]')!
    const stageEditor = stageLabel.closest('fieldset')
    expect(stageEditor).not.toBeNull()
    expect(stageEditor?.textContent).toContain('添加关卡')
    expect(stageEditor?.textContent).toContain('智能养成关卡')

    await clickSequenceTask('自动公招')
    expect(checkboxRowLabel('automation-recruit-1-refresh')).not.toBeNull()
    expect(container.querySelector('fieldset legend')?.textContent).toContain('招募星级')
    expect(checkboxRowLabel('automation-recruit-1-level3_recruitment_permit_reserve')?.textContent)
      .toContain('3 星保留招聘许可')
    expect(container.querySelector('#recruit-1-extra-tags-mode')?.textContent)
      .toContain('默认行为')
  })

  // 整页 jsdom 用例在 4 worker 并行下争用 CPU，默认 5s 会被调度抖动击穿。
  it('moves every recruit helper into a label tooltip and keeps the card behaviours', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    await renderPage()
    await clickSequenceTask('自动公招')

    const hintCopies: Record<string, string> = {
      '无许可时仍刷新说明': '招聘许可耗尽后，仍会使用可用刷新次数',
      '招募星级说明': '支持 6 星自动公招；勾选 6 星后会保留高价值标签并自动选择对应组合',
      '确认星级说明': '建议至少保留 5/6 星确认，避免高价值标签被跳过；不勾选任何星级时只计算标签，不会确认招募',
      '招募次数说明': '设为 0 时只计算标签，不执行招募',
      '保留标签说明': '识别到任一标签时保留该公招槽位，多个标签用逗号分隔',
      '3 星保留招聘许可说明': '自动确认 3 星时保留的招聘许可数量；剩余许可小于等于该值时跳过 3 星招募，0 表示不保留',
      '多选 Tag 策略说明': '默认行为只选能组成有效组合的 Tag；“选 3 个 Tags”会尽量凑满 3 个；“尽量多选高星 Tag 组合”优先保留高星组合，可能包含冲突标签。',
      '三星首选说明': '仅在三星组合中优先选择，多个标签用逗号分隔。',
      '招募时长说明': '可设置 60 至 540 分钟，按 10 分钟调整；五星和六星固定为 540 分钟。',
    }

    for (const [accessibilityName, copy] of Object.entries(hintCopies)) {
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${accessibilityName}"]`)
      expect(trigger, accessibilityName).not.toBeNull()
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()
      expect(container.textContent).not.toContain(copy)
    }

    // 常驻说明段落已删除，文案只存在于按需挂载的 tooltip 里。
    const timesHintTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="招募次数说明"]')!
    await act(async () => timesHintTrigger.focus())
    const timesTooltipId = timesHintTrigger.getAttribute('aria-describedby')
    const timesTooltip = timesTooltipId ? document.getElementById(timesTooltipId) : null
    expect(timesTooltip?.getAttribute('role')).toBe('tooltip')
    expect(timesTooltip?.textContent).toBe(hintCopies['招募次数说明'])
    await act(async () => timesHintTrigger.blur())
    expect(timesHintTrigger.getAttribute('aria-describedby')).toBeNull()

    const savedRecruitParams = () => {
      const flow = JSON.parse(localStorage.getItem('maa-task-flow') || '[]') as Array<{
        id: string
        params: Record<string, unknown>
      }>
      return flow.find(task => task.id === 'recruit-1')?.params ?? {}
    }

    const details = container.querySelector('details')!
    const summary = details.querySelector('summary')!
    expect(details.open).toBe(false)
    await act(async () => summary.click())
    await flush()
    expect(details.open).toBe(true)

    const extraTagsMode = container.querySelector<HTMLElement>('#recruit-1-extra-tags-mode')!
    await act(async () => extraTagsMode.click())
    const modeOption = [...document.getElementById(extraTagsMode.getAttribute('aria-controls')!)?.querySelectorAll('[role="option"]') ?? []]
      .find(node => node.textContent?.trim() === '尽量多选高星 Tag 组合')
    expect(modeOption, '尽量多选高星 Tag 组合 option').toBeTruthy()
    await act(async () => (modeOption as HTMLElement | null)?.click())
    await flush()
    expect(savedRecruitParams().extra_tags_mode).toBe(2)

    const firstTags = container.querySelector<HTMLInputElement>('#recruit-1-first-tags')!
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      inputValueSetter?.call(firstTags, '近卫干员')
      firstTags.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(savedRecruitParams().first_tags).toBe('近卫干员')

    await act(async () => summary.click())
    expect(details.open).toBe(false)

    const setTime = container.querySelector<HTMLInputElement>('#automation-recruit-1-set_time')!
    await act(async () => setTime.click())
    await flush()
    expect(savedRecruitParams().set_time).toBe(false)

    const sixStar = container.querySelector<HTMLInputElement>('#automation-recruit-1-select-6')!
    await act(async () => sixStar.click())
    await flush()
    expect(savedRecruitParams().select).toEqual([4, 5])
    await act(async () => sixStar.click())
    await flush()
    expect(savedRecruitParams().select).toEqual([4, 5, 6])

    const threeStarConfirm = container.querySelector<HTMLInputElement>('#automation-recruit-1-confirm-3')!
    await act(async () => threeStarConfirm.click())
    await flush()
    expect(savedRecruitParams().confirm).toEqual([4])

    expect(container.querySelector<HTMLInputElement>('#automation-recruit-1-times')?.value).toBe('4')
    const increaseTimes = container.querySelector<HTMLButtonElement>('button[aria-label="增加招募次数"]')
    expect(increaseTimes).not.toBeNull()
    await act(async () => increaseTimes?.click())
    await flush()
    expect(savedRecruitParams().times).toBe('5')

    const increasePermitReserve = container.querySelector<HTMLButtonElement>('button[aria-label="增加3 星保留招聘许可"]')
    expect(increasePermitReserve).not.toBeNull()
    await act(async () => increasePermitReserve?.click())
    await flush()
    expect(savedRecruitParams().level3_recruitment_permit_reserve).toBe('1')
  }, 20_000)

  it('moves the startup helper texts into focusable tooltips', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()

    const accountHint = container.querySelector<HTMLButtonElement>('button[aria-label="切换账号说明"]')
    const launchHint = container.querySelector<HTMLButtonElement>('button[aria-label="启动游戏客户端说明"]')
    expect(accountHint).not.toBeNull()
    expect(launchHint).not.toBeNull()
    expect(accountHint!.getAttribute('aria-describedby')).toBeNull()
    expect(launchHint!.getAttribute('aria-describedby')).toBeNull()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    await act(async () => accountHint!.focus())
    const accountTooltipId = accountHint!.getAttribute('aria-describedby')
    const accountTooltip = accountTooltipId ? document.getElementById(accountTooltipId) : null
    expect(accountTooltip?.getAttribute('role')).toBe('tooltip')
    expect(accountTooltip?.textContent)
      .toBe('输入已登录账号的部分字符即可，如 "123****4567" 可输入 "4567"')
    await act(async () => accountHint!.blur())
    expect(accountHint!.getAttribute('aria-describedby')).toBeNull()

    await act(async () => launchHint!.focus())
    const launchTooltipId = launchHint!.getAttribute('aria-describedby')
    const launchTooltip = launchTooltipId ? document.getElementById(launchTooltipId) : null
    expect(launchTooltip?.getAttribute('role')).toBe('tooltip')
    expect(launchTooltip?.textContent)
      .toBe('关闭后只连接设备并进入已有游戏的主界面，不会启动游戏客户端')
    await act(async () => launchHint!.blur())
    expect(launchHint!.getAttribute('aria-describedby')).toBeNull()

    // 常驻说明段落已删除，说明文字只存在于按需挂载的 tooltip 里。
    expect(container.textContent).not.toContain('输入已登录账号的部分字符即可')
    expect(container.textContent).not.toContain('关闭后只连接设备并进入已有游戏的主界面')
  })

  it('moves every fight helper text into focusable tooltips', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()
    await clickSequenceTask('理智作战')

    const expectedHints: Array<[string, string]> = [
      ['关卡计划说明', '使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限（连战中的每一局都计 1），留空表示不限制局数'],
      ['掉落目标说明', '任一物品达到目标数量后停止；格式为物品 ID=数量，多个目标用逗号分隔'],
      ['理智药说明', '使用理智药数量'],
      ['临期药天数说明', '使用将在指定天数内过期的理智药；0 表示不使用临期药'],
      ['源石说明', '使用源石数量'],
      ['连战说明', '本任务所有关卡共用的连战倍率，范围 -1 至 10（旧资源只支持 -1 至 6）；与各关卡次数同时生效：固定倍率时次数少于倍率不会开始任何一局（0 局）；指定倍率不能整除剩余次数时最后一轮连战不会开始，实际局数会少于次数；选“自动”会按剩余次数调整'],
      ['闪退重启说明', '选择客户端后，游戏闪退时会自动重新启动。'],
      ['葛朗台碎石模式说明', '使用源石前等待自然恢复 1 点理智，尽量减少碎石浪费。'],
    ]

    for (const [accessibilityName, copy] of expectedHints) {
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${accessibilityName}"]`)
      expect(trigger).not.toBeNull()
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()
      expect(container.textContent).not.toContain(copy)

      await act(async () => trigger!.focus())
      const tooltipId = trigger!.getAttribute('aria-describedby')
      const tooltip = tooltipId ? document.getElementById(tooltipId) : null
      expect(tooltip?.getAttribute('role')).toBe('tooltip')
      expect(tooltip?.textContent).toBe(copy)
      await act(async () => trigger!.blur())
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()
    }

    // 区块级提示挂在「关卡计划」标题行内、关卡数量徽标右侧。
    const stageTitle = container.querySelector('.automation-stage-editor-title')
    const stageHint = stageTitle?.querySelector<HTMLButtonElement>('button[aria-label="关卡计划说明"]')
    expect(stageTitle?.textContent).toContain('关卡计划')
    expect(stageTitle?.textContent).toContain('2 个关卡')
    expect(stageHint?.previousElementSibling?.tagName).toBe('SPAN')
    expect(stageHint?.previousElementSibling?.textContent).toBe('2 个关卡')

    // 说明段落不再常驻页面。
    const helperParagraphs = Array.from(container.querySelectorAll('p')).map(paragraph => paragraph.textContent)
    for (const [, copy] of expectedHints) expect(helperParagraphs).not.toContain(copy)
  })

  it('offers task removal from the flow list only', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()

    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="删除启动游戏"]')
    expect(deleteButton).not.toBeNull()
    expect(deleteButton?.closest('#automation-task-editor')).toBeNull()
    expect(container.querySelector('#automation-task-editor [aria-label="删除启动游戏"]')).toBeNull()

    await act(async () => deleteButton?.click())
    await flush()

    expect(savedFlowIds()).toEqual(['fight-1', 'recruit-1'])
    expect(container.querySelectorAll('[aria-controls="automation-task-editor"]')).toHaveLength(2)
    expect(container.textContent).toContain('已删除“启动游戏”')

    await act(async () => findButton('恢复')?.click())
    await flush()

    expect(savedFlowIds()).toEqual(['startup-1', 'fight-1', 'recruit-1'])
    expect(container.querySelectorAll('[aria-controls="automation-task-editor"]')).toHaveLength(3)
    expect(container.textContent).not.toContain('已删除“启动游戏”')
    expect(container.querySelector('#automation-task-editor')?.textContent).toContain('启动游戏')
    expect(container.querySelector('#automation-task-editor [aria-label="删除启动游戏"]')).toBeNull()
  })

  it('moves the mall helper texts into label tooltips without leaving helper paragraphs', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: [
          {
            id: 'mall-1',
            commandId: 'mall',
            name: '信用收支',
            description: '访问好友、收取信用',
            taskType: 'Mall',
            enabled: true,
            params: {
              visit_friends: true,
              shopping: true,
              buy_first: '',
              blacklist: '',
              force_shopping_if_credit_full: false,
              only_buy_discount: false,
              reserve_max_credit: false,
              credit_fight: false,
              formation_index: 0,
            },
          },
        ],
      },
    })

    await renderPage()
    await clickSequenceTask('信用收支')

    const savedFlow = () => JSON.parse(localStorage.getItem('maa-task-flow') || '[]') as Array<{
      id: string
      params: Record<string, unknown>
    }>
    const checkboxOf = (key: string) => container.querySelector<HTMLInputElement>(`#automation-mall-1-${key}`)!

    const hints: Array<[string, string]> = [
      ['只买折扣商品', '仅影响优先购买之外的普通购物'],
      ['保留 300 信用', '普通购物时信用低于 300 就停止购买'],
      ['信用助战', '借助战完成一次 OF-1，以便次日获得更多信用'],
    ]
    for (const [label, copy] of hints) {
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}说明"]`)
      expect(trigger).not.toBeNull()
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()

      // 常驻说明段落已删除，说明文字只存在于按需挂载的 tooltip 里。
      expect(container.textContent).not.toContain(copy)
    }
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    const discountHint = container.querySelector<HTMLButtonElement>('button[aria-label="只买折扣商品说明"]')!
    await act(async () => discountHint.focus())
    const discountTooltipId = discountHint.getAttribute('aria-describedby')
    const discountTooltip = discountTooltipId ? document.getElementById(discountTooltipId) : null
    expect(discountTooltip?.getAttribute('role')).toBe('tooltip')
    expect(discountTooltip?.textContent).toBe(hints[0]![1])
    await act(async () => discountHint.blur())
    expect(discountHint.getAttribute('aria-describedby')).toBeNull()

    // 本来就没有说明文案的开关不会出现孤立图标。
    expect(container.querySelector('button[aria-label="信用溢出时无视黑名单说明"]')).toBeNull()

    // 默认值与输入框 placeholder 不变。
    expect(checkboxOf('visit_friends').checked).toBe(true)
    expect(checkboxOf('shopping').checked).toBe(true)
    expect(checkboxOf('only_buy_discount').checked).toBe(false)
    expect(checkboxOf('reserve_max_credit').checked).toBe(false)
    expect(checkboxOf('force_shopping_if_credit_full').checked).toBe(false)
    expect(checkboxOf('credit_fight').checked).toBe(false)
    expect(container.querySelector<HTMLInputElement>('#automation-mall-1-buy_first')?.placeholder)
      .toBe('招聘许可,龙门币（逗号分隔）')
    expect(container.querySelector<HTMLInputElement>('#automation-mall-1-blacklist')?.placeholder)
      .toBe('家具零件,碳（逗号分隔）')

    // 勾选与输入仍写入草稿；信用助战开启后出现助战编队。
    await act(async () => checkboxOf('only_buy_discount').click())
    await flush()
    expect(checkboxOf('only_buy_discount').checked).toBe(true)
    expect(savedFlow().find(task => task.id === 'mall-1')?.params.only_buy_discount).toBe(true)

    const buyFirst = container.querySelector<HTMLInputElement>('#automation-mall-1-buy_first')!
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      inputValueSetter?.call(buyFirst, '招聘许可')
      buyFirst.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(savedFlow().find(task => task.id === 'mall-1')?.params.buy_first).toBe('招聘许可')

    await act(async () => checkboxOf('credit_fight').click())
    await flush()
    expect(checkboxOf('credit_fight').checked).toBe(true)
    expect(container.querySelector('#automation-mall-1-formation_index')).not.toBeNull()
    expect(savedFlow().find(task => task.id === 'mall-1')?.params.credit_fight).toBe(true)

    // 关掉自动购物后依赖字段仍按原逻辑隐藏。
    await act(async () => checkboxOf('shopping').click())
    await flush()
    expect(checkboxOf('shopping').checked).toBe(false)
    expect(container.querySelector('#automation-mall-1-only_buy_discount')).toBeNull()
    expect(container.querySelector('#automation-mall-1-reserve_max_credit')).toBeNull()
    expect(container.querySelector('#automation-mall-1-credit_fight')).not.toBeNull()
    expect(savedFlow().find(task => task.id === 'mall-1')?.params.shopping).toBe(false)
  })

  it('moves the award helper texts into focusable tooltips', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: [
          {
            id: 'award-1',
            commandId: 'award',
            name: '领取奖励',
            description: '领取每日/每周奖励',
            taskType: 'Award',
            enabled: true,
            params: {
              award: true,
              mail: true,
              recruit: false,
              orundum: false,
              mining: false,
              specialaccess: false,
              signinevent: true,
            },
          },
        ],
      },
    })

    await renderPage()

    const awardHints = [
      ['限定池免费单抽', '活动期间领取限定池赠送的每日免费单抽；没有免费次数时不抽取'],
      ['周年赠送月卡', '领取周年活动赠送的月卡奖励'],
      ['限时签到活动奖励', '领取限时签到活动的每日奖励（仅支持常见横向版型）'],
    ] as const

    for (const [label, copy] of awardHints) {
      const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}说明"]`)
      expect(trigger).not.toBeNull()
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()

      await act(async () => trigger!.focus())
      const tooltipId = trigger!.getAttribute('aria-describedby')
      const tooltip = tooltipId ? document.getElementById(tooltipId) : null
      expect(tooltip?.getAttribute('role')).toBe('tooltip')
      expect(tooltip?.textContent).toBe(copy)
      await act(async () => trigger!.blur())
      expect(trigger!.getAttribute('aria-describedby')).toBeNull()
    }

    // 常驻说明段落已删除：编辑器内不再有承载这段文字的段落。
    const editor = container.querySelector('#automation-task-editor')
    expect(editor?.textContent).not.toContain('活动期间领取限定池赠送的每日免费单抽')
    expect(editor?.textContent).not.toContain('领取周年活动赠送的月卡奖励')
    expect(editor?.textContent).not.toContain('领取限时签到活动的每日奖励')
    expect(editor?.querySelectorAll('p')).toHaveLength(0)

    // 领取开关的加载状态、键名与顺序保持原样。
    const switchOf = (key: string) => container.querySelector<HTMLInputElement>(`#automation-award-1-${key}`)
    expect(switchOf('award')?.checked).toBe(true)
    expect(switchOf('mail')?.checked).toBe(true)
    expect(switchOf('recruit')?.checked).toBe(false)
    expect(switchOf('orundum')?.checked).toBe(false)
    expect(switchOf('mining')?.checked).toBe(false)
    expect(switchOf('specialaccess')?.checked).toBe(false)
    expect(switchOf('signinevent')?.checked).toBe(true)

    await act(async () => switchOf('recruit')?.click())
    await flush()

    const savedAward = (
      JSON.parse(localStorage.getItem('maa-task-flow') || '[]') as Array<{
        id: string
        params: Record<string, boolean>
      }>
    ).find(task => task.id === 'award-1')
    expect(Object.keys(savedAward?.params ?? {})).toEqual([
      'award',
      'mail',
      'recruit',
      'orundum',
      'mining',
      'specialaccess',
      'signinevent',
    ])
    expect(savedAward?.params.recruit).toBe(true)
    expect(savedAward?.params.award).toBe(true)
    expect(savedAward?.params.signinevent).toBe(true)
  })

  it('normalizes the recruitment duration when the field loses focus', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()
    await clickSequenceTask('自动公招')

    const recruitmentTime = container.querySelector<HTMLInputElement>('#recruit-1-recruitment-time-3')!
    expect(recruitmentTime.value).toBe('540')
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

    recruitmentTime.focus()
    await act(async () => {
      inputValueSetter?.call(recruitmentTime, '333')
      recruitmentTime.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => recruitmentTime.blur())
    await flush()

    expect(container.querySelector<HTMLInputElement>('#recruit-1-recruitment-time-3')?.value).toBe('330')
    const savedFlow = JSON.parse(localStorage.getItem('maa-task-flow') || '[]') as Array<{
      id: string
      params: { recruitment_time: Record<string, number> }
    }>
    expect(savedFlow.find(task => task.id === 'recruit-1')?.params.recruitment_time['3']).toBe(330)
  })

  it('commits a pointer drag even when the browser releases pointer capture', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    await renderPage()
    stubSequenceRects()

    const handle = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')[0]!
    await act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientY: 0, pointerId: 7 }))
    })
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', { clientY: 260, pointerId: 7 }))
    })

    expect(sequenceOrder()).toEqual(['理智作战', '自动公招', '启动游戏'])
    expect(savedFlowIds()).toEqual(['startup-1', 'fight-1', 'recruit-1'])

    // 性能基线记录的真实路径：重排后浏览器释放 capture，排序不能因此取消。
    await act(async () => {
      handle.dispatchEvent(new Event('lostpointercapture', { bubbles: true }))
    })
    expect(sequenceOrder()).toEqual(['理智作战', '自动公招', '启动游戏'])

    await act(async () => {
      document.dispatchEvent(pointerEvent('pointerup', { clientY: 260, pointerId: 7 }))
    })
    await flush()

    expect(sequenceOrder()).toEqual(['理智作战', '自动公招', '启动游戏'])
    expect(savedFlowIds()).toEqual(['fight-1', 'recruit-1', 'startup-1'])
    expect(container.querySelector('[aria-live="polite"]')?.textContent)
      .toBe('启动游戏已移动到第 3 位')
  })

  it('cancels a pointer sort with Escape and keeps the committed order', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    await renderPage()
    stubSequenceRects()
    const committedBefore = localStorage.getItem('maa-task-flow')

    const handle = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')[0]!
    await act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientY: 0, pointerId: 9 }))
    })
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', { clientY: 260, pointerId: 9 }))
    })
    expect(sequenceOrder()).toEqual(['理智作战', '自动公招', '启动游戏'])

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(sequenceOrder()).toEqual(['启动游戏', '理智作战', '自动公招'])
    expect(localStorage.getItem('maa-task-flow')).toBe(committedBefore)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('已取消排序')
  })

  it('restores the committed order when the pointer is cancelled', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    await renderPage()
    stubSequenceRects()
    const committedBefore = localStorage.getItem('maa-task-flow')

    const handle = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')[0]!
    await act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientY: 0, pointerId: 11 }))
    })
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', { clientY: 260, pointerId: 11 }))
    })
    expect(sequenceOrder()).toEqual(['理智作战', '自动公招', '启动游戏'])

    await act(async () => {
      document.dispatchEvent(pointerEvent('pointercancel', { clientY: 260, pointerId: 11 }))
    })
    await flush()

    expect(sequenceOrder()).toEqual(['启动游戏', '理智作战', '自动公招'])
    expect(localStorage.getItem('maa-task-flow')).toBe(committedBefore)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('已取消排序')
  })

  it('moves tasks with the keyboard handle and announces the new position', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    await renderPage()

    const handle = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')[0]!
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await flush()

    expect(sequenceOrder()).toEqual(['理智作战', '启动游戏', '自动公招'])
    expect(savedFlowIds()).toEqual(['fight-1', 'startup-1', 'recruit-1'])
    expect(container.querySelector('[aria-live="polite"]')?.textContent)
      .toBe('启动游戏已移动到第 2 位')
  })

  it('keeps stage creation and deletion inside one grouped list', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await renderPage()
    await clickSequenceTask('理智作战')

    const stageEditor = findStageEditor()
    expect(stageEditor).toBeDefined()
    expect(stageEditor?.querySelector('[aria-label="关卡 2"]')).not.toBeNull()
    expect(stageEditor?.querySelector('[aria-label="关卡 3"]')).toBeNull()

    await act(async () => {
      findButton('添加关卡')?.click()
    })
    await flush()

    expect(stageEditor?.querySelector('[aria-label="关卡 3"]')).not.toBeNull()

    await act(async () => {
      stageEditor?.querySelector<HTMLButtonElement>('[aria-label="删除关卡 3"]')?.click()
    })
    await flush()

    expect(stageEditor?.querySelector('[aria-label="关卡 3"]')).toBeNull()
    expect(stageEditor?.querySelector('[aria-label="关卡 2"]')).not.toBeNull()
  })

  it('adds and removes the generated smart training stages from the dedicated entry', async () => {
    mocks.loadUserConfig
      .mockResolvedValueOnce({ success: true, data: { taskFlow: taskFlowFixture } })
      .mockResolvedValueOnce({
        success: true,
        data: { queue: [{ name: '阿米娅' }] },
      })
    mocks.generateTrainingPlan.mockResolvedValue({
      success: true,
      data: {
        operators: [{ name: '阿米娅' }],
        stages: [{ stage: 'AP-5', totalTimes: 3 }],
      },
    })

    await renderPage()
    await clickSequenceTask('理智作战')

    const addSmartStages = container.querySelector<HTMLButtonElement>('[aria-label="加入智能养成关卡"]')!
    await act(async () => {
      addSmartStages.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flush()

    const stageEditor = findStageEditor()!
    expect(stageEditor.querySelector('[aria-label="移除智能养成关卡"]')).not.toBeNull()
    expect(stageEditor.textContent).toContain('正在养成：阿米娅')
    const smartStageInput = Array.from(stageEditor.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === 'AP-5')
    expect(smartStageInput).toBeDefined()
    expect(mocks.generateTrainingPlan).toHaveBeenCalledWith({ mode: 'current' })

    const removeSmartStages = stageEditor.querySelector<HTMLButtonElement>('[aria-label="移除智能养成关卡"]')!
    await act(async () => removeSmartStages.click())
    await flush()

    expect(stageEditor.textContent).not.toContain('正在养成：阿米娅')
    expect(stageEditor.querySelector('[aria-label="加入智能养成关卡"]')).not.toBeNull()
  })

  it('exposes the add-task picker as a labelled menu', async () => {
    await renderPage()

    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    expect(trigger.textContent).toContain('添加任务')
    expect(trigger.getAttribute('aria-controls')).toBe('automation-task-picker')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => trigger.click())

    const menu = container.querySelector<HTMLElement>('#automation-task-picker')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.getAttribute('aria-label')).toBe('可添加任务')
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0)
  })

  it('closes the add-task picker with Escape and restores trigger focus', async () => {
    await renderPage()

    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await act(async () => trigger.click())
    const firstMenuItem = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    firstMenuItem.focus()
    expect(document.activeElement).toBe(firstMenuItem)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps an open task picker across Activity restore and re-registers its keyboard close', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Activity mode={mode}>
              <AutomationTasks />
            </Activity>
          </QueryClientProvider>,
        )
      })
      await flush()
    }

    await renderMode('visible')
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await act(async () => trigger.click())
    expect(container.querySelector('[role="menu"]')).not.toBeNull()

    await renderMode('hidden')
    await renderMode('visible')

    expect(container.querySelector('#automation-task-picker')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(container.querySelector('#automation-task-picker')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('offers the new infrast facilities and the award sign-in switch', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: [
          {
            id: 'infrast-1',
            commandId: 'infrast',
            name: '基建换班',
            description: '自动基建换班收菜',
            taskType: 'Infrast',
            enabled: true,
            params: { mode: '0', facility: ['Mfg', 'Recycle', 'AssistantChange'] },
          },
          {
            id: 'award-1',
            commandId: 'award',
            name: '领取奖励',
            description: '领取每日/每周奖励',
            taskType: 'Award',
            enabled: true,
            params: { award: true, signinevent: true },
          },
        ],
      },
    })

    await renderPage()

    await clickSequenceTask('基建换班')
    expect(container.querySelector('#automation-infrast-1-facility-Recycle')).not.toBeNull()
    expect(container.querySelector('#automation-infrast-1-facility-AssistantChange')).not.toBeNull()

    await clickSequenceTask('领取奖励')
    expect(checkboxRowLabel('automation-award-1-signinevent')?.textContent)
      .toContain('限时签到活动奖励')
  })

  it('shows the infrast shift-mode hint in a label tooltip and drops the facility helper line', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: [
          {
            id: 'infrast-1',
            commandId: 'infrast',
            name: '基建换班',
            description: '自动基建换班收菜',
            taskType: 'Infrast',
            enabled: true,
            params: { mode: '0', facility: ['Mfg', 'Recycle', 'AssistantChange'] },
          },
        ],
      },
    })

    await renderPage()
    await clickSequenceTask('基建换班')

    expect(container.querySelector('label[for="automation-infrast-1-mode"]')?.textContent).toBe('换班模式')
    const modeSelect = container.querySelector<HTMLElement>('#automation-infrast-1-mode')
    expect(await selectOptionLabels(modeSelect!)).toEqual([
      '默认换班',
      '自定义换班',
      '一键轮换',
    ])

    const shiftModeHint = container.querySelector<HTMLButtonElement>('button[aria-label="换班模式说明"]')
    expect(shiftModeHint).not.toBeNull()
    expect(shiftModeHint!.getAttribute('aria-describedby')).toBeNull()
    expect(container.textContent).not.toContain('一键轮换使用游戏内队列')

    await act(async () => shiftModeHint!.focus())
    const shiftModeTooltipId = shiftModeHint!.getAttribute('aria-describedby')
    const shiftModeTooltip = shiftModeTooltipId ? document.getElementById(shiftModeTooltipId) : null
    expect(shiftModeTooltip?.getAttribute('role')).toBe('tooltip')
    expect(shiftModeTooltip?.textContent).toBe('一键轮换使用游戏内队列，并保留无人机、会客室等基础操作')
    await act(async () => shiftModeHint!.blur())
    expect(shiftModeHint!.getAttribute('aria-describedby')).toBeNull()

    // 常驻说明段落已删除，说明文字只存在于按需挂载的 tooltip 里。
    expect(container.textContent).not.toContain('选择要换班的设施')

    const facilityLegend = Array.from(container.querySelectorAll('legend'))
      .find(legend => legend.textContent === '设施选择')
    expect(facilityLegend).toBeDefined()
    const facilityFieldset = facilityLegend!.closest('fieldset')!
    expect(facilityFieldset.querySelector('p')).toBeNull()

    const facilityInputs = Array.from(facilityFieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const facilityIds = facilityInputs.map(input => input.id.replace('automation-infrast-1-facility-', ''))
    expect(facilityIds).toEqual([
      'Mfg',
      'Trade',
      'Power',
      'Control',
      'Reception',
      'Office',
      'Recycle',
      'Dorm',
      'Processing',
      'Training',
      'AssistantChange',
    ])
    expect(facilityFieldset.textContent).toContain('副手换人')
    expect(facilityInputs.filter(input => input.checked).map(input => input.id))
      .toEqual([
        'automation-infrast-1-facility-Mfg',
        'automation-infrast-1-facility-Recycle',
        'automation-infrast-1-facility-AssistantChange',
      ])
  })

  it('closes the add-task picker when pressing outside its region', async () => {
    await renderPage()

    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await act(async () => trigger.click())
    expect(container.querySelector('[role="menu"]')).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })

    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
