// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LogViewer from './LogViewer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getRealtimeLogs: vi.fn(),
  getLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  clearRealtimeLogs: vi.fn(),
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

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderComponent = async () => {
  await act(async () => root.render(<LogViewer />))
  await flush()
}

const click = async (element: HTMLElement) => {
  await act(async () => element.click())
  await flush()
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
    mocks.clearRealtimeLogs.mockReset()
    mocks.cleanupLogs.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows a retry action when realtime logs fail and replaces the error after recovery', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: false, message: '实时日志暂不可用' })
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: 'TaskChainStart' }],
      })

    await renderComponent()

    expect(container.querySelector('h1')?.textContent).toBe('日志')
    expect(container.querySelector('.app-page-header-icon')).toBeNull()
    const error = container.querySelector<HTMLElement>('.log-console-state.is-error')
    expect(error?.textContent).toContain('实时日志暂不可用')
    expect(container.textContent).not.toContain('暂无实时日志，等待任务执行')
    const realtimeRetry = error?.querySelector<HTMLButtonElement>('button')
    expect(realtimeRetry).not.toBeNull()
    await click(realtimeRetry!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.log-console-state.is-error')).toBeNull()
    expect(container.textContent).toContain('TaskChainStart')
    expect(container.querySelector('.log-mode-shell.app-liquid-tab-pill')).not.toBeNull()
    expect(container.querySelector('.log-toolbar .log-mode-shell')).toBeNull()
    const modeTabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.log-mode-shell [role="tab"]'))
    expect(modeTabs).toHaveLength(2)
    expect(modeTabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(modeTabs.every(button => (
      button.className.includes('app-workspace-segment')
      && button.className.includes('min-h-11')
    ))).toBe(true)
    await click(modeTabs[1]!)
    expect(modeTabs[1]?.getAttribute('aria-selected')).toBe('true')

    await act(async () => {
      modeTabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    await flush()
    expect(modeTabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(modeTabs[0])

    const switches = Array.from(container.querySelectorAll<HTMLInputElement>('[role="switch"]'))
    expect(switches.map(input => input.getAttribute('aria-label'))).toEqual(['自动滚动', '折叠重复日志'])
    expect(switches.every(input => input.checked)).toBe(true)
  })

  it('keeps existing realtime rows visible when a background refresh fails', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: '保留这条实时日志' }],
      })
      .mockResolvedValueOnce({ success: false, message: '后台刷新暂不可用' })

    await renderComponent()
    expect(container.querySelector('.log-row')?.textContent).toContain('保留这条实时日志')

    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await flush()

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.log-console-state.is-error')?.textContent).toContain('后台刷新暂不可用')
    expect(container.querySelector('.log-row')?.textContent).toContain('保留这条实时日志')
  })

  it('offers retry for both the history list and a selected history file', async () => {
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
    const historyError = container.querySelector<HTMLElement>('.log-history-state.is-error')
    expect(historyError?.textContent).toContain('历史列表读取失败')
    expect(container.textContent).not.toContain('暂无历史日志文件')
    const historyRetry = historyError?.querySelector<HTMLButtonElement>('button')
    expect(historyRetry).not.toBeNull()
    await click(historyRetry!)

    const historyRow = container.querySelector<HTMLButtonElement>('.log-history-row')
    expect(historyRow?.textContent).toContain('maa.log')
    await click(historyRow!)
    expect(historyRow?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('.log-console-content .surface-soft')?.textContent).toContain('maa.log')

    const fileError = container.querySelector<HTMLElement>('.log-console-state.is-error')
    expect(fileError?.textContent).toContain('日志文件读取失败')
    const fileRetry = fileError?.querySelector<HTMLButtonElement>('button')
    expect(fileRetry).not.toBeNull()
    await click(fileRetry!)

    expect(mocks.readLogFile).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.log-console-state.is-error')).toBeNull()
    expect(container.textContent).toContain('recovered')
  })
})
