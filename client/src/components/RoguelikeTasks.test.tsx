// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoguelikeTasks from './RoguelikeTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  stopTask: vi.fn(),
  executePredefinedTask: vi.fn(),
  setMessage: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: mocks.getTaskStatus,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
    stopTask: mocks.stopTask,
    executePredefinedTask: mocks.executePredefinedTask,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  },
}))

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({ setMessage: mocks.setMessage, setActive: mocks.setActive }),
}))

vi.mock('../hooks/useBackendStatusMonitor', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./ScreenMonitor', () => ({ default: () => <div data-testid="screen-monitor" /> }))

let container: HTMLDivElement
let root: Root

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const buttonByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === text) as HTMLButtonElement | undefined

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const keyDown = async (element: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    element.dispatchEvent(event)
  })
  return event
}

const runningStatus = () => ({
  success: true,
  data: { isRunning: true, taskType: 'roguelike', taskName: '集成战略', startTime: Date.now() },
})

describe('RoguelikeTasks execution recovery', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    localStorage.clear()
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: false })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.stopTask.mockReset().mockResolvedValue({ success: true, data: { task: { success: true } } })
    mocks.executePredefinedTask.mockReset()
    mocks.setMessage.mockReset()
    mocks.setActive.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses the shared iOS workspace surfaces for configuration and preview', async () => {
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const page = container.querySelector('.roguelike-page')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)
    expect(page?.querySelector('.app-page-header-icon')).toBeNull()

    const modeShell = page?.querySelector('.roguelike-mode-shell')
    expect(modeShell?.classList.contains('app-liquid-tab-pill')).toBe(true)

    const panels = page?.querySelectorAll('.roguelike-theme-panel, .roguelike-settings-panel, .roguelike-monitor-panel')
    expect(panels).toHaveLength(3)
    panels?.forEach(panel => {
      expect(panel.getAttribute('data-smooth-corners')).toBe('true')
      expect(panel.querySelector(':scope > .smooth-panel-surface')).not.toBeNull()
    })

    const monitor = page?.querySelector('.task-monitor-panel.is-compact')
    expect(monitor?.closest('.roguelike-monitor-surface')).not.toBeNull()
    expect(monitor?.closest('.roguelike-monitor-panel')).not.toBeNull()

    expect(modeShell?.querySelector('[role="toolbar"]')).not.toBeNull()
    const selectedModes = page?.querySelectorAll('.roguelike-mode-button[aria-pressed="true"]')
    expect(selectedModes).toHaveLength(1)

    const toggleTextLabel = page?.querySelector<HTMLLabelElement>('.roguelike-toggle-label')
    expect(toggleTextLabel?.htmlFor).toBeTruthy()
    expect(page?.querySelector(`#${toggleTextLabel?.htmlFor}`)?.getAttribute('role')).toBe('switch')
    const switches = page?.querySelectorAll('.roguelike-toggle-row .app-switch') ?? []
    expect(switches).toHaveLength(2)
    switches.forEach(switchControl => {
      expect(switchControl.classList.contains('min-h-11')).toBe(false)
    })

    const modeButtons = Array.from(page?.querySelectorAll<HTMLButtonElement>('.roguelike-mode-button') ?? [])
    expect(modeButtons.map(button => button.tabIndex)).toEqual([0, -1])
    modeButtons[0]?.focus()
    await keyDown(modeButtons[0]!, 'End')
    expect(modeButtons[1]?.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(modeButtons[1])

    const arrowDownEvent = await keyDown(modeButtons[1]!, 'ArrowDown')
    expect(arrowDownEvent.defaultPrevented).toBe(false)
    expect(modeButtons[1]?.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps mode selection and its configuration panel in sync', async () => {
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const reclamationMode = Array.from(container.querySelectorAll<HTMLButtonElement>('.roguelike-mode-button'))
      .find(button => button.textContent?.includes('生息演算'))
    expect(reclamationMode).toBeDefined()
    await click(reclamationMode!)

    expect(reclamationMode?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.roguelike-mode-button[aria-pressed="true"]')).toHaveLength(1)
    expect(container.querySelector('input[name="maa-reclamation-theme"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('.roguelike-theme-option'))
      .some(option => option.textContent?.includes('沙洲遗闻'))).toBe(true)
  })

  it('keeps an unsynced local draft across remounts and retries the save', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockRejectedValueOnce(new Error('网络连接中断'))
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Phantom')
      themeInput?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(localStorage.getItem('roguelikeConfigSyncPending')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('roguelikeTaskInputs') || '{}')).toMatchObject({ roguelike: 'Phantom' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('网络连接中断')

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.loadUserConfig.mockClear()
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Phantom')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未同步到服务器')

    await click(buttonByText('重新同步')!)
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('roguelikeConfigSyncPending')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.setMessage).toHaveBeenCalledWith('肉鸽配置已同步', 'success')
  })

  it('serializes saves so the latest draft reaches the server last', async () => {
    vi.useFakeTimers()
    const olderSave = deferred<{ success: boolean }>()
    const newerSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig
      .mockReturnValueOnce(olderSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    const setTheme = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(themeInput, value)
        themeInput.dispatchEvent(new Event('input', { bubbles: true }))
        await vi.advanceTimersByTimeAsync(300)
      })
    }
    await setTheme('Phantom')
    await setTheme('Sami')

    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
    await act(async () => olderSave.resolve({ success: true }))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.saveUserConfig.mock.calls[1]?.[1]).toMatchObject({
      taskInputs: { roguelike: 'Sami' },
    })

    await act(async () => newerSave.resolve({ success: true }))
    await flush()
    expect(localStorage.getItem('roguelikeConfigSyncPending')).toBeNull()
  })

  it('keeps the hydrated draft and skips config reload after Activity restore', async () => {
    vi.useFakeTimers()
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: { taskInputs: { roguelike: 'Phantom' }, advancedParams: {} },
    })
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(
          <Activity mode={mode}>
            <RoguelikeTasks />
          </Activity>,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    const themeInput = container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Sami')
      themeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await renderMode('hidden')
    await renderMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-roguelike-theme"]')?.value).toBe('Sami')
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
  })

  it('keeps global activity true while a combat task is running', async () => {
    mocks.getTaskStatus.mockResolvedValueOnce({
      success: true,
      data: { isRunning: true, taskType: 'combat', taskName: '自动战斗', startTime: Date.now() },
    })
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    expect(mocks.setActive).toHaveBeenCalledWith(true)
    expect(mocks.setActive).not.toHaveBeenCalledWith(false)
    expect(buttonByText('立即执行')).toBeDefined()
  })

  it('associates form controls with labels and exposes 44px touch targets', async () => {
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const controls = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
    expect(controls.length).toBeGreaterThan(0)
    controls.forEach(control => {
      expect(control.id).not.toBe('')
      const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
        .find(candidate => candidate.htmlFor === control.id || candidate.contains(control))
      expect(label).toBeDefined()
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        expect(label?.classList.contains('min-h-11')).toBe(true)
      } else {
        expect(control.classList.contains('app-native-control')).toBe(true)
      }
    })
    container.querySelectorAll('.roguelike-mode-button, .roguelike-theme-option').forEach(control => {
      expect(control.classList.contains('min-h-11')).toBe(true)
    })
  })

  it('continues polling after temporary failures and observes eventual completion', async () => {
    vi.useFakeTimers()
    mocks.getTaskStatus
      .mockResolvedValueOnce(runningStatus())
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockRejectedValueOnce(new Error('temporary 3'))
      .mockResolvedValueOnce({ success: true, data: { isRunning: false } })

    await act(async () => {
      root.render(<RoguelikeTasks />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(buttonByText('终止执行')).toBeDefined()

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
    }
    expect(mocks.setMessage).toHaveBeenCalledWith(
      '暂时无法确认肉鸽任务状态，将继续重试；需要时可手动终止',
      'warning',
    )
    expect(buttonByText('终止执行')).toBeDefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(5)
    expect(mocks.setMessage).toHaveBeenCalledWith('任务已完成')
    expect(buttonByText('立即执行')).toBeDefined()
  })

  it('sends one stop request while the first request is pending', async () => {
    const stopRequest = deferred<{ success: boolean; data: { task: { success: boolean } } }>()
    mocks.getTaskStatus.mockResolvedValueOnce(runningStatus())
    mocks.stopTask.mockReturnValueOnce(stopRequest.promise)

    await act(async () => {
      root.render(<RoguelikeTasks />)
    })
    await flush()

    const stopButton = buttonByText('终止执行')
    expect(stopButton).toBeDefined()
    await click(stopButton!)
    stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(mocks.stopTask).toHaveBeenCalledOnce()
    expect(buttonByText('正在终止')?.disabled).toBe(true)

    await act(async () => stopRequest.resolve({ success: true, data: { task: { success: true } } }))
    expect(mocks.setMessage).toHaveBeenCalledWith('肉鸽任务已终止', 'warning')
  })

  it('keeps the task running until a wait-for-completion request settles', async () => {
    const execution = deferred<{ success: boolean }>()
    mocks.executePredefinedTask.mockReturnValueOnce(execution.promise)
    await act(async () => root.render(<RoguelikeTasks />))
    await flush()

    const themeInput = document.querySelector<HTMLInputElement>('input[placeholder="输入主题代号"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(themeInput, 'Phantom')
      themeInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonByText('立即执行')!)

    expect(mocks.executePredefinedTask).toHaveBeenCalledWith(
      'roguelike',
      expect.any(String),
      null,
      null,
      '集成战略',
      'roguelike',
      true,
    )
    expect(buttonByText('终止执行')).toBeDefined()

    await act(async () => execution.resolve({ success: true }))
    expect(buttonByText('立即执行')).toBeDefined()
  })

  it('keeps the stopping state until backend status confirms the task is idle', async () => {
    const stopRequest = deferred<{ success: boolean; data: { task: { success: boolean } } }>()
    const idleStatus = deferred<{ success: boolean; data: { isRunning: boolean } }>()
    mocks.getTaskStatus
      .mockResolvedValueOnce(runningStatus())
      .mockReturnValueOnce(idleStatus.promise)
    mocks.stopTask.mockReturnValueOnce(stopRequest.promise)

    await act(async () => root.render(<RoguelikeTasks />))
    await flush()
    await click(buttonByText('终止执行')!)
    await act(async () => stopRequest.resolve({ success: true, data: { task: { success: true } } }))
    await flush()

    expect(buttonByText('正在终止')?.disabled).toBe(true)
    expect(mocks.setMessage).not.toHaveBeenCalledWith('肉鸽任务已终止', 'warning')

    await act(async () => idleStatus.resolve({ success: true, data: { isRunning: false } }))
    await flush()
    expect(mocks.setMessage).toHaveBeenCalledWith('肉鸽任务已终止', 'warning')
  })

  it('allows the stop request to be retried when idle confirmation times out', async () => {
    vi.useFakeTimers()
    mocks.getTaskStatus
      .mockResolvedValueOnce(runningStatus())
      .mockResolvedValue({ success: true, data: { isRunning: true } })

    await act(async () => root.render(<RoguelikeTasks />))
    await flush()
    await click(buttonByText('终止执行')!)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(mocks.setMessage).toHaveBeenCalledWith(
      '终止失败: 终止请求已发送，但尚未确认任务停止',
      'error',
    )
    expect(buttonByText('终止执行')?.disabled).toBe(false)

    await click(buttonByText('终止执行')!)
    expect(mocks.stopTask).toHaveBeenCalledTimes(2)
  })
})
