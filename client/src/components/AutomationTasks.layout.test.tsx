// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationTasks from './AutomationTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  executeScheduleNow: vi.fn(),
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
  stopTask: vi.fn(),
  testConnection: vi.fn(),
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

vi.mock('../services/api', () => ({
  generateTrainingPlan: mocks.generateTrainingPlan,
  maaApi: {
    executeScheduleNow: mocks.executeScheduleNow,
    getActivity: mocks.getActivity,
    getErrorMessage: () => '未知错误',
    getScheduleExecutionStatus: mocks.getScheduleExecutionStatus,
    getTaskStatus: mocks.getTaskStatus,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
    setupSchedule: mocks.setupSchedule,
    stopSchedule: mocks.stopSchedule,
    stopTask: mocks.stopTask,
    testConnection: mocks.testConnection,
  },
}))

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({ setMessage: mocks.setMessage, setActive: mocks.setActive }),
}))

vi.mock('../hooks/useBackendStatusMonitor', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./NotificationSettings', () => ({ default: () => <div data-testid="notification-settings" /> }))
vi.mock('./ScreenMonitor', () => ({
  default: ({ variant }: { variant?: 'full' | 'compact' }) => (
    <div data-testid="screen-monitor" data-variant={variant || 'full'} />
  ),
}))

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement
let root: Root
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
      expiringMedicine: 0,
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
    await Promise.resolve()
    await Promise.resolve()
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const buttonsByText = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .filter(button => button.textContent?.includes(text))

const pointerEvent = (
  type: string,
  { pointerId, clientX = 0, clientY = 0, pointerType = 'mouse' }: {
    pointerId: number
    clientX?: number
    clientY?: number
    pointerType?: string
  },
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

const clickSequenceTask = async (taskName: string) => {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.automation-sequence-select'))
    .find(candidate => candidate.textContent?.includes(taskName))

  expect(button).toBeDefined()
  await act(async () => button?.click())
  await flush()
  return button
}

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
    mocks.executeScheduleNow.mockReset().mockResolvedValue({ success: true })
    mocks.getActivity.mockReset().mockResolvedValue({ success: false })
    mocks.getScheduleExecutionStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.stopTask.mockReset().mockResolvedValue({ success: true, data: { task: { success: true }, scheduleStopped: true } })
    mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: false })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: true, data: { taskFlow: [] } })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.stopSchedule.mockReset().mockResolvedValue({ success: true })
    mocks.testConnection.mockReset().mockResolvedValue({ success: true, data: { success: true, message: '连接正常' } })
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
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })

  it('uses continuous corners only for the four primary workspace panels', async () => {
    await act(async () => root.render(<AutomationTasks />))
    await flush()

    const page = container.querySelector('[data-automation-tasks]')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)
    expect(page?.querySelector('[data-testid="screen-monitor"]')?.getAttribute('data-variant')).toBe('compact')

    const workspace = page?.querySelector('.automation-workspace-grid')
    expect(workspace).not.toBeNull()
    const workspaceOrder = Array.from(workspace?.children || []).map(child => {
      if (child.classList.contains('automation-sequence-column')) return 'sequence'
      if (child.classList.contains('automation-editor-column')) return 'editor'
      if (child.classList.contains('automation-support-column')) return 'support'
      return 'unknown'
    })
    expect(workspaceOrder).toEqual(['sequence', 'editor', 'support'])
    const supportOrder = Array.from(workspace?.querySelector('.automation-support-column')?.children || []).map(child => {
      if (child.classList.contains('automation-monitor-column')) return 'monitor'
      if (child.classList.contains('automation-schedule-column')) return 'schedule'
      return 'unknown'
    })
    expect(supportOrder).toEqual(['monitor', 'schedule'])
    expect(page?.querySelector('.automation-monitor-surface .task-monitor-panel.is-compact')).not.toBeNull()

    const panelClasses = [
      'automation-monitor-panel',
      'automation-schedule-panel',
      'automation-sequence-panel',
      'automation-editor-panel',
    ]
    panelClasses.forEach((panelClass) => {
      const panel = page?.querySelector(`.${panelClass}`)
      expect(panel?.getAttribute('data-smooth-corners')).toBe('true')
      expect(panel?.querySelector(':scope > .smooth-panel-surface')).not.toBeNull()
    })

    expect(page?.querySelectorAll('.smooth-panel-shell')).toHaveLength(panelClasses.length)
  })

  it('hydrates an enabled schedule without rebuilding the server schedule', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: { enabled: true, times: ['08:00'] },
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()

    expect(container.querySelector('[aria-label="定时执行"]')?.getAttribute('aria-checked')).toBe('true')
    expect(mocks.setupSchedule).not.toHaveBeenCalled()
    expect(mocks.stopSchedule).not.toHaveBeenCalled()
  })

  it('keeps the hydrated task flow without reloading after Activity restore', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <AutomationTasks />
          </Activity>,
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

    await act(async () => root.render(<AutomationTasks />))
    await flush()

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
          <Activity mode={mode}>
            <AutomationTasks />
          </Activity>,
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
          <Activity mode={mode}>
            <AutomationTasks />
          </Activity>,
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

    await act(async () => root.render(<AutomationTasks />))
    await flush()

    const selectedButton = await clickSequenceTask('理智作战')
    const editor = container.querySelector('#automation-task-editor')

    expect(selectedButton?.getAttribute('aria-controls')).toBe('automation-task-editor')
    expect(selectedButton?.getAttribute('aria-pressed')).toBe('true')
    expect(editor?.textContent).toContain('理智作战')
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('keeps the editing selection distinct from the running workflow step', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.getScheduleExecutionStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        currentTaskId: 'fight-1',
        currentTask: '理智作战',
        message: '正在执行: 理智作战',
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await flush()

    const selectedButton = await clickSequenceTask('自动公招')
    const runningButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.automation-sequence-select'))
      .find(button => button.textContent?.includes('理智作战'))
    const selectedItem = selectedButton?.closest('.automation-sequence-item')
    const runningItem = runningButton?.closest('.automation-sequence-item')

    expect(selectedButton?.getAttribute('aria-pressed')).toBe('true')
    expect(selectedButton?.hasAttribute('aria-current')).toBe(false)
    expect(selectedItem?.getAttribute('data-selected')).toBe('true')
    expect(selectedItem?.getAttribute('data-execution-state')).toBe('idle')
    expect(selectedItem?.classList.contains('is-current')).toBe(false)

    expect(runningButton?.getAttribute('aria-pressed')).toBe('false')
    expect(runningButton?.getAttribute('aria-current')).toBe('step')
    expect(runningItem?.getAttribute('data-selected')).toBe('false')
    expect(runningItem?.getAttribute('data-execution-state')).toBe('running')
    expect(runningItem?.classList.contains('is-selected')).toBe(false)
    expect(runningItem?.querySelector('.automation-sequence-progress')).not.toBeNull()
    expect(runningItem?.textContent).toContain('正在执行')
  })

  it('preserves editing selection when the selected task is also running', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.getScheduleExecutionStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        currentTaskId: 'startup-1',
        currentTask: '启动游戏',
        message: '正在执行: 启动游戏',
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await flush()

    const runningButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.automation-sequence-select'))
      .find(button => button.textContent?.includes('启动游戏'))
    const runningItem = runningButton?.closest('.automation-sequence-item')

    expect(runningButton?.getAttribute('aria-pressed')).toBe('true')
    expect(runningButton?.getAttribute('aria-current')).toBe('step')
    expect(runningItem?.classList.contains('is-selected')).toBe(true)
    expect(runningItem?.classList.contains('is-current')).toBe(true)
    expect(runningItem?.getAttribute('data-selected')).toBe('true')
    expect(runningItem?.getAttribute('data-execution-state')).toBe('running')
    expect(runningItem?.querySelector('.automation-sequence-progress')).not.toBeNull()
    expect(runningItem?.textContent).toContain('正在执行')
  })

  it('shows server step progress and elapsed time while the flow is running', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.getScheduleExecutionStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        currentTaskId: 'fight-1',
        currentTask: '理智作战',
        currentStep: 1,
        totalSteps: 4,
        startTime: Date.now() - 65_000,
        message: '正在执行: 理智作战 (2/4)',
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await flush()

    const progress = container.querySelector('.automation-flow-progress')
    expect(progress?.textContent).toContain('执行中')
    expect(progress?.textContent).toContain('第 2/4 步')
    expect(progress?.textContent).toMatch(/已用时 \d{2}:\d{2}/)
    expect(container.querySelector('.automation-flow-summary')?.textContent).toBe('2/4')
  })

  it('maps the server enabled-task step onto the visible task flow', async () => {
    const flowWithDisabledTask = taskFlowFixture.map(task => (
      task.id === 'fight-1' ? { ...task, enabled: false } : task
    ))
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: flowWithDisabledTask } })
    mocks.getScheduleExecutionStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        currentStep: 1,
        totalSteps: 2,
        currentTask: '自动公招',
        message: '正在执行: 自动公招 (2/2)',
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await flush()

    const runningButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.automation-sequence-select'))
      .find(button => button.textContent?.includes('自动公招'))
    const disabledButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.automation-sequence-select'))
      .find(button => button.textContent?.includes('理智作战'))

    expect(runningButton?.getAttribute('aria-current')).toBe('step')
    expect(disabledButton?.hasAttribute('aria-current')).toBe(false)
  })

  it('associates dynamic labels and names compact destructive controls', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: {
        taskFlow: taskFlowFixture,
        schedule: { enabled: true, times: ['08:30', '12:45'] },
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()

    const clientTypeLabel = container.querySelector<HTMLLabelElement>('label[for="automation-startup-1-clientType"]')
    expect(clientTypeLabel?.textContent).toContain('客户端类型')
    expect(clientTypeLabel?.classList.contains('automation-field-label')).toBe(true)
    expect(container.querySelector('#automation-startup-1-clientType')?.tagName).toBe('SELECT')
    const accountNameLabel = container.querySelector<HTMLLabelElement>('label[for="automation-startup-1-accountName"]')
    expect(accountNameLabel?.textContent).toContain('切换账号')
    expect(accountNameLabel?.closest('.automation-param-fields')).not.toBeNull()
    expect(container.querySelector('#automation-startup-1-accountName')?.classList.contains('automation-text-control')).toBe(true)

    const taskDeleteButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="删除启动游戏"]')
    expect(taskDeleteButtons).toHaveLength(2)
    taskDeleteButtons.forEach(button => {
      expect(button.classList.contains('min-h-11')).toBe(true)
      expect(button.classList.contains('min-w-11')).toBe(true)
    })

    const firstHourInput = container.querySelector<HTMLInputElement>('#automation-schedule-hour-0')
    const firstMinuteInput = container.querySelector<HTMLInputElement>('#automation-schedule-minute-0')
    expect(firstHourInput?.value).toBe('8')
    expect(firstMinuteInput?.value).toBe('30')
    expect(container.querySelector<HTMLLabelElement>('label[for="automation-schedule-hour-0"]')?.textContent).toContain('第 1 个执行时间的小时')
    expect(container.querySelector<HTMLLabelElement>('label[for="automation-schedule-minute-0"]')?.textContent).toContain('第 1 个执行时间的分钟')
    expect(container.querySelector('[aria-label="第 1 个执行时间开启"]')).not.toBeNull()

    const deleteTimeButton = container.querySelector<HTMLButtonElement>('[aria-label="删除第 1 个时间点"]')
    expect(deleteTimeButton?.classList.contains('min-h-11')).toBe(true)
    expect(deleteTimeButton?.classList.contains('min-w-11')).toBe(true)
    const firstTimeRow = firstHourInput?.closest('.automation-schedule-time-row')
    expect(firstTimeRow).not.toBeNull()
    expect(firstTimeRow?.querySelector('.automation-schedule-time-unit')?.textContent).toContain('时')
    expect(deleteTimeButton?.closest('.automation-schedule-time-row')).toBe(firstTimeRow)
    expect(container.querySelector('.automation-schedule-list-heading-actions > .automation-schedule-add')?.textContent).toContain('新增定时')
    expect(container.querySelector('[aria-label="定时执行"]')?.closest('.automation-schedule-actions')).not.toBeNull()
    expect(container.querySelector('[aria-label="定时执行"]')?.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      inputValueSetter?.call(firstHourInput, '9')
      firstHourInput?.dispatchEvent(new Event('input', { bubbles: true }))
      inputValueSetter?.call(firstMinuteInput, '15')
      firstMinuteInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(container.querySelector<HTMLInputElement>('#automation-schedule-hour-0')?.value).toBe('9')
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-minute-0')?.value).toBe('15')
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['09:15', '12:45'],
    })

    await act(async () => deleteTimeButton?.click())
    await flush()

    expect(container.querySelectorAll('.automation-schedule-time-row')).toHaveLength(1)
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-hour-0')?.value).toBe('12')
    expect(container.querySelector<HTMLInputElement>('#automation-schedule-minute-0')?.value).toBe('45')
    expect(container.querySelector('[aria-label^="删除第 "]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toMatchObject({
      enabled: true,
      times: ['12:45'],
    })

    await clickSequenceTask('理智作战')
    expect(container.querySelector('label[for="automation-fight-1-stages-0"]')?.textContent).toContain('关卡')
    expect(container.querySelector('#automation-fight-1-stages-0')).not.toBeNull()
    expect(container.querySelector('[aria-label="关卡 2"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="关卡 2 执行次数"]')).not.toBeNull()

    const stageLabel = container.querySelector<HTMLLabelElement>('label[for="automation-fight-1-stages-0"]')!
    const stageEditor = stageLabel.closest('.automation-stage-editor')
    const secondStageInput = container.querySelector<HTMLInputElement>('[aria-label="关卡 2"]')!
    const secondStageRow = secondStageInput.closest('.automation-stage-row')
    expect(stageEditor).not.toBeNull()
    expect(stageEditor?.querySelector('.automation-stage-list')).not.toBeNull()
    expect(stageEditor?.querySelector('.automation-stage-add')?.textContent).toContain('添加关卡')
    expect(stageEditor?.querySelector('.automation-smart-stage-entry')?.textContent).toContain('智能养成关卡')
    expect(secondStageRow).not.toBeNull()
    expect(secondStageInput.classList.contains('automation-stage-name-input')).toBe(true)

    const pinButton = container.querySelector<HTMLButtonElement>('[aria-label="置顶：关卡 1"]')
    const deleteStageButton = container.querySelector<HTMLButtonElement>('[aria-label="删除关卡 2"]')
    ;[pinButton, deleteStageButton].forEach(button => {
      expect(button?.classList.contains('min-h-11')).toBe(true)
      expect(button?.classList.contains('min-w-11')).toBe(true)
    })

    const mobileStepper = container.querySelector('[aria-label="增加关卡 1 的执行次数"]')?.parentElement
    expect(mobileStepper?.classList.contains('hidden')).toBe(true)
    expect(mobileStepper?.classList.contains('min-[900px]:flex')).toBe(true)

    await clickSequenceTask('自动公招')
    const refreshLabel = container.querySelector<HTMLLabelElement>('label[for="automation-recruit-1-refresh"]')
    expect(refreshLabel?.classList.contains('min-h-11')).toBe(true)
    expect(container.querySelector('#automation-recruit-1-refresh')).not.toBeNull()
    expect(container.querySelector('fieldset legend')?.textContent).toContain('招募星级')
  })

  it('keeps stage creation and deletion inside one grouped list', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await clickSequenceTask('理智作战')

    const stageEditor = container.querySelector('.automation-stage-editor')!
    expect(stageEditor.querySelectorAll('.automation-stage-item')).toHaveLength(2)

    await act(async () => {
      stageEditor.querySelector<HTMLButtonElement>('.automation-stage-add')?.click()
    })
    await flush()

    expect(stageEditor.querySelectorAll('.automation-stage-item')).toHaveLength(3)
    expect(stageEditor.querySelector('[aria-label="关卡 3"]')).not.toBeNull()

    await act(async () => {
      stageEditor.querySelector<HTMLButtonElement>('[aria-label="删除关卡 3"]')?.click()
    })
    await flush()

    expect(stageEditor.querySelectorAll('.automation-stage-item')).toHaveLength(2)
    expect(stageEditor.querySelector('[aria-label="关卡 3"]')).toBeNull()

    const undoRow = stageEditor.querySelector('[role="status"]')
    expect(undoRow?.textContent).toContain('已删除关卡')
    const undoButton = Array.from(stageEditor.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '撤销')
    expect(undoButton).not.toBeNull()

    await act(async () => undoButton?.click())
    await flush()

    expect(stageEditor.querySelectorAll('.automation-stage-item')).toHaveLength(3)
    expect(stageEditor.querySelector('[aria-label="关卡 3"]')).not.toBeNull()
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

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await clickSequenceTask('理智作战')

    const addSmartStages = container.querySelector<HTMLButtonElement>('[aria-label="加入智能养成关卡"]')!
    await act(async () => {
      addSmartStages.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flush()

    const stageEditor = container.querySelector('.automation-stage-editor')!
    expect(stageEditor.querySelectorAll('.automation-stage-item.is-smart')).toHaveLength(1)
    expect(stageEditor.textContent).toContain('正在养成：阿米娅')
    expect(stageEditor.querySelector<HTMLInputElement>('.automation-stage-item.is-smart .automation-stage-name-input')?.value).toBe('AP-5')
    expect(mocks.generateTrainingPlan).toHaveBeenCalledWith({ mode: 'current' })

    const removeSmartStages = stageEditor.querySelector<HTMLButtonElement>('[aria-label="移除智能养成关卡"]')!
    await act(async () => removeSmartStages.click())
    await flush()

    expect(stageEditor.querySelectorAll('.automation-stage-item.is-smart')).toHaveLength(0)
    expect(stageEditor.querySelector('[aria-label="加入智能养成关卡"]')).not.toBeNull()
  })

  it('exposes the add-task picker as a labelled menu', async () => {
    await act(async () => root.render(<AutomationTasks />))
    await flush()

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
    await act(async () => root.render(<AutomationTasks />))
    await flush()

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

  it('closes the add-task picker when pressing outside its region', async () => {
    await act(async () => root.render(<AutomationTasks />))
    await flush()

    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await act(async () => trigger.click())
    expect(container.querySelector('[role="menu"]')).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })

    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('moves a task with a floating ghost while dragging its handle', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })

    await act(async () => root.render(<AutomationTasks />))
    await flush()

    const rowHeight = 88
    const items = Array.from(container.querySelectorAll<HTMLElement>('.automation-sequence-item'))
    items.forEach((item, index) => {
      item.getBoundingClientRect = () => ({
        top: index * rowHeight,
        left: 0,
        right: 400,
        bottom: (index + 1) * rowHeight,
        width: 400,
        height: rowHeight,
        x: 0,
        y: index * rowHeight,
        toJSON: () => ({}),
      })
    })

    const fightItem = items.find(item => item.textContent?.includes('理智作战'))
    const handle = fightItem?.querySelector<HTMLButtonElement>('.automation-sequence-drag')
    expect(handle).toBeDefined()

    await act(async () => {
      handle?.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 20, clientY: 132 }))
    })
    await flush()

    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 20, clientY: 300 }))
      await Promise.resolve()
    })
    await flush()

    const ghost = document.body.querySelector<HTMLElement>('.automation-drag-ghost')
    expect(ghost).not.toBeNull()
    expect(ghost?.textContent).toContain('理智作战')
    expect(ghost?.style.transform).toContain('translate3d')
    expect(document.body.classList.contains('automation-sorting')).toBe(true)

    await act(async () => {
      window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 20, clientY: 300 }))
    })
    await flush()

    expect(document.body.querySelector('.automation-drag-ghost')).toBeNull()
    expect(document.body.classList.contains('automation-sorting')).toBe(false)
    expect(Array.from(container.querySelectorAll('.automation-sequence-copy strong')).map(node => node.textContent))
      .toEqual(['启动游戏', '自动公招', '理智作战'])
  })

  it('shows only the stopping state while a stop is awaiting confirmation', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
    mocks.getScheduleExecutionStatus.mockResolvedValue({
      success: true,
      data: {
        isRunning: true,
        currentTaskId: 'startup-1',
        currentTask: '启动游戏',
        message: '正在执行: 启动游戏',
        shouldStop: false,
      },
    })

    await act(async () => root.render(<AutomationTasks />))
    await flush()
    await flush()

    expect(buttonsByText('执行中')).toHaveLength(1)
    expect(buttonsByText('终止执行')).toHaveLength(1)

    const stopConfirmation = deferred<{ success: boolean; data: { isRunning: boolean } }>()
    mocks.stopTask.mockImplementation(async () => {
      mocks.getScheduleExecutionStatus.mockReturnValue(stopConfirmation.promise)
      return { success: true, data: { task: { success: true }, scheduleStopped: true } }
    })

    const stopButton = buttonsByText('终止执行')[0]
    expect(stopButton).toBeDefined()
    await act(async () => stopButton?.click())
    await flush()

    const stoppingButton = buttonsByText('正在终止')[0]
    expect(stoppingButton).toBeDefined()
    expect(stoppingButton?.disabled).toBe(true)
    expect(buttonsByText('执行中')).toHaveLength(0)

    await act(async () => stopConfirmation.resolve({
      success: true,
      data: { isRunning: false },
    }))
    await flush()
    await flush()

    expect(buttonsByText('正在终止')).toHaveLength(0)
    expect(buttonsByText('立即执行')[0]?.disabled).toBe(false)
  })

  it('does not let a stale stop confirmation outlive the stopped run', async () => {
    vi.useFakeTimers()
    try {
      mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
      mocks.stopTask.mockResolvedValue({
        success: true,
        data: { task: { success: true }, scheduleStopped: true },
      })
      mocks.executeScheduleNow.mockReturnValue(new Promise(() => undefined))

      let phase: 'running' | 'idle' = 'running'
      let stopClicked = false
      let firstStatusPromise: Promise<unknown> | null = null
      let resolveFirstStatus: ((value: unknown) => void) | null = null

      mocks.getScheduleExecutionStatus.mockImplementation((signal?: AbortSignal) => {
        if (stopClicked && firstStatusPromise === null) {
          firstStatusPromise = new Promise((resolve, reject) => {
            resolveFirstStatus = resolve
            signal?.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            }, { once: true })
          })
          return firstStatusPromise
        }
        return Promise.resolve({
          success: true,
          data: {
            isRunning: phase === 'running',
            message: phase === 'running' ? '正在执行: 启动游戏' : '',
          },
        })
      })

      await act(async () => root.render(<AutomationTasks />))
      await flush()
      await flush()

      const stopButton = buttonsByText('终止执行')[0]
      expect(stopButton).toBeDefined()
      stopClicked = true
      await act(async () => stopButton?.click())
      await flush()
      expect(buttonsByText('正在终止')).toHaveLength(1)

      phase = 'idle'
      await act(async () => vi.advanceTimersByTimeAsync(1_000))
      await flush()
      await flush()
      expect(buttonsByText('正在终止')).toHaveLength(0)

      phase = 'running'
      const runButton = buttonsByText('立即执行')[0]
      expect(runButton?.disabled).toBe(false)
      await act(async () => runButton?.click())
      await flush()

      // Simulate the pre-fix status endpoint resolving the stale wait with the new run.
      await act(async () => {
        resolveFirstStatus?.({ success: true, data: { isRunning: true, message: '正在执行: 启动游戏' } })
        await Promise.resolve()
      })
      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      await flush()

      expect(mocks.executeScheduleNow).toHaveBeenCalledTimes(1)
      expect(mocks.setMessage).not.toHaveBeenCalledWith(
        '终止失败: 终止请求已发送，但尚未确认任务停止',
        'error',
      )

      const nextStopButton = buttonsByText('终止执行')[0]
      expect(nextStopButton?.disabled).toBe(false)
      await act(async () => nextStopButton?.click())
      await flush()
      expect(mocks.stopTask).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows the stop request to be retried when idle confirmation times out', async () => {
    vi.useFakeTimers()
    try {
      mocks.loadUserConfig.mockResolvedValue({ success: true, data: { taskFlow: taskFlowFixture } })
      mocks.getScheduleExecutionStatus.mockResolvedValue({
        success: true,
        data: {
          isRunning: true,
          currentTaskId: 'startup-1',
          currentTask: '启动游戏',
          message: '正在执行: 启动游戏',
          shouldStop: false,
        },
      })

      await act(async () => root.render(<AutomationTasks />))
      await flush()
      await flush()

      mocks.getScheduleExecutionStatus.mockResolvedValue({
        success: true,
        data: {
          isRunning: true,
          currentTaskId: 'startup-1',
          currentTask: '启动游戏',
          message: '正在终止任务流程',
          shouldStop: true,
        },
      })

      const stopButton = buttonsByText('终止执行')[0]
      expect(stopButton).toBeDefined()
      await act(async () => stopButton?.click())
      await flush()
      expect(buttonsByText('正在终止')).toHaveLength(1)

      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      await flush()

      expect(mocks.stopTask).toHaveBeenCalledTimes(2)
      expect(buttonsByText('正在终止')).toHaveLength(1)
      expect(buttonsByText('终止执行')).toHaveLength(0)

      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      await flush()

      expect(mocks.setMessage).toHaveBeenCalledWith(
        '终止失败: 终止请求已发送，但尚未确认任务停止',
        'error',
      )
      expect(buttonsByText('终止执行')[0]?.disabled).toBe(false)

      await act(async () => buttonsByText('终止执行')[0]?.click())
      await flush()
      expect(mocks.stopTask).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
