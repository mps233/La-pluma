// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
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
