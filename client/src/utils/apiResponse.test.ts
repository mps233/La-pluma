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
})
