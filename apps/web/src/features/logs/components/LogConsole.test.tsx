// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LogConsole from './LogConsole'
import type { LogEntry } from '../types'
import { buildLogView } from '../model/logModel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ConsoleProps = ComponentProps<typeof LogConsole>

const entry = (message: string, time = '10:00:00'): LogEntry => ({ time, level: 'INFO', message })

const initialLogs = [entry('第一行'), entry('第二行'), entry('第三行')]

const baseProps = (logs: readonly LogEntry[]): ConsoleProps => ({
  viewingHistory: false,
  selectedFile: null,
  loading: false,
  error: null,
  logs,
  unfilteredLogCount: logs.length,
  view: buildLogView(logs, { events: 'all', level: 'all', search: '', collapseRepeats: true }),
  autoScroll: true,
  paused: false,
  onRetry: () => {},
  onBackToRealtime: () => {},
  onClearFilters: () => {},
  onShowAllRuns: () => {},
  onOpenHistory: () => {},
})

let container: HTMLDivElement
let root: Root

const renderConsole = async (logs: readonly LogEntry[], overrides: Partial<ConsoleProps> = {}) => {
  await act(async () => root.render(<LogConsole {...baseProps(logs)} {...overrides} />))
  await act(async () => {
    await Promise.resolve()
  })
}

const getLogNode = () => {
  const node = container.querySelector<HTMLElement>('[role="log"]')
  if (!node) throw new Error('log container is missing')
  return node
}

/** jsdom 没有布局：以实例属性伪装滚动盒尺寸，scrollTop 可写可读。 */
const defineScrollBox = (node: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(node, 'scrollTop', { configurable: true, writable: true, value: 0 })
}

const scrollNode = async (node: HTMLElement) => {
  await act(async () => node.dispatchEvent(new Event('scroll')))
}

const liveMode = () => container.querySelector('[role="log"]')?.getAttribute('aria-live')

const findFollowIndicator = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes('有新日志') || button.textContent?.includes('回到底部'))

