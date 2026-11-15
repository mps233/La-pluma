// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import {
  ExecutionController,
  type AgentRun,
  type RunSnapshot,
  type StopRunResult,
} from '@/features/task-execution'
import { userConfigCoordinator } from '@/features/user-config'
import AutomationTasks from './AutomationTasks'
import type { TaskFlowItem } from '@/features/automation/types'

// Keep the real Framer Motion lifecycle: mocking AnimatePresence hides this regression.
const mocks = vi.hoisted(() => ({
  controller: { current: null as unknown as ExecutionController },
  getActivity: vi.fn(),
  executeScheduleNow: vi.fn(),
  status: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

const flow: TaskFlowItem[] = [
  ['startup', '启动游戏'], ['infrast', '基建换班'], ['fight', '理智作战'],
  ['recruit', '自动公招'], ['mall', '信用收支'], ['award', '领取奖励'],
].map(([command, name]) => ({
  id: `${command}-1`, commandId: command as TaskFlowItem['commandId'], name: name!,
  icon: null, description: '任务说明', defaultParams: {}, paramFields: [], params: {}, enabled: true,
}))

vi.mock('@/features/automation/api', () => ({
  getActivity: mocks.getActivity,
  executeScheduleNow: mocks.executeScheduleNow,
  setupSchedule: vi.fn(),
  stopSchedule: vi.fn(),
}))

vi.mock('@/features/task-execution', async () => {
  const actual = await vi.importActual<typeof import('@/features/task-execution')>('@/features/task-execution')
  return {
    ...actual,
    get executionController() {
      return mocks.controller.current
    },
    useExecutionSnapshot: () => actual.useExecutionSnapshot(mocks.controller.current),
  }
})

vi.mock('@/features/user-config', async () => {
  const actual = await vi.importActual<typeof import('@/features/user-config')>('@/features/user-config')
  return {
    ...actual,
    loadUserConfig: async () => ({ success: true, data: { taskFlow: flow } }),
    saveUserConfig: vi.fn(),
  }
})

vi.mock('@/features/settings', () => ({ testConnection: vi.fn() }))
vi.mock('@/features/training', () => ({
  generateTrainingPlan: vi.fn(),
}))
vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))
vi.mock('@/shared/notifications', () => ({
  notify: mocks.notify,
  notifyProgress: mocks.notifyProgress,
  dismissNotice: mocks.dismissNotice,
  detectNoticeType: () => 'default',
  EXECUTION_NOTICE_ID: 'execution',
  STATISTICS_NOTICE_ID: 'statistics',
  SETTINGS_UPDATE_NOTICE_ID: 'settings-update',
}))
vi.mock('@/features/device-mirror', () => ({ DeviceMonitorPanel: () => null }))
vi.mock('@/features/automation/components/NotificationSettings', () => ({ default: () => null }))

const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function dailyRun(runId: string, state: AgentRun['state'], overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId,
    operationId: 'run_daily_flow',
    state,
    acceptedAt: '2026-10-25T12:00:00.000Z',
    links: {
      self: `/api/agent/runs/${runId}`,
      stop: `/api/agent/actions/stop?runId=${runId}`,
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const activeRuns = overrides.activeRuns ?? []
  const run = overrides.run ?? activeRuns[0] ?? null
  return {
    isRunning: activeRuns.length > 0,
    run,
    activeRuns,
    lastRun: overrides.lastRun ?? null,
    schedule: overrides.schedule ?? {},
    occupancy: {
      state: activeRuns.length ? 'run' : 'idle',
      runId: run?.runId ?? null,
      runState: run?.state ?? null,
      sources: activeRuns.length ? ['run'] : [],
      lease: { state: 'free', owner: null },
      task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
      schedule: {},
    },
    ...overrides,
  }
}

const runningSnapshot = () => snapshot({
  activeRuns: [dailyRun('run-1', 'running')],
  schedule: {
    isRunning: true,
    runId: 'run-1',
    currentStep: 2,
    currentTaskId: 'fight-1',
    taskResults: flow.map((task, index) => ({
      taskId: task.id,
      task: task.name,
      status: index < 2 ? 'success' : index === 2 ? 'running' : 'pending',
    })),
  },
})

const summary = {
  successCount: 6, failedCount: 0, skippedCount: 0, durationMs: 1000,
  taskResults: flow.map(task => ({ taskId: task.id, task: task.name, status: 'success' })),
  summaries: [], reports: [], actions: [], errors: [], warnings: [],
}

const finishedSnapshot = () => snapshot({
  lastRun: dailyRun('run-1', 'succeeded', { result: { message: '任务流程执行完成', summary }, finishedAt: '2026-10-25T12:01:00.000Z' }),
})

function createApi() {
  return {
    fetchSnapshot: vi.fn<(signal?: AbortSignal) => Promise<ApiResponse<RunSnapshot>>>(),
    fetchRun: vi.fn<(runId: string, signal?: AbortSignal) => Promise<ApiResponse<AgentRun>>>(),
    stopRun: vi.fn<(runId: string) => Promise<ApiResponse<StopRunResult>>>(),
  }
}

let api: ReturnType<typeof createApi>
let releases: Array<() => void>
let container: HTMLDivElement
let root: Root
let queryClient: ReturnType<typeof createQueryClient>

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  }))
  localStorage.clear()
  // 协调器是应用级单例：每个用例从空通道与空存储开始，避免跨用例沿用草稿/队列。
  userConfigCoordinator.dispose()
  // 活动读取走 Query：每个用例独立客户端，避免复用上一个用例的 mock 结果。
  queryClient = createQueryClient()
  mocks.getActivity.mockReset().mockResolvedValue({ success: false })
  mocks.notify.mockReset()
  mocks.notifyProgress.mockReset()
  mocks.dismissNotice.mockReset()
  mocks.executeScheduleNow.mockReset().mockResolvedValue(ok({
    accepted: true,
    runId: 'run-1',
    run: dailyRun('run-1', 'running'),
  }))
  api = createApi()
  api.fetchSnapshot.mockResolvedValue(ok(runningSnapshot()))
  api.fetchRun.mockResolvedValue({ success: false, errorInfo: { code: 'AGENT_RUN_NOT_FOUND' } })
  api.stopRun.mockResolvedValue(ok({} as StopRunResult))
  mocks.controller.current = new ExecutionController({
    api,
    storage: { read: () => null, write: () => undefined },
    intervals: { active: 1_000, idle: 5_000, disconnected: 2_000 },
  })
  releases = []
  const release = mocks.controller.current.start()
  releases.push(release)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  releases.forEach(release => release())
  vi.unstubAllGlobals()
})

