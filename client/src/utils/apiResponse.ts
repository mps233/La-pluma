import type { ApiResponse } from '@/types/api'

const getResponseFailureMessage = (response: Response, hasBody: boolean) => {
  if (response.status >= 500) {
    return '后端服务暂不可用，请确认服务已启动'
  }

  if (response.status === 401 || response.status === 403) {
    return '访问验证失败，请检查连接配置'
  }

  if (response.status === 404) {
    return '请求的接口不存在，请刷新页面后重试'
  }

  if (!response.ok) {
    return `请求失败（HTTP ${response.status}）`
  }

  return hasBody ? '服务返回了无法识别的数据' : '服务返回了空响应，请稍后重试'
}

const createFailureResponse = <T>(response: Response, hasBody: boolean): T => {
  const message = getResponseFailureMessage(response, hasBody)
  const result: ApiResponse = {
    success: false,
    error: message,
    message,
    errorInfo: {
      code: hasBody ? 'INVALID_API_RESPONSE' : 'EMPTY_API_RESPONSE',
      message,
      details: { status: response.status },
      retryable: response.status >= 500,
    },
  }

  return result as T
}

export async function parseJsonResponse<T = ApiResponse>(response: Response): Promise<T> {
  const body = await response.text()
  const trimmedBody = body.trim()

  if (!trimmedBody) {
    return createFailureResponse<T>(response, false)
  }

  try {
    return JSON.parse(trimmedBody) as T
  } catch {
    return createFailureResponse<T>(response, true)
  }
}
