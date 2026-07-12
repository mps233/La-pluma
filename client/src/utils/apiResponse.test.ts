import { describe, expect, it } from 'vitest'
import { parseJsonResponse } from './apiResponse'

describe('parseJsonResponse', () => {
  it('parses a valid JSON response', async () => {
    const response = new Response(JSON.stringify({ success: true, data: { enabled: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(parseJsonResponse(response)).resolves.toEqual({
      success: true,
      data: { enabled: true },
    })
  })

  it('turns an empty successful response into a readable API failure', async () => {
    const result = await parseJsonResponse(new Response('', { status: 200 }))

    expect(result.success).toBe(false)
    expect(result.errorInfo?.code).toBe('EMPTY_API_RESPONSE')
    expect(result.message).toBe('服务返回了空响应，请稍后重试')
  })

  it('describes an empty proxy error as an unavailable backend', async () => {
    const result = await parseJsonResponse(new Response('', { status: 500 }))

    expect(result.success).toBe(false)
    expect(result.message).toBe('后端服务暂不可用，请确认服务已启动')
    expect(result.errorInfo?.retryable).toBe(true)
  })

  it('does not expose JSON parser errors for a non-JSON response', async () => {
    const result = await parseJsonResponse(new Response('<html>Bad gateway</html>', { status: 502 }))

    expect(result.success).toBe(false)
    expect(result.errorInfo?.code).toBe('INVALID_API_RESPONSE')
    expect(result.message).toBe('后端服务暂不可用，请确认服务已启动')
  })

  it('keeps structured Agent errors while exposing a render-safe message', async () => {
    const response = new Response(JSON.stringify({
      success: false,
      message: 'MAA 正在执行其他任务',
      error: {
        code: 'AGENT_EXECUTION_BUSY',
        details: { owner: { taskName: '仓库识别' } },
        retryable: true,
      },
      meta: { requestId: 'request-1', dryRun: false },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })

    const result = await parseJsonResponse(response)

    expect(result.error).toBe('MAA 正在执行其他任务')
    expect(result.errorInfo).toEqual({
      code: 'AGENT_EXECUTION_BUSY',
      message: 'MAA 正在执行其他任务',
      details: { owner: { taskName: '仓库识别' } },
      retryable: true,
    })
    expect(result.meta?.requestId).toBe('request-1')
  })
})
