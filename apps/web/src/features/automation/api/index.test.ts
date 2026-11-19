// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskFlowWireItem } from '../types'
import { getActivity, getScheduleExecutionStatus, executeScheduleNow } from './index'

const startupTask: TaskFlowWireItem = {
  id: 'startup-1',
  name: '启动游戏',
  commandId: 'startup',
  params: {},
  enabled: true,
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const readHeaders = (init: RequestInit) => new Headers(init.headers)

const fetchCall = (index = 0) => {
  const [input, init] = vi.mocked(globalThis.fetch).mock.calls[index]!
  return { input, init: init as RequestInit }
}

describe('automation schedule execution api', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, data: null }))
  })

  it('keeps the legacy synchronous call unchanged', async () => {
    await executeScheduleNow('default', [startupTask])

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/schedules/default/execute')
    expect(fetchCall().init.method).toBe('POST')
    expect(readHeaders(fetchCall().init).get('Idempotency-Key')).toBeNull()
    expect(JSON.parse(fetchCall().init.body as string)).toEqual({ taskFlow: [startupTask] })
  })

  it('requests background execution with the controller idempotency key', async () => {
    const signal = new AbortController().signal
    await executeScheduleNow('manual', [startupTask], {
      waitForCompletion: false,
      idempotencyKey: 'run_daily_flow-20261025-01',
      signal,
    })

    expect(readHeaders(fetchCall().init).get('Idempotency-Key')).toBe('run_daily_flow-20261025-01')
    expect(fetchCall().init.signal).toBe(signal)
    expect(JSON.parse(fetchCall().init.body as string)).toEqual({
      taskFlow: [startupTask],
      waitForCompletion: false,
    })
  })
})

describe('automation resource reads', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('passes the activity signal to fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { code: 'ACT', name: '当前活动', available: true, stages: [] },
    }))
    const controller = new AbortController()

    const result = await getActivity('Official', controller.signal)

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/activity?clientType=Official')
    expect(fetchCall().init.signal).toBe(controller.signal)
    expect(result.success).toBe(true)
    expect(result.data?.code).toBe('ACT')
  })

  it('omits the query string when the client type is undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { code: 'ACT', name: '当前活动', available: true, stages: [] },
    }))
    const controller = new AbortController()

    await getActivity(undefined, controller.signal)

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/activity')
    expect(fetchCall().init.signal).toBe(controller.signal)
  })

  it('turns a malformed activity payload into a domain failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: 'not-an-object',
    }))

    const result = await getActivity()

    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'INVALID_DOMAIN_PAYLOAD',
      message: '活动信息格式不正确',
    })
  })

  it('passes the schedule status signal to fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { isRunning: false, lastResult: 'success' },
    }))
    const controller = new AbortController()

    const result = await getScheduleExecutionStatus(controller.signal)

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/schedules/execution')
    expect(fetchCall().init.signal).toBe(controller.signal)
    expect(result.success).toBe(true)
  })

  it('keeps a server schedule failure as a typed failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: false,
      message: '调度服务不可用',
      error: { code: 'AGENT_SCHEDULE_UNAVAILABLE', retryable: true },
    }, 503))

    const result = await getScheduleExecutionStatus()

    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'AGENT_SCHEDULE_UNAVAILABLE',
      kind: 'api',
      status: 503,
      retryable: true,
    })
  })
})
