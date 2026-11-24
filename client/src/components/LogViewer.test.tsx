// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LogViewer from './LogViewer'
import { installMobileMatchMedia, swipe } from '../test/swipe'

const mocks = vi.hoisted(() => ({
  getRealtimeLogs: vi.fn(),
  getLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  cleanupLogs: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLDivElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: { div: MotionDiv },
    useReducedMotion: () => true,
  }
})

vi.mock('../services/api', () => ({
  maaApi: mocks,
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))

let container: HTMLElement

afterEach(cleanup)

const renderComponent = async () => {
  const view = render(<LogViewer />)
  container = view.container
  return view
}

describe('LogViewer recovery and controls', () => {
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
    mocks.getRealtimeLogs.mockReset().mockResolvedValue({ success: true, data: [] })
    mocks.getLogFiles.mockReset().mockResolvedValue({ success: true, data: [] })
    mocks.readLogFile.mockReset()
    mocks.cleanupLogs.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a retry action when realtime logs fail and replaces the error after recovery', async () => {
    const user = userEvent.setup()
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: false, message: '实时日志暂不可用' })
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: 'TaskChainStart' }],
      })

    await renderComponent()
    await waitFor(() => expect(container.querySelector('.log-console-state.is-error')).not.toBeNull())

    expect(container.querySelector('.log-viewer')?.classList.contains('ios-borderless-cards')).toBe(true)
    expect(container.querySelector('h1')?.textContent).toBe('日志')
    expect(container.querySelector('.app-page-header-icon')).toBeNull()
    const error = container.querySelector<HTMLElement>('.log-console-state.is-error')
    expect(error?.textContent).toContain('实时日志暂不可用')
    expect(container.textContent).not.toContain('暂无实时日志，等待任务执行')
    const realtimeRetry = within(error!).getByRole('button')
    await user.click(realtimeRetry)

    await waitFor(() => expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(container.querySelector('.log-console-state.is-error')).toBeNull())
    expect(container.textContent).toContain('TaskChainStart')
    const modeShell = container.querySelector('.log-mode-shell')
    expect(modeShell?.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('日志内容模式')
    expect(container.querySelector('.log-toolbar .log-mode-shell')).toBeNull()
    const modeTabs = Array.from(
      modeShell?.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] > [role="radio"]') ?? [],
    )
    expect(modeTabs).toHaveLength(2)
    expect(modeTabs[0]?.getAttribute('aria-checked')).toBe('true')
    expect(modeTabs.every(button => button.getAttribute('role') === 'radio')).toBe(true)
    expect(modeTabs.every(button => button.getAttribute('aria-controls') === 'log-console-panel')).toBe(true)
    // The segmented control selects through its native click listener; jsdom's
    // zero-size layout makes userEvent's pointer simulation suppress it.
    fireEvent.click(modeTabs[1]!)
    await waitFor(() => expect(modeTabs[1]?.getAttribute('aria-checked')).toBe('true'))

    fireEvent.keyDown(modeTabs[1]!, { key: 'ArrowLeft' })
    await waitFor(() => expect(modeTabs[0]?.getAttribute('aria-checked')).toBe('true'))
    expect(document.activeElement).toBe(modeTabs[0])

    const switches = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
    )
    expect(switches.map(control => control.getAttribute('aria-label'))).toEqual(['自动滚动', '仅显示本次运行日志', '折叠重复日志'])
    expect(switches.map(control => control.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    const toggleControls = Array.from(container.querySelectorAll('.log-toggle-control'))
    expect(toggleControls).toHaveLength(3)
    expect(toggleControls.every(control => !control.classList.contains('surface-soft'))).toBe(true)
  })

  it('pauses following when the user scrolls up and offers a jump to latest', async () => {
    const user = userEvent.setup()
    mocks.getRealtimeLogs.mockResolvedValue({
      success: true,
      data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: '滚动测试日志' }],
    })

    await renderComponent()
    await waitFor(() => expect(container.querySelector('.log-row')?.textContent).toContain('滚动测试日志'))

    const consoleElement = container.querySelector<HTMLElement>('.log-console')
    expect(consoleElement).not.toBeNull()
    Object.defineProperty(consoleElement, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(consoleElement, 'clientHeight', { configurable: true, value: 400 })
    consoleElement!.scrollTop = 200

    fireEvent.scroll(consoleElement!)
    await waitFor(() => expect(container.querySelector('.log-console-jump button')).not.toBeNull())

    const jump = container.querySelector<HTMLButtonElement>('.log-console-jump button')
    const autoScrollSwitch = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="自动滚动"]')
    expect(jump?.textContent).toContain('回到最新')
    expect(container.querySelector('.log-console-fade.is-bottom')?.classList.contains('is-visible')).toBe(true)
    expect(autoScrollSwitch?.getAttribute('aria-checked')).toBe('false')

    await user.click(jump!)

    expect(consoleElement!.scrollTop).toBe(1000)
    await waitFor(() => expect(container.querySelector('.log-console-jump')).toBeNull())
    expect(autoScrollSwitch?.getAttribute('aria-checked')).toBe('true')
  })

  it('switches the log content mode with a horizontal swipe', async () => {
    installMobileMatchMedia()
    mocks.getRealtimeLogs.mockResolvedValue({ success: true, data: [] })
    await renderComponent()

    const modeTabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.log-mode-shell [role="radiogroup"] > [role="radio"]'),
    )
    await waitFor(() => expect(modeTabs[0]?.getAttribute('aria-checked')).toBe('true'))

    await swipe(container.querySelector<HTMLElement>('.log-viewer')!, 240, 200, 120, 204)

    await waitFor(() => expect(modeTabs[1]?.getAttribute('aria-checked')).toBe('true'))
  })

  it('keeps existing realtime rows visible when a background refresh fails', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: '保留这条实时日志' }],
      })
      .mockResolvedValueOnce({ success: false, message: '后台刷新暂不可用' })

    await renderComponent()
    await waitFor(() => expect(container.querySelector('.log-row')?.textContent).toContain('保留这条实时日志'))

    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(container.querySelector('.log-console-state.is-error')?.textContent).toContain('后台刷新暂不可用'))
    expect(container.querySelector('.log-row')?.textContent).toContain('保留这条实时日志')
  })

  it('offers retry for both the history list and a selected history file', async () => {
    const user = userEvent.setup()
    const historyFile = {
      name: 'maa.log',
      path: '/logs/maa.log',
      modified: '2026-07-22T10:00:00.000Z',
      size: 1024,
    }
    mocks.getLogFiles
      .mockResolvedValueOnce({ success: false, message: '历史列表读取失败' })
      .mockResolvedValueOnce({ success: true, data: [historyFile] })
    mocks.readLogFile
      .mockResolvedValueOnce({ success: false, message: '日志文件读取失败' })
      .mockResolvedValueOnce({ success: true, data: { content: '[2026-07-22 10:11:12][INFO] recovered' } })

    await renderComponent()
    await waitFor(() => expect(container.querySelector('.log-history-state.is-error')).not.toBeNull())

    const historyError = container.querySelector<HTMLElement>('.log-history-state.is-error')
    expect(historyError?.textContent).toContain('历史列表读取失败')
    expect(container.textContent).not.toContain('暂无历史日志文件')
    const historyRetry = within(historyError!).getByRole('button')
    await user.click(historyRetry)

    await waitFor(() => expect(container.querySelector('.log-history-row')?.textContent).toContain('maa.log'))
    const historyRow = container.querySelector<HTMLButtonElement>('.log-history-row')
    await user.click(historyRow!)
    await waitFor(() => expect(historyRow?.getAttribute('aria-current')).toBe('true'))
    expect(container.querySelector('.log-console-content .surface-soft')?.textContent).toContain('maa.log')

    await waitFor(() => expect(container.querySelector('.log-console-state.is-error')).not.toBeNull())
    const fileError = container.querySelector<HTMLElement>('.log-console-state.is-error')
    expect(fileError?.textContent).toContain('日志文件读取失败')
    const fileRetry = within(fileError!).getByRole('button')
    await user.click(fileRetry)

    await waitFor(() => expect(mocks.readLogFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(container.querySelector('.log-console-state.is-error')).toBeNull())
    expect(container.textContent).toContain('recovered')
  })
})
