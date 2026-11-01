import { API_BASE_URL, fetchWithAuth, parseJsonResponse } from './api'

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

export const DEFAULT_RANDOM_OPERATOR_QUOTE: OperatorQuote = {
  operatorId: 'doctor',
  operator: '博士',
  quote: '准备就绪',
}

const RANDOM_FALLBACK_QUOTES: OperatorQuote[] = [
  DEFAULT_RANDOM_OPERATOR_QUOTE,
  DEFAULT_OPERATOR_QUOTE,
  { operatorId: 'char_003_kalts', operator: '凯尔希', quote: '作战记录已归档' },
  { operatorId: 'char_010_chen', operator: '陈', quote: '任务简报已经确认' },
  { operatorId: 'char_103_angel', operator: '能天使', quote: '补给检查完成' },
  { operatorId: 'char_180_amgoat', operator: '艾雅法拉', quote: '数据采集稳定' },
  { operatorId: 'char_202_demkni', operator: '塞雷娅', quote: '防护流程正常' },
  { operatorId: 'char_377_gdglow', operator: '澄闪', quote: '信号稳定，可以开始' },
]

let cachedDailyQuote: OperatorQuote | null = null
let dailyQuoteRequest: Promise<OperatorQuote> | null = null
let cachedRandomQuote: OperatorQuote | null = null
let randomQuoteRequest: Promise<OperatorQuote> | null = null

const asOperatorQuote = (value: unknown, allowMissingOperatorId = false): OperatorQuote | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const payload = value as Record<string, unknown>
  const candidate = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload
  const operatorId = String(candidate.operatorId || '').trim()
  const operator = String(candidate.operator || '').trim()
  const quote = String(candidate.quote || '').trim()

  if (!operator || !quote || (!operatorId && !allowMissingOperatorId)) return null
  return { operatorId: operatorId || operator, operator, quote }
}

export const getOperatorAvatarUrl = (operatorId: string) =>
  `${API_BASE_URL}/maa-assets/avatar/${encodeURIComponent(operatorId)}`

function loadQuote(
  path: 'daily' | 'random',
  fallback: OperatorQuote,
  allowMissingOperatorId: boolean,
): Promise<OperatorQuote> {
  const cachedQuote = path === 'daily' ? cachedDailyQuote : cachedRandomQuote
  const pendingRequest = path === 'daily' ? dailyQuoteRequest : randomQuoteRequest
  if (cachedQuote) return Promise.resolve(cachedQuote)
  if (pendingRequest) return pendingRequest

  const request = fetchWithAuth(`${API_BASE_URL}/operator-quotes/${path}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return parseJsonResponse<unknown>(response)
    })
    .then(payload => asOperatorQuote(payload, allowMissingOperatorId) ?? fallback)
    .catch(() => fallback)
    .then((quote) => {
      if (path === 'daily') cachedDailyQuote = quote
      else cachedRandomQuote = quote
      return quote
    })

  if (path === 'daily') {
    dailyQuoteRequest = request
    request.finally(() => {
      dailyQuoteRequest = null
    })
  } else {
    randomQuoteRequest = request
    request.finally(() => {
      randomQuoteRequest = null
    })
  }

  return request
}

export function loadDailyOperatorQuote(): Promise<OperatorQuote> {
  return loadQuote('daily', DEFAULT_OPERATOR_QUOTE, false)
}

export function loadRandomOperatorQuote(): Promise<OperatorQuote> {
  if (cachedRandomQuote) return Promise.resolve(cachedRandomQuote)
  if (randomQuoteRequest) return randomQuoteRequest
  const fallback = RANDOM_FALLBACK_QUOTES[Math.floor(Math.random() * RANDOM_FALLBACK_QUOTES.length)] ?? DEFAULT_RANDOM_OPERATOR_QUOTE
  return loadQuote('random', fallback, true)
}