describe('LogConsole scroll following', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('follows content changes but keeps the scroll position when only the reference changes', async () => {
    await renderConsole(initialLogs)
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    const grownLogs = [...initialLogs, entry('第四行')]
    await renderConsole(grownLogs)
    expect(node.scrollTop).toBe(1000)

    node.scrollTop = 500
    await renderConsole(grownLogs.map(log => ({ ...log })))
    expect(node.scrollTop).toBe(500)

    await renderConsole([...grownLogs, entry('第五行')])
    expect(node.scrollTop).toBe(1000)
  })

  it('pauses when the user scrolls away, counts unread rows and resumes at the bottom', async () => {
    await renderConsole(initialLogs)
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 120
    await scrollNode(node)
    expect(findFollowIndicator()?.textContent).toBe('回到底部')

    await renderConsole([...initialLogs, entry('新增一'), entry('新增二')])
    expect(node.scrollTop).toBe(120)
    expect(findFollowIndicator()?.textContent).toBe('有新日志')

    node.scrollTop = 60
    await scrollNode(node)
    expect(findFollowIndicator()?.textContent).toBe('有新日志')

    node.scrollTop = 1000
    await scrollNode(node)
    expect(findFollowIndicator()).toBeUndefined()

    await renderConsole([...initialLogs, entry('新增一'), entry('新增二'), entry('新增三')])
    expect(node.scrollTop).toBe(1000)
    expect(findFollowIndicator()).toBeUndefined()
  })

  it('mutes the live region while following is paused and restores it at the bottom', async () => {
    await renderConsole(initialLogs)
    expect(liveMode()).toBe('polite')

    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 120
    await scrollNode(node)
    expect(liveMode()).toBe('off')

    node.scrollTop = 1000
    await scrollNode(node)
    expect(liveMode()).toBe('polite')
  })

  it('mutes the live region while log reading is paused', async () => {
    await renderConsole(initialLogs, { paused: true })
    expect(liveMode()).toBe('off')
  })

  it('resumes following and clears the count from the indicator click', async () => {
    await renderConsole(initialLogs)
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 120
    await scrollNode(node)
    await renderConsole([...initialLogs, entry('新增一')])

    const indicator = findFollowIndicator()
    expect(indicator?.textContent).toBe('有新日志')
    await act(async () => indicator?.click())
    await act(async () => {
      await Promise.resolve()
    })

    expect(findFollowIndicator()).toBeUndefined()
    expect(node.scrollTop).toBe(1000)

    await renderConsole([...initialLogs, entry('新增一'), entry('新增二')])
    expect(node.scrollTop).toBe(1000)
  })

  it('never follows or shows the indicator while the manual switch is off', async () => {
    await renderConsole(initialLogs, { autoScroll: false })
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 200
    await scrollNode(node)
    expect(findFollowIndicator()).toBeUndefined()

    await renderConsole([...initialLogs, entry('新增一')], { autoScroll: false })
    expect(node.scrollTop).toBe(200)
    expect(findFollowIndicator()).toBeUndefined()
  })

  it('clears the smart pause when the manual switch toggles and follows again after it turns back on', async () => {
    await renderConsole(initialLogs)
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 120
    await scrollNode(node)
    expect(findFollowIndicator()).not.toBeUndefined()

    await renderConsole(initialLogs.map(log => ({ ...log })), { autoScroll: false })
    expect(findFollowIndicator()).toBeUndefined()
    expect(node.scrollTop).toBe(120)

    await renderConsole(initialLogs.map(log => ({ ...log })), { autoScroll: true })
    expect(node.scrollTop).toBe(1000)
    expect(findFollowIndicator()).toBeUndefined()
  })

  it('does not follow in history view', async () => {
    const historyLogs = [entry('历史一'), entry('历史二')]
    await renderConsole(historyLogs, { viewingHistory: true, autoScroll: true })
    expect(liveMode()).toBe('off')
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)

    node.scrollTop = 100
    await scrollNode(node)
    expect(findFollowIndicator()).toBeUndefined()

    await renderConsole([...historyLogs, entry('历史三')], { viewingHistory: true, autoScroll: true })
    expect(node.scrollTop).toBe(100)
  })
  it('keeps following when repeat grouping changes the rendered height', async () => {
    const repeated = [
      { ...entry('执行命令: maa fight, 等待完成: true'), id: 'event-1' },
      { ...entry('执行命令: maa fight, 等待完成: true'), id: 'event-2' },
    ]
    const view = (collapseRepeats: boolean) => buildLogView(repeated, {
      events: 'all', level: 'all', search: '', collapseRepeats,
    })
    await renderConsole(repeated, { view: view(true) })
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)
    node.scrollTop = 500
    await renderConsole(repeated, { view: view(false) })
    expect(node.scrollTop).toBe(1000)
    node.scrollTop = 500
    await renderConsole(repeated, { view: view(true) })
    expect(node.scrollTop).toBe(1000)
    expect(findFollowIndicator()).toBeUndefined()
  })

  it('preserves a paused position when repeat grouping changes', async () => {
    const repeated = [
      { ...entry('执行命令: maa fight, 等待完成: true'), id: 'event-1' },
      { ...entry('执行命令: maa fight, 等待完成: true'), id: 'event-2' },
    ]
    const view = (collapseRepeats: boolean) => buildLogView(repeated, {
      events: 'all', level: 'all', search: '', collapseRepeats,
    })
    await renderConsole(repeated, { view: view(true) })
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)
    node.scrollTop = 120
    await scrollNode(node)
    await renderConsole(repeated, { view: view(false) })
    expect(node.scrollTop).toBe(120)
    expect(findFollowIndicator()?.textContent).toBe('回到底部')
    await renderConsole(repeated, { view: view(true) })
    expect(node.scrollTop).toBe(120)
    expect(findFollowIndicator()?.textContent).toBe('回到底部')
  })

  it('does not mark equal selected facts unread and resets when the scope changes', async () => {
    await renderConsole(initialLogs, { scopeKey: 'run-1' })
    const node = getLogNode()
    defineScrollBox(node, 1000, 400)
    node.scrollTop = 120
    await scrollNode(node)
    await renderConsole(initialLogs.map(log => ({ ...log })), { scopeKey: 'run-1' })
    expect(findFollowIndicator()?.textContent).toBe('回到底部')
    await renderConsole([...initialLogs, entry('新增一')], { scopeKey: 'run-1' })
    expect(findFollowIndicator()?.textContent).toBe('有新日志')
    await renderConsole([entry('另一执行')], { scopeKey: 'run-2' })
    expect(findFollowIndicator()).toBeUndefined()
  })

  it('keeps a background refresh error out of the visible rows', async () => {
    await renderConsole(initialLogs, { error: '后台刷新暂不可用' })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('第一行')
  })

  it('offers all runs when the pinned run has no logs', async () => {
    const onShowAllRuns = vi.fn()
    await renderConsole([], { unfilteredLogCount: 1, onShowAllRuns })
    expect(container.textContent).toContain('当前执行范围内没有日志')
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(candidate => candidate.textContent === '显示全部执行')
    await act(async () => button?.click())
    expect(onShowAllRuns).toHaveBeenCalledOnce()
  })

  it('offers to clear filters when the visible result is empty', async () => {
    const view = buildLogView(initialLogs, {
      events: 'all',
      level: 'ERROR',
      search: '',
      collapseRepeats: true,
    })
    const onClearFilters = vi.fn()
    await renderConsole(initialLogs, { view, onClearFilters })
    expect(container.textContent).toContain('没有符合当前筛选条件的日志')
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(candidate => candidate.textContent === '清除筛选')
    await act(async () => button?.click())
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('switches large windows to the virtualized row surface', async () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    ;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      ResizeObserverMock as unknown as typeof ResizeObserver

    const logs = Array.from({ length: 130 }, (_, index) => entry(`第 ${index} 行`))
    await renderConsole(logs)
    expect(container.querySelector('[data-log-virtualized="true"]')).not.toBeNull()
  })
})

describe('LogConsole record details', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps exact source, full timestamp and correlation in expandable details', async () => {
    const record: LogEntry = {
      ...entry('执行命令: maa fight, 等待完成: true'),
      id: 'event-1',
      timestamp: '2026-11-03T10:00:00.123Z',
      sourceText: '[2026-11-03 10:00:00.123][INF][thread-1] 执行命令: maa fight, 等待完成: true',
      source: 'realtime',
      runId: 'run-1',
      operationId: 'op-1',
    }
    await renderConsole([record], {
      view: buildLogView([record], { events: 'all', level: 'all', search: '', collapseRepeats: true }),
    })
    expect(container.querySelector('summary')?.textContent).toBe('原文')
    expect(container.querySelector('pre')?.textContent).toBe(record.sourceText)
    expect(container.textContent).toContain('2026-11-03T10:00:00.123Z')
    expect(container.textContent).toContain('Run：run-1 · Operation：op-1')
  })
})
