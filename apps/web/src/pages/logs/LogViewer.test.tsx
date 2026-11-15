// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import LogViewer from './LogViewer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const mocks = vi.hoisted(() => ({
  getRealtimeLogs: vi.fn(),
  getLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  clearRealtimeLogs: vi.fn(),
  cleanupLogs: vi.fn(),
}))

vi.mock('@/features/device-mirror', () => ({
  DeviceMonitorLayout: ({ children }: { children: ReactNode }) => children,
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

vi.mock('@/features/logs/api', () => mocks)

let container: HTMLDivElement
let root: Root
let visibility: DocumentVisibilityState

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const historyFile = (name: string, path = `/logs/${name}`) => ({
  name,
  path,
  modified: '2026-07-22T10:00:00.000Z',
  size: 1024,
})

const historyLine = (message: string) => `[2026-07-22 10:11:12][INFO] ${message}`

const realtimeLine = (message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => ({
  time: '2026-07-22T10:11:12.000Z',
  level,
  message: `[2026-07-22 10:11:12][${level}] ${message}`,
})

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

const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent === label)

const findAction = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.getAttribute('aria-label') === label)

const findHistoryRow = (file: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes(file))

const changeSelect = async (select: HTMLSelectElement | HTMLElement, optionLabel: string) => {
  const trigger = select as HTMLElement
  await act(async () => trigger.click())
  const option = optionInTriggerPopup(trigger, optionLabel)
  if (!option) throw new Error(`未找到选项：${optionLabel}`)
  await act(async () => (option as HTMLElement).click())
  await flush()
}

const changeInput = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const readBlobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result ?? ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsText(blob)
})

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

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
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    })
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

    expect(container.querySelector('h1')).toBeNull()
    const error = container.querySelector<HTMLElement>('[role="alert"]')
    expect(error?.textContent).toContain('实时日志暂不可用')
    expect(container.textContent).not.toContain('暂无实时日志，等待任务执行')
    const realtimeRetry = error?.querySelector<HTMLButtonElement>('button')
    expect(realtimeRetry).not.toBeNull()
    await click(realtimeRetry!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('TaskChainStart')

    const switches = Array.from(container.querySelectorAll('[role="switch"]'))
    expect(switches.map(input => input.getAttribute('aria-label')))
      .toEqual(['自动滚动', '折叠重复日志'])
    expect(switches.every(input => input.getAttribute('aria-checked') === 'true')).toBe(true)
  })

  it('keeps existing realtime rows visible when a background refresh fails', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12.000Z', level: 'INFO', message: '保留这条实时日志' }],
      })
      .mockResolvedValueOnce({ success: false, message: '后台刷新暂不可用' })

    await renderComponent()
    expect(container.querySelector('[role="log"]')?.textContent).toContain('保留这条实时日志')

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await flush()
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await flush()

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('后台刷新暂不可用')
    expect(container.querySelector('[role="log"]')?.textContent).toContain('保留这条实时日志')
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
    const historyError = container.querySelector<HTMLElement>('[role="alert"]')
    expect(historyError?.textContent).toContain('历史列表读取失败')
    expect(container.textContent).not.toContain('暂无历史日志文件')
    const historyRetry = historyError?.querySelector<HTMLButtonElement>('button')
    expect(historyRetry).not.toBeNull()
    await click(historyRetry!)

    const historyRow = findHistoryRow('maa.log')
    expect(historyRow).not.toBeUndefined()
    await click(historyRow!)
    expect(historyRow?.getAttribute('aria-current')).toBe('true')
    expect(findButton('返回实时')).toBeDefined()

    const fileError = container.querySelector<HTMLElement>('[role="alert"]')
    expect(fileError?.textContent).toContain('日志文件读取失败')
    expect(findHistoryRow('maa.log')).not.toBeUndefined()
    const fileRetry = fileError?.querySelector<HTMLButtonElement>('button')
    expect(fileRetry).not.toBeNull()
    await click(fileRetry!)

    expect(mocks.readLogFile).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('recovered')
  })

  it('returns to realtime with a fresh read and no stale history content', async () => {
    const target = historyFile('maa.log')
    const returned = deferred<ApiResponse<unknown>>()
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.readLogFile.mockResolvedValue({
      success: true,
      data: { content: historyLine('历史内容') },
    })
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({
        success: true,
        data: [{ time: '2026-07-22T10:11:12', level: 'INFO', message: '进入前' }],
      })
      .mockReturnValueOnce(returned.promise)

    await renderComponent()
    expect(container.textContent).toContain('进入前')
    const autoScroll = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find(input => input.getAttribute('aria-label') === '自动滚动')
    expect(autoScroll()?.getAttribute('aria-checked')).toBe('true')

    await click(findHistoryRow('maa.log')!)
    expect(mocks.readLogFile).toHaveBeenCalledWith(target.path, 1000, expect.any(AbortSignal))
    expect(container.textContent).toContain('历史内容')
    expect(autoScroll()?.getAttribute('aria-checked')).toBe('false')
    expect(autoScroll()?.getAttribute('aria-disabled')).toBe('true')

    const back = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '返回实时')
    await click(back!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('历史内容')
    expect(container.textContent).not.toContain('进入前')
    expect(autoScroll()?.getAttribute('aria-checked')).toBe('true')
    expect(autoScroll()?.getAttribute('aria-disabled')).toBeNull()

    returned.resolve({
      success: true,
      data: [{ time: '2026-07-22T10:11:12', level: 'INFO', message: '返回后' }],
    })
    await flush()
    expect(container.textContent).toContain('返回后')
  })

  it('keeps the newest selection when an older history read resolves late', async () => {
    const olderFile = historyFile('older.log')
    const newerFile = historyFile('newer.log')
    const older = deferred<ApiResponse<unknown>>()
    const newer = deferred<ApiResponse<unknown>>()
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [olderFile, newerFile] })
    mocks.readLogFile.mockImplementation((path: string) => (
      path === olderFile.path ? older.promise : newer.promise
    ))

    await renderComponent()
    const olderRow = findHistoryRow('older.log')
    const newerRow = findHistoryRow('newer.log')
    expect(olderRow).toBeDefined()
    expect(newerRow).toBeDefined()
    await click(olderRow!)
    await click(newerRow!)

    newer.resolve({ success: true, data: { content: historyLine('新选择') } })
    await flush()
    expect(container.textContent).toContain('新选择')
    expect(newerRow?.getAttribute('aria-current')).toBe('true')

    older.resolve({ success: true, data: { content: historyLine('旧选择') } })
    await flush()
    expect(container.textContent).toContain('新选择')
    expect(container.textContent).not.toContain('旧选择')
    expect(newerRow?.getAttribute('aria-current')).toBe('true')
  })

  it('keeps auto-scroll across history switching and retry', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.getRealtimeLogs.mockResolvedValue({ success: true, data: [] })
    mocks.readLogFile
      .mockResolvedValueOnce({ success: false, message: '日志文件读取失败' })
      .mockResolvedValueOnce({ success: true, data: { content: historyLine('历史内容') } })

    await renderComponent()
    const autoScroll = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find(input => input.getAttribute('aria-label') === '自动滚动')

    await click(findHistoryRow('maa.log')!)
    expect(autoScroll()?.getAttribute('aria-checked')).toBe('false')
    expect(autoScroll()?.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('日志文件读取失败')

    await click(container.querySelector<HTMLButtonElement>('[role="alert"] button')!)
    expect(container.textContent).toContain('历史内容')

    const back = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '返回实时')
    await click(back!)

    expect(autoScroll()?.getAttribute('aria-checked')).toBe('true')
    expect(autoScroll()?.getAttribute('aria-disabled')).toBeNull()
  })

  it('keeps level filters across realtime and history views', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.readLogFile.mockResolvedValue({
      success: true,
      data: {
        content: `${historyLine('历史普通行')}\n[2026-07-22 10:11:13][ERROR] 历史错误行`,
      },
    })
    mocks.getRealtimeLogs.mockResolvedValue({
      success: true,
      data: [
        { time: '2026-07-22T10:11:12', level: 'INFO', message: '实时普通行' },
        { time: '2026-07-22T10:11:13', level: 'ERROR', message: '实时错误行' },
      ],
    })

    await renderComponent()
    expect(container.textContent).toContain('实时普通行')
    const level = container.querySelector<HTMLElement>('[aria-label="日志级别"]')
    expect(level).not.toBeNull()
    await changeSelect(level!, '错误')
    expect(container.textContent).toContain('实时错误行')
    expect(container.textContent).not.toContain('实时普通行')

    await click(findHistoryRow('maa.log')!)
    expect(container.textContent).toContain('历史错误行')
    expect(container.textContent).not.toContain('历史普通行')

    const back = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '返回实时')
    await click(back!)
    expect(level?.textContent).toContain('错误')
    expect(container.textContent).toContain('实时错误行')
    expect(container.textContent).not.toContain('实时普通行')
  })

  it('confirms cleanup, refreshes the file list and reports the result', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles
      .mockResolvedValueOnce({ success: true, data: [target] })
      .mockResolvedValueOnce({ success: true, data: [] })
    mocks.cleanupLogs.mockResolvedValue({ success: true, message: '已清理 1 个日志文件' })

    await renderComponent()
    expect(findHistoryRow('maa.log')).toBeDefined()

    const cleanup = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '清理旧日志')
    await click(cleanup!)
    expect(document.body.textContent).toContain('清理旧日志文件？')

    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '确认清理')
    await click(confirm!)

    expect(mocks.cleanupLogs).toHaveBeenCalledWith(10, expect.any(AbortSignal))
    expect(mocks.getLogFiles).toHaveBeenCalledTimes(2)
    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('已清理 1 个日志文件')
    expect(container.textContent).toContain('暂无历史日志文件')
  })

  it('keeps the cleanup dialog open after a failure and allows retrying', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.cleanupLogs
      .mockResolvedValueOnce({ success: false, message: '清理接口暂不可用' })
      .mockResolvedValueOnce({ success: true, message: '清理完成' })

    await renderComponent()
    const cleanup = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '清理旧日志')
    await click(cleanup!)
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '确认清理')
    await click(confirm!)

    expect(document.body.textContent).toContain('清理接口暂不可用')
    expect(document.body.textContent).toContain('清理旧日志文件？')
    expect(container.textContent).toContain('清理接口暂不可用')
    expect(mocks.getLogFiles).toHaveBeenCalledTimes(1)

    const retryConfirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === '确认清理')
    await click(retryConfirm!)

    expect(mocks.cleanupLogs).toHaveBeenCalledTimes(2)
    expect(mocks.getLogFiles).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('清理完成')
  })

  it('clears the local display without mutating shared server logs', async () => {
    const before = realtimeLine('清屏前的行')
    const after = realtimeLine('清屏后的行')
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: true, data: [before] })
      .mockResolvedValue({ success: true, data: [before, after] })

    await renderComponent()
    expect(container.querySelector('[role="log"]')?.textContent).toContain('清屏前的行')
    await click(findButton('清屏')!)

    expect(container.querySelector('[role="log"]')?.textContent).not.toContain('清屏前的行')
    expect(container.textContent).toContain('已清屏，后续到达的日志会继续显示')
    expect(document.body.textContent).not.toContain('确认清空')
    expect(mocks.clearRealtimeLogs).not.toHaveBeenCalled()
    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(1)
    expect(mocks.getLogFiles).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await flush()

    expect(container.querySelector('[role="log"]')?.textContent).toContain('清屏后的行')
    expect(container.querySelector('[role="log"]')?.textContent).not.toContain('清屏前的行')
    expect(mocks.clearRealtimeLogs).not.toHaveBeenCalled()
  })

  it('pauses realtime polling from the toolbar and resumes through the same control', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: true, data: [realtimeLine('暂停前')] })
      .mockResolvedValueOnce({ success: true, data: [realtimeLine('恢复后')] })

    await renderComponent()
    expect(container.textContent).toContain('暂停前')
    const pause = findAction('暂停读取日志')
    expect(pause?.textContent).toBe('暂停')

    await click(pause!)
    expect(findAction('继续读取日志')?.textContent).toBe('继续')

    await click(findAction('继续读取日志')!)
    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('恢复后')
    expect(findAction('暂停读取日志')?.textContent).toBe('暂停')
  })

  it('resumes a paused stream when retrying the realtime error', async () => {
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: false, message: '实时日志暂不可用' })
      .mockResolvedValueOnce({ success: true, data: [realtimeLine('恢复后的日志')] })

    await renderComponent()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('实时日志暂不可用')

    await click(findAction('暂停读取日志')!)
    expect(findAction('继续读取日志')).not.toBeUndefined()

    await click(container.querySelector<HTMLButtonElement>('[role="alert"] button')!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('恢复后的日志')
    expect(findAction('暂停读取日志')).not.toBeUndefined()
  })

  it('keeps a manual pause and the local display boundary after clearing', async () => {
    const before = realtimeLine('暂停前的行')
    const after = realtimeLine('继续后的新行')
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: true, data: [before] })
      .mockResolvedValue({ success: true, data: [before, after] })

    await renderComponent()
    await click(findAction('暂停读取日志')!)
    await click(findButton('清屏')!)

    expect(mocks.clearRealtimeLogs).not.toHaveBeenCalled()
    expect(container.querySelector('[role="log"]')?.textContent).not.toContain('暂停前的行')
    expect(container.textContent).toContain('日志读取已暂停，继续后重新读取')
    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(1)
    expect(findAction('继续读取日志')).not.toBeUndefined()

    await click(findAction('继续读取日志')!)
    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="log"]')?.textContent).toContain('继续后的新行')
    expect(container.querySelector('[role="log"]')?.textContent).not.toContain('暂停前的行')
  })

  it('resumes realtime polling when returning from history after a manual pause', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.readLogFile.mockResolvedValue({
      success: true,
      data: { content: historyLine('历史内容') },
    })
    mocks.getRealtimeLogs
      .mockResolvedValueOnce({ success: true, data: [realtimeLine('暂停前')] })
      .mockResolvedValueOnce({ success: true, data: [realtimeLine('返回实时')] })

    await renderComponent()
    await click(findAction('暂停读取日志')!)
    await click(findHistoryRow('maa.log')!)

    expect(container.textContent).toContain('历史内容')
    expect(findAction('暂停读取日志')).toBeUndefined()
    expect(findAction('继续读取日志')).toBeUndefined()
    expect(findButton('清理旧日志')?.disabled).toBe(true)

    await click(findButton('返回实时')!)

    expect(mocks.getRealtimeLogs).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('返回实时')
    expect(container.textContent).not.toContain('历史内容')
    expect(findAction('暂停读取日志')).not.toBeUndefined()
    expect(findButton('清理旧日志')?.disabled).toBe(false)
  })

  it('filters by search text and keeps the query across history views', async () => {
    const target = historyFile('maa.log')
    mocks.getLogFiles.mockResolvedValue({ success: true, data: [target] })
    mocks.readLogFile.mockResolvedValue({
      success: true,
      data: {
        content: `${historyLine('历史命中关键字')}\n${historyLine('历史普通行')}`,
      },
    })
    mocks.getRealtimeLogs.mockResolvedValue({
      success: true,
      data: [realtimeLine('实时命中关键字'), realtimeLine('实时普通行')],
    })

    await renderComponent()
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索日志内容"]')
    expect(search).not.toBeNull()
    await changeInput(search!, '关键字')

    expect(container.textContent).toContain('实时命中关键字')
    expect(container.textContent).not.toContain('实时普通行')

    await click(findHistoryRow('maa.log')!)
    expect(container.textContent).toContain('历史命中关键字')
    expect(container.textContent).not.toContain('历史普通行')
    expect(search?.value).toBe('关键字')
  })

  it('exports the filtered rows before repeat collapsing', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:log-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const records = [
      { ...realtimeLine('重复行'), id: 'export:1', sequence: 1 },
      { ...realtimeLine('重复行'), id: 'export:2', sequence: 2 },
      { ...realtimeLine('其他行'), id: 'export:3', sequence: 3 },
    ]
    mocks.getRealtimeLogs.mockResolvedValue({ success: true, data: records })

    await renderComponent()
    expect(container.textContent).toContain('2 条')
    expect(container.querySelector('[role="log"]')?.textContent).toContain('x2')

    await click(findButton('导出筛选结果')!)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect((await readBlobText(blob)).split('\n').map(line => JSON.parse(line))).toEqual(records)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:log-export')

    await changeSelect(container.querySelector<HTMLElement>('[aria-label="日志级别"]')!, '错误')
    expect(findButton('导出筛选结果')?.disabled).toBe(true)
  })
})