it('keeps completed task marks after Activity hides a finishing run', async () => {
  const render = async (mode: 'visible' | 'hidden') => {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <Activity mode={mode}><AutomationTasks /></Activity>
      </QueryClientProvider>,
    ))
    await flush()
  }

  await render('visible')
  await act(async () => container.querySelector<HTMLButtonElement>('button[data-status-key="ready"]')?.click())
  await flush()

  expect(container.querySelectorAll('[data-execution-state="running"]')).toHaveLength(1)

  await render('hidden')
  api.fetchSnapshot.mockResolvedValue(ok(finishedSnapshot()))
  await act(async () => {
    await mocks.controller.current.refresh('poll')
  })
  await flush()
  await render('visible')

  expect(container.querySelectorAll('[data-execution-state="completed"]')).toHaveLength(6)
  expect(container.querySelectorAll('[data-execution-state="running"]')).toHaveLength(0)
  expect(container.querySelector('button[data-status-key="ready"]')?.textContent).toContain('立即执行')
  expect(api.stopRun).not.toHaveBeenCalled()
  expect(mocks.executeScheduleNow).toHaveBeenCalledOnce()
})

it('replaces the execution progress when a submitted run finishes while hidden', async () => {
  const submission = deferred<ApiResponse>()
  mocks.executeScheduleNow.mockReturnValueOnce(submission.promise)
  const render = async (mode: 'visible' | 'hidden') => {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <Activity mode={mode}><AutomationTasks /></Activity>
      </QueryClientProvider>,
    ))
    await flush()
  }

  await render('visible')
  await act(async () => container.querySelector<HTMLButtonElement>('button[data-status-key="ready"]')?.click())
  await flush()

  expect(mocks.notifyProgress).toHaveBeenCalledWith('开始执行任务流程...', 'execution')

  await render('hidden')
  await act(async () => submission.resolve(ok({
    accepted: true,
    runId: 'run-1',
    run: dailyRun('run-1', 'running'),
  })))
  await flush()
  api.fetchSnapshot.mockResolvedValue(ok(finishedSnapshot()))
  await act(async () => {
    await mocks.controller.current.refresh('poll')
  })
  await flush()
  await render('visible')

  expect(mocks.notify).toHaveBeenCalledWith('任务流程执行完成', 'success', { id: 'execution' })
})
