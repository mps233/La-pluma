/**
 * API 响应类型定义
 */

interface ApiErrorPayload {
  code?: string
  message?: string
  details?: any
  retryable?: boolean
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  meta?: {
    requestId?: string | null
    dryRun?: boolean
    [key: string]: any
  }
  errorInfo?: ApiErrorPayload
}
