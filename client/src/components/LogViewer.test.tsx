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

    const error = container.querySelector<HTMLElement>('.log-console-state.is-error')
    expect(error?.textContent).toContain('实时日志暂不可用')
    expect(container.textContent).not.toContain('暂无实时日志，等待任务执行')
    const realtimeRetry = error?.querySelector<HTMLButtonElement>('button')
    expect(realtimeRetry).not.toBeNull()
    await click(realtimeRetry!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.log-console-state.is-error')).toBeNull()
    expect(container.textContent).toContain('TaskChainStart')
    expect(Array.from(container.querySelectorAll('.log-mode-switch button')).every(button => (
      button.className.includes('min-h-11')
    ))).toBe(true)
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
