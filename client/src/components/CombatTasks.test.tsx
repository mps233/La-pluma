// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CombatTasks from './CombatTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  stopTask: vi.fn(),
  executePredefinedTaskArgs: vi.fn(),
  getCopilotInfo: vi.fn(),
  getCopilotSet: vi.fn(),
  getCopilotSetPlan: vi.fn(),
  resetCopilotSetProgress: vi.fn(),
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
    executePredefinedTaskArgs: mocks.executePredefinedTaskArgs,
    getCopilotInfo: mocks.getCopilotInfo,
    getCopilotSet: mocks.getCopilotSet,
    getCopilotSetPlan: mocks.getCopilotSetPlan,
    resetCopilotSetProgress: mocks.resetCopilotSetProgress,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  },
  searchCopilot: vi.fn(),
  searchParadoxCopilot: vi.fn(),
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const buttonsByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .filter(button => button.textContent?.trim() === text) as HTMLButtonElement[]

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const renderComponent = async () => {
  await act(async () => {
    root.render(<CombatTasks />)
  })
  await flush()
}

describe('CombatTasks execution recovery', () => {
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
    mocks.executePredefinedTaskArgs.mockReset().mockResolvedValue({ success: true })
    mocks.getCopilotInfo.mockReset()
    mocks.getCopilotSet.mockReset()
    mocks.getCopilotSetPlan.mockReset()
    mocks.resetCopilotSetProgress.mockReset()
    mocks.setMessage.mockReset()
    mocks.setActive.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('deduplicates stop requests and exposes the stopping state', async () => {
    const stopRequest = deferred<{ success: boolean; data: { task: { success: boolean } } }>()
    mocks.getTaskStatus.mockResolvedValueOnce({
      success: true,
      data: { isRunning: true, taskType: 'combat', taskName: '自动战斗', startTime: Date.now() },
    })
    mocks.stopTask.mockReturnValueOnce(stopRequest.promise)

    await renderComponent()
    const stopButton = buttonsByText('终止执行')[0]
    expect(stopButton).toBeDefined()

    await click(stopButton!)
    stopButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(mocks.stopTask).toHaveBeenCalledOnce()
    expect(buttonsByText('正在终止')[0]?.disabled).toBe(true)
    expect(mocks.setMessage).toHaveBeenCalledWith('正在终止自动战斗...', 'warning')

    await act(async () => stopRequest.resolve({ success: true, data: { task: { success: true } } }))
    expect(mocks.setMessage).toHaveBeenCalledWith('自动战斗已终止', 'warning')
    expect(buttonsByText('立即执行').length).toBeGreaterThan(0)
  })

  it('keeps the reset dialog open when resetting progress fails', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })
    mocks.resetCopilotSetProgress.mockResolvedValue({ success: false, message: '进度存储不可用' })

    await renderComponent()
    await click(buttonsByText('作业集')[0]!)

    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://48990s')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    await click(buttonsByText('重置进度')[0]!)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await click(buttonsByText('确认重置')[0]!)
    await flush()

    expect(mocks.resetCopilotSetProgress).toHaveBeenCalledWith('48990')
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(buttonsByText('确认重置')[0]?.disabled).toBe(false)
    expect(mocks.setMessage).toHaveBeenCalledWith('重置失败: 进度存储不可用', 'error')
  })

  it('keeps a normal task running until the wait-for-completion request settles', async () => {
    const execution = deferred<{ success: boolean }>()
    mocks.executePredefinedTaskArgs.mockReturnValueOnce(execution.promise)
    await renderComponent()

    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://1234')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('立即执行')[0]!)

    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledWith(
      'copilot',
      expect.any(Array),
      null,
      null,
      '自动战斗作业',
      'combat',
      true,
    )
    expect(buttonsByText('终止执行')[0]).toBeDefined()

    await act(async () => execution.resolve({ success: true }))
    expect(buttonsByText('立即执行').length).toBeGreaterThan(0)
  })

  it('does not continue a sequential copilot set after stop is confirmed', async () => {
    const firstCopilot = deferred<{ success: boolean }>()
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
        ],
        entries: [],
      },
    })
    mocks.executePredefinedTaskArgs.mockReturnValueOnce(firstCopilot.promise)

    await renderComponent()
    await click(buttonsByText('作业集')[0]!)
    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://48990s')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    const executionMode = Array.from(document.querySelectorAll('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'app'))
    await act(async () => {
      if (!executionMode) return
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      valueSetter?.call(executionMode, 'app')
      executionMode.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(buttonsByText('立即执行')[0]!)
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledTimes(1)

    await click(buttonsByText('终止执行')[0]!)
    await flush()
    expect(mocks.setMessage).toHaveBeenCalledWith('自动战斗已终止', 'warning')

    await act(async () => firstCopilot.resolve({ success: true }))
    await flush()
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledTimes(1)
    expect(mocks.setMessage).not.toHaveBeenCalledWith(expect.stringContaining('作业集执行完成'))
  })

  it('allows the stop request to be retried when idle confirmation times out', async () => {
    vi.useFakeTimers()
    mocks.getTaskStatus
      .mockResolvedValueOnce({
        success: true,
        data: { isRunning: true, taskType: 'combat', taskName: '自动战斗', startTime: Date.now() },
      })
      .mockResolvedValue({ success: true, data: { isRunning: true } })

    await renderComponent()
    await click(buttonsByText('终止执行')[0]!)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(mocks.setMessage).toHaveBeenCalledWith(
      '终止失败: 终止请求已发送，但尚未确认任务停止',
      'error',
    )
    expect(buttonsByText('终止执行')[0]?.disabled).toBe(false)

    await click(buttonsByText('终止执行')[0]!)
    expect(mocks.stopTask).toHaveBeenCalledTimes(2)
  })
})
