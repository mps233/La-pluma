// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationTasks from './AutomationTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  getTaskStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setActive: vi.fn(),
  setMessage: vi.fn(),
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
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
  generateTrainingPlan: vi.fn(),
  maaApi: {
    getActivity: mocks.getActivity,
    getErrorMessage: () => '未知错误',
    getScheduleExecutionStatus: mocks.getScheduleExecutionStatus,
    getTaskStatus: mocks.getTaskStatus,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
    setupSchedule: mocks.setupSchedule,
    stopSchedule: mocks.stopSchedule,
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
    mocks.getActivity.mockReset().mockResolvedValue({ success: false })
    mocks.getScheduleExecutionStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
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

    expect(container.querySelector<HTMLInputElement>('[aria-label="定时执行"]')?.checked).toBe(true)
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
    expect(accountNameLabel?.closest('.automation-param-fields')?.classList.contains('is-grouped')).toBe(true)
    expect(container.querySelector('#automation-startup-1-accountName')?.classList.contains('automation-text-control')).toBe(true)

    const taskDeleteButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="删除启动游戏"]')
    expect(taskDeleteButtons).toHaveLength(2)
    taskDeleteButtons.forEach(button => {
      expect(button.classList.contains('min-h-11')).toBe(true)
      expect(button.classList.contains('min-w-11')).toBe(true)
    })

    const hourSelect = container.querySelector<HTMLSelectElement>('[aria-label="第 1 个执行时间的小时"]')
    const minuteSelect = container.querySelector<HTMLSelectElement>('[aria-label="第 1 个执行时间的分钟"]')
    expect(hourSelect?.classList.contains('min-h-11')).toBe(true)
    expect(minuteSelect?.classList.contains('min-h-11')).toBe(true)

    const deleteTimeButton = container.querySelector<HTMLButtonElement>('[aria-label="删除第 1 个时间点"]')
    expect(deleteTimeButton?.classList.contains('min-h-11')).toBe(true)
    expect(deleteTimeButton?.classList.contains('min-w-11')).toBe(true)
    const firstTimeRow = hourSelect?.closest('.automation-schedule-time-row')
    expect(firstTimeRow).not.toBeNull()
    expect(minuteSelect?.closest('.automation-schedule-time-row')).toBe(firstTimeRow)
    expect(deleteTimeButton?.closest('.automation-schedule-time-row')).toBe(firstTimeRow)
    expect(container.querySelector('[aria-label="定时执行"]')?.closest('.automation-schedule-actions')).not.toBeNull()
    expect(container.querySelector('[aria-label="定时执行"]')?.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)

    await act(async () => deleteTimeButton?.click())
    await flush()

    expect(container.querySelectorAll('.automation-schedule-time-row')).toHaveLength(1)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="第 1 个执行时间的小时"]')?.value).toBe('12')
    expect(container.querySelector<HTMLSelectElement>('[aria-label="第 1 个执行时间的分钟"]')?.value).toBe('45')
    expect(container.querySelector('[aria-label^="删除第 "]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('maa-schedule') || '{}')).toEqual({
      enabled: true,
      times: ['12:45'],
    })

    await clickSequenceTask('理智作战')
    expect(container.querySelector('label[for="automation-fight-1-stages-0"]')?.textContent).toContain('关卡')
    expect(container.querySelector('#automation-fight-1-stages-0')).not.toBeNull()
    expect(container.querySelector('[aria-label="关卡 2"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="关卡 2 执行次数"]')).not.toBeNull()

    const stageLabel = container.querySelector<HTMLLabelElement>('label[for="automation-fight-1-stages-0"]')!
    const stageRow = stageLabel.parentElement
    const secondStageInput = container.querySelector<HTMLInputElement>('[aria-label="关卡 2"]')!
    const secondStageControl = secondStageInput.closest('.automation-stage-control')
    expect(stageRow?.className).toContain('flex-col')
    expect(stageRow?.className).toContain('sm:flex-row')
    expect(stageRow?.className).toContain('min-w-0')
    expect(secondStageControl?.classList.contains('min-w-0')).toBe(true)
    expect(secondStageControl?.classList.contains('flex-1')).toBe(true)
    expect(secondStageInput.classList.contains('min-w-0')).toBe(true)
    expect(secondStageInput.classList.contains('flex-1')).toBe(true)

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
})
