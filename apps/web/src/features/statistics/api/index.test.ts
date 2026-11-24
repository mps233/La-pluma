// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDropStatistics,
  getOpenTodayStages,
  getTodayDrops,
  parseDepotData,
  parseOperBoxData,
} from './index'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const fetchCall = (index = 0) => {
  const [input, init] = vi.mocked(globalThis.fetch).mock.calls[index]!
  return { input, init: init as RequestInit }
}

describe('statistics resource reads', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps a server success=false envelope as a typed failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: false,
      message: '读取掉落统计失败',
      error: { code: 'AGENT_DROPS_READ_FAILED', retryable: true },
    }, 503))
    const controller = new AbortController()

    const result = await getDropStatistics(30, controller.signal)

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/drops/statistics?days=30')
    expect(fetchCall().init.signal).toBe(controller.signal)
    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'AGENT_DROPS_READ_FAILED',
      kind: 'api',
      status: 503,
      retryable: true,
    })
  })

  it('keeps the legacy today-drops array shape used by the dashboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: [{ stage: '1-7', stageName: '主线 1-7', drops: [{ name: '固源岩', count: 5 }] }],
    }))
    const controller = new AbortController()

    const result = await getTodayDrops(controller.signal)

    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/drops/today')
    expect(fetchCall().init.signal).toBe(controller.signal)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
  })

  it('rejects a drop statistics payload whose total omits medicine and stone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: {
        total: { sanity: 2456, battles: 89 },
        items: { 固源岩: { count: 145 } },
        stages: { '1-7': { battles: 42, sanity: 336, items: { 固源岩: 61 } } },
        dateRange: { start: '2026-10-18', end: '2026-10-24', days: 7 },
      },
    }))

    const result = await getDropStatistics(7)

    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'INVALID_DOMAIN_PAYLOAD',
      message: '掉落统计数据格式不正确',
    })
  })

  it('rejects a drop statistics payload whose stage omits item counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: {
        total: { sanity: 2456, battles: 89, medicine: 12, stone: 3 },
        items: { 固源岩: { count: 145 } },
        stages: { '1-7': { battles: 42, sanity: 336 } },
        dateRange: { start: '2026-10-18', end: '2026-10-24', days: 7 },
      },
    }))

    const result = await getDropStatistics(7)

    expect(result.success).toBe(false)
    expect(result.errorInfo).toMatchObject({
      code: 'INVALID_DOMAIN_PAYLOAD',
      message: '掉落统计数据格式不正确',
    })
  })

  it('accepts a drop statistics payload with the four required totals and stage items', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: {
        total: { sanity: 2456, battles: 89, medicine: 12, stone: 3 },
        items: { 固源岩: { count: 145 } },
        stages: { '1-7': { battles: 42, sanity: 336, items: { 固源岩: 61 } } },
        dateRange: { start: '2026-10-18', end: '2026-10-24', days: 7 },
      },
    }))

    const result = await getDropStatistics(7)

    expect(result.success).toBe(true)
    expect(result.data?.items).toEqual({ 固源岩: { count: 145 } })
  })

  it('rejects a service error envelope that the route wrapped as success data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { success: false, message: '获取掉落统计失败' },
    }))

    const result = await getDropStatistics(7)

    expect(result.success).toBe(false)
    expect(result.errorInfo?.code).toBe('INVALID_DOMAIN_PAYLOAD')
  })

  it('validates open today stages and keeps open/closed arrays', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      data: { weekday: 1, open: [{ stage: 'CE-6' }], closed: [] },
    }))

    const result = await getOpenTodayStages()

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ weekday: 1, open: [{ stage: 'CE-6' }], closed: [] })
  })

  it('forwards the abort signal to recognition parsing commands without an extra body', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
      success: true,
      data: { itemCount: 1, items: [] },
    }))
    const controller = new AbortController()

    await parseDepotData(controller.signal)
    await parseOperBoxData(controller.signal)

    expect(fetchCall(0).input).toBe('http://localhost:3000/api/agent/actions/depot-recognition')
    expect(fetchCall(0).init.signal).toBe(controller.signal)
    expect(fetchCall(0).init.method).toBe('POST')
    expect(fetchCall(0).init.body).toBeUndefined()
    expect(fetchCall(1).input).toBe('http://localhost:3000/api/agent/actions/operbox-recognition')
    expect(fetchCall(1).init.signal).toBe(controller.signal)
    expect(fetchCall(1).init.method).toBe('POST')
  })

  it.each([
    ['depot', parseDepotData],
    ['operbox', parseOperBoxData],
  ])('preserves a retryable no-result response for %s recognition', async (_, parse) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: false,
      message: '未找到有效识别结果',
      error: { code: 'AGENT_RECOGNITION_NO_RESULT', details: {}, retryable: true },
    }, 422))

    await expect(parse()).resolves.toMatchObject({
      success: false,
      errorInfo: { code: 'AGENT_RECOGNITION_NO_RESULT', retryable: true },
    })
  })

  it('forwards the abort signal for open stage reads without issuing a mutation', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError)
    const controller = new AbortController()

    const error = await getOpenTodayStages(controller.signal).catch(value => value)

    expect(error).toBe(abortError)
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
    expect(fetchCall().input).toBe('http://localhost:3000/api/agent/stages/open-today')
    expect(fetchCall().init.signal).toBe(controller.signal)
    expect(fetchCall().init.method).toBeUndefined()
  })
})
