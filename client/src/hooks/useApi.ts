/**
 * 统一的 API 调用 Hook
 * 提供加载状态、错误处理、自动重试等功能
 */

import { useState, useCallback } from 'react'
import { adaptApiResponse, extractData, extractError } from '../utils/apiAdapter'

interface UseApiOptions<T = any> {
  onSuccess?: (data: T, response: any) => void
  onError?: (error: string, response: any) => void
  initialData?: T | null
  dataKey?: string | null
}

interface ApiResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

interface UseApiReturn<T = any> {
  data: T | null
  loading: boolean
  error: string | null
  execute: (...args: any[]) => Promise<ApiResult<T>>
  reset: () => void
}

/**
 * API 调用 Hook
 * @param apiFunction - API 函数
 * @param options - 配置选项
 * @returns { data, loading, error, execute, reset }
 */
export function useApi<T = any>(
  apiFunction: (...args: any[]) => Promise<any>,
  options: UseApiOptions<T> = {}
): UseApiReturn<T> {
  const {
    onSuccess,
    onError,
    initialData = null,
    dataKey = null,
  } = options

  const [data, setData] = useState<T | null>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (...args: any[]): Promise<ApiResult<T>> => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiFunction(...args)
      const adapted = adaptApiResponse(response)

      if (adapted.success) {
        const extractedData = dataKey ? extractData(response, dataKey) : adapted.data
        setData(extractedData)
        
        if (onSuccess) {
          onSuccess(extractedData, adapted)
        }
        
        return { success: true, data: extractedData }
      } else {
        const errorMsg = extractError(response)
        setError(errorMsg)
        
        if (onError) {
          onError(errorMsg, adapted)
        }
        
        return { success: false, error: errorMsg }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      setError(errorMsg)
      
      if (onError) {
        onError(errorMsg, err)
      }
      
      return { success: false, error: errorMsg }
    } finally {
      setLoading(false)
    }
  }, [apiFunction, dataKey, onSuccess, onError])

  const reset = useCallback(() => {
    setData(initialData)
    setError(null)
    setLoading(false)
  }, [initialData])

  return {
    data,
    loading,
    error,
    execute,
    reset,
  }
}

interface UseApiMutationOptions {
  onSuccess?: (data: any, response: any) => void
  onError?: (error: string, response: any) => void
}

interface UseApiMutationReturn {
  loading: boolean
  error: string | null
  execute: (...args: any[]) => Promise<ApiResult>
}

/**
 * 简化的 API 调用 Hook（不保存数据）
 * 适用于只需要执行操作，不需要保存响应数据的场景
 */
export function useApiMutation(
  apiFunction: (...args: any[]) => Promise<any>,
  options: UseApiMutationOptions = {}
): UseApiMutationReturn {
  const { onSuccess, onError } = options
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (...args: any[]): Promise<ApiResult> => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiFunction(...args)
      const adapted = adaptApiResponse(response)

      if (adapted.success) {
        if (onSuccess) {
          onSuccess(adapted.data, adapted)
        }
        return { success: true, data: adapted.data }
      } else {
        const errorMsg = extractError(response)
        setError(errorMsg)
        
        if (onError) {
          onError(errorMsg, adapted)
        }
        
        return { success: false, error: errorMsg }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      setError(errorMsg)
      
      if (onError) {
        onError(errorMsg, err)
      }
      
      return { success: false, error: errorMsg }
    } finally {
      setLoading(false)
    }
  }, [apiFunction, onSuccess, onError])

  return {
    loading,
    error,
    execute,
  }
}
