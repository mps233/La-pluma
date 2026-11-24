// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LogsWorkspace from './LogsWorkspace'
import type { LogEntry } from '../types'
import type { AgentRun } from '@/features/task-execution'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const row = (message: string, runId?: string): LogEntry => ({
  id: message,
  time: '10:00:00',
  level: 'INFO',
  message,
  ...(runId ? { runId } : {}),
})

const fixtureLogs: readonly LogEntry[] = [
  row('本次执行的输出', 'run-1'),
  row('上一次执行的输出', 'run-0'),
  row('没有归属的输出'),
]
let realtimeLogs = fixtureLogs
let viewingHistory = false
let coverageNotice: string | null = null
let trackedRun: AgentRun | null = null
const clearScreen = vi.fn()
const reloadFiles = vi.fn(async () => 'ready' as const)
const notifications = vi.hoisted(() => ({
  notify: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notify: notifications.notify,
  dismissNotice: notifications.dismissNotice,
  LOGS_NOTICE_ID: 'logs',
  LOGS_COVERAGE_NOTICE_ID: 'logs-coverage',
  LOGS_HIDDEN_MATCHES_NOTICE_ID: 'logs-hidden-matches',
  LOGS_REFRESH_NOTICE_ID: 'logs-refresh',
}))

vi.mock('../hooks/useLogsSession', () => ({
  useLogsSession: () => ({
    realtime: {
      logs: realtimeLogs,
      error: null,
      paused: false,
      hasLoaded: true,
      coverageNotice,
      start: () => {},
      stop: () => {},
      refresh: () => {},
      pause: () => {},
      resume: () => {},
      clear: clearScreen,
    },
    history: {
      viewing: viewingHistory,
      files: [],
      filesPhase: 'ready',
      filesError: null,
      selectedFile: null,
      logs: [row('历史文件输出')],
      readPhase: 'idle',
      error: null,
      selectFile: () => {},
      backToRealtime: () => {},
      reloadFiles,
      retry: () => {},
      reconcileSelection: () => false,
    },
    commandPending: null,
    enterHistory: () => {},
    backToRealtime: () => {},
    cleanupHistoryLogs: async () => ({ status: 'succeeded', message: 'ok' }),
  }),
}))

vi.mock('@/features/task-execution', () => ({
  useExecutionSnapshot: () => ({ trackedRun }),
  isTerminalRunState: (state: string) => ['succeeded', 'failed', 'stopped', 'interrupted'].includes(state),
}))

let container: HTMLDivElement
let root: Root

const renderWorkspace = async () => {
  await act(async () => root.render(<LogsWorkspace />))
}

const logText = () => container.querySelector('[role="log"]')?.textContent || ''
const selectRun = async (runId: string) => {
  const trigger = container.querySelector<HTMLElement>('[aria-label="执行范围"]')
  if (!trigger) throw new Error('未找到执行范围控件')
  const optionLabel = runId === '' ? '全部执行与未关联日志' : `Run · ${runId}`
  await act(async () => trigger.click())
  const option = optionInTriggerPopup(trigger, optionLabel)
  if (!option) throw new Error(`未找到选项：${optionLabel}`)
  await act(async () => (option as HTMLElement).click())
  await act(async () => {})
}

const activeRun = (runId: string): AgentRun => ({
  runId,
  operationId: `op-${runId}`,
  state: 'running',
  links: { self: `/api/runs/${runId}` },
})

describe('LogsWorkspace observation scope', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    trackedRun = null
    realtimeLogs = fixtureLogs
    viewingHistory = false
    coverageNotice = null
    clearScreen.mockClear()
    reloadFiles.mockClear()
    notifications.notify.mockClear()
    notifications.dismissNotice.mockClear()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('starts with all collected logs, including unassociated records', async () => {
    trackedRun = activeRun('run-1')
    await renderWorkspace()
    expect(logText()).toContain('本次执行的输出')
    expect(logText()).toContain('上一次执行的输出')
    expect(logText()).toContain('没有归属的输出')
  })

  it('pins an explicit run after completion and while a different run starts', async () => {
    trackedRun = activeRun('run-1')
    await renderWorkspace()
    await selectRun('run-1')
    expect(logText()).toContain('本次执行的输出')
    expect(logText()).not.toContain('上一次执行的输出')
    expect(logText()).not.toContain('没有归属的输出')

    trackedRun = { ...activeRun('run-1'), state: 'succeeded' }
    await renderWorkspace()
    expect(logText()).not.toContain('上一次执行的输出')
    trackedRun = activeRun('run-2')
    realtimeLogs = [...fixtureLogs, row('新执行的输出', 'run-2')]
    await renderWorkspace()
    expect(logText()).toContain('本次执行的输出')
    expect(logText()).not.toContain('新执行的输出')
    expect(container.querySelector('[aria-label="执行范围"]')?.textContent).toContain('Run · run-1')
  })

  it('reloads history files when the tracked run reaches a terminal state', async () => {
    trackedRun = activeRun('run-1')
    await renderWorkspace()
    expect(reloadFiles).not.toHaveBeenCalled()

    trackedRun = { ...activeRun('run-1'), state: 'succeeded' }
    await renderWorkspace()
    expect(reloadFiles).toHaveBeenCalledTimes(1)
  })

  it('returns to all logs explicitly and preserves pinned choice across file browsing', async () => {
    await renderWorkspace()
    await selectRun('run-1')
    viewingHistory = true
    await renderWorkspace()
    expect(logText()).toContain('历史文件输出')
    expect((container.querySelector('[aria-label="执行范围"]') as HTMLButtonElement).disabled).toBe(true)
    viewingHistory = false
    await renderWorkspace()
    expect(logText()).not.toContain('上一次执行的输出')
    await selectRun('')
    expect(logText()).toContain('上一次执行的输出')
  })

  it('clears the local observation without a server clear confirmation', async () => {
    await renderWorkspace()
    const clear = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '清屏')
    await act(async () => clear?.click())
    expect(clearScreen).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(notifications.notify).toHaveBeenCalledWith(
      '已清屏，后续到达的日志会继续显示',
      'success',
      { id: 'logs' },
    )
  })

  it('reports realtime continuity loss through the fixed coverage toast', async () => {
    coverageNotice = '实时日志窗口已失去连续性'
    await renderWorkspace()
    expect(notifications.notify).toHaveBeenCalledWith(
      coverageNotice,
      'warning',
      { id: 'logs-coverage', duration: Infinity },
    )

    coverageNotice = null
    await renderWorkspace()
    expect(notifications.dismissNotice).toHaveBeenCalledWith('logs-coverage')
  })

  it('offers matching diagnostic events hidden by the key-event filter', async () => {
    realtimeLogs = [row('load diagnostic-needle')]
    await renderWorkspace()
    const search = container.querySelector<HTMLInputElement>('[aria-label="搜索日志内容"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'diagnostic-needle')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const hiddenNotice = notifications.notify.mock.calls.find(
      ([, type, options]) => type === 'info' && options?.id === 'logs-hidden-matches',
    )
    expect(hiddenNotice?.[0]).toBe('1 条匹配日志被关键事件筛选隐藏')
    const showAll = hiddenNotice?.[2]?.action?.onClick
    expect(showAll).toBeTypeOf('function')
    await act(async () => showAll?.())
    expect(logText()).toContain('load diagnostic-needle')
    expect(container.querySelector('[aria-label="事件范围"]')?.textContent).toContain('全部事件')
  })
})
