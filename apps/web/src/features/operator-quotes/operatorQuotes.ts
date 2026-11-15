import { API_BASE_URL, fetchWithAuth, parseJsonResponse } from '@/shared/api'

export interface OperatorQuote {
  operatorId: string
  operator: string
  quote: string
}

export const DEFAULT_OPERATOR_QUOTE: OperatorQuote = {
  operatorId: 'char_002_amiya',
  operator: '阿米娅',
  quote: '今天也请多指教',
}

let cachedDailyQuote: OperatorQuote | null = null
let dailyQuoteRequest: Promise<OperatorQuote> | null = null

const asOperatorQuote = (value: unknown): OperatorQuote | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const payload = value as Record<string, unknown>
  const candidate = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload
  const operatorId = String(candidate.operatorId || '').trim()
  const operator = String(candidate.operator || '').trim()
  const quote = String(candidate.quote || '').trim()

  if (!operator || !quote || !operatorId) return null
  return { operatorId, operator, quote }
}

export { getOperatorAvatarUrl } from '@/features/game-data'

export function loadDailyOperatorQuote(): Promise<OperatorQuote> {
  if (cachedDailyQuote) return Promise.resolve(cachedDailyQuote)
  if (dailyQuoteRequest) return dailyQuoteRequest

  const request = fetchWithAuth(`${API_BASE_URL}/operator-quotes/daily`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return parseJsonResponse<unknown>(response)
    })
    .then(payload => asOperatorQuote(payload) ?? DEFAULT_OPERATOR_QUOTE)
    .catch(() => DEFAULT_OPERATOR_QUOTE)
    .then((quote) => {
      cachedDailyQuote = quote
      return quote
    })

  dailyQuoteRequest = request
  request.finally(() => {
    dailyQuoteRequest = null
  })
  return request
}
