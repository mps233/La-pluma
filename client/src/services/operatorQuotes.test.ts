import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
}))

vi.mock('./api', () => ({
  API_BASE_URL: '/api',
  fetchWithAuth: mocks.fetchWithAuth,
  parseJsonResponse: mocks.parseJsonResponse,
}))

describe('operator quote service', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchWithAuth.mockReset()
    mocks.parseJsonResponse.mockReset()
    mocks.fetchWithAuth.mockResolvedValue({ ok: true })
  })

  it('loads and caches the daily operator identity', async () => {
    mocks.parseJsonResponse.mockResolvedValue({
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    })
    const { loadDailyOperatorQuote } = await import('./operatorQuotes')

    await expect(loadDailyOperatorQuote()).resolves.toEqual({
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    })
    await expect(loadDailyOperatorQuote()).resolves.toEqual({
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    })
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1)
    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/operator-quotes/daily')
  })

  it('falls back to Amiya when the response is unavailable or incomplete', async () => {
    mocks.parseJsonResponse.mockResolvedValue({
      operator: '未知干员',
      quote: '无法解析头像',
    })
    const { DEFAULT_OPERATOR_QUOTE, loadDailyOperatorQuote } = await import('./operatorQuotes')

    await expect(loadDailyOperatorQuote()).resolves.toEqual(DEFAULT_OPERATOR_QUOTE)
  })

  it('builds an encoded operator avatar URL', async () => {
    const { getOperatorAvatarUrl } = await import('./operatorQuotes')
    expect(getOperatorAvatarUrl('char_002 amiya')).toBe(
      'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/char_002%20amiya.png',
    )
  })
})
