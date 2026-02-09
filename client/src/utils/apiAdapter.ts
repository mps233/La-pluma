/**
 * API 响应格式适配器
 * 统一处理新旧两种响应格式
 */

interface ApiResponse {
  success: boolean
  data: any
  message?: string
  error?: string
}

/**
 * 适配 API 响应格式
 * @param response - API 响应
 * @returns 标准化的响应对象
 */
export function adaptApiResponse(response: any): ApiResponse {
  if (!response) {
    return { success: false, data: null, message: '无响应' }
  }

  // 如果已经是标准格式，直接返回
  if (response.success !== undefined) {
    return {
      success: response.success,
      data: response.data,
      message: response.message || (response.success ? '操作成功' : '操作失败'),
      error: response.error
    }
  }

  // 兼容旧格式
  return {
    success: true,
    data: response,
    message: '操作成功'
  }
}

/**
 * 从响应中提取数据
 * 自动处理 data 嵌套
 * @param response - API 响应
 * @param key - 可选的数据键名
 * @returns 提取的数据
 */
export function extractData(response: any, key: string | null = null): any {
  const adapted = adaptApiResponse(response)
  
  if (!adapted.success) {
    return null
  }

  const data = adapted.data
  
  // 如果指定了 key，尝试从 data 中提取
  if (key && data && typeof data === 'object') {
    return data[key] !== undefined ? data[key] : data
  }

  return data
}

/**
 * 提取错误消息
 * @param response - API 响应
 * @returns 错误消息
 */
export function extractError(response: any): string {
  const adapted = adaptApiResponse(response)
  return adapted.error || adapted.message || '未知错误'
}

/**
 * 检查响应是否成功
 * @param response - API 响应
 * @returns 是否成功
 */
export function isSuccess(response: any): boolean {
  const adapted = adaptApiResponse(response)
  return adapted.success === true
}
