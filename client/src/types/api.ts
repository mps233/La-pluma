/**
 * API 响应类型定义
 */

export interface ApiErrorPayload {
  code?: string
  message?: string
  details?: unknown
  retryable?: boolean
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  meta?: {
    requestId?: string | null
    dryRun?: boolean
    [key: string]: unknown
  }
  errorInfo?: ApiErrorPayload
}
