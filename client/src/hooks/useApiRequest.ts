/**
 * API 请求自定义 Hook - 统一的加载状态和错误处理
 */

import { useState, useCallback } from 'react'

interface ApiRequestOptions {
  onSuccess?: (result: any) => void
  onError?: (error: Error) => void
  successMessage?: string
  errorMessage?: string
  showLoading?: boolean
}

interface UseApiRequestReturn {
  loading: boolean
  error: string | null
  data: any
  execute: (apiCall: () => Promise<any>, options?: ApiRequestOptions) => Promise<any>
  reset: () => void
}

export function useApiRequest(): UseApiRequestReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)

  const execute = useCallback(async (
    apiCall: () => Promise<any>,
    options: ApiRequestOptions = {}
  ) => {
    const {
      onSuccess,
      onError,
      successMessage,
      errorMessage = '操作失败',
      showLoading = true
    } = options

    try {
      if (showLoading) setLoading(true)
      setError(null)

      const result = await apiCall()
      setData(result)

      if (result.success) {
        if (successMessage) {
          // 可以在这里触发全局通知
          console.log('✅', successMessage)
        }
        if (onSuccess) {
          onSuccess(result)
        }
      } else {
        throw new Error(result.error || result.message || errorMessage)
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : errorMessage
      setError(errorMsg)
      console.error('❌', errorMsg)
      
      if (onError && err instanceof Error) {
        onError(err)
      }
      
      throw err
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setLoading(false)
    setError(null)
    setData(null)
  }, [])

  return {
    loading,
    error,
    data,
    execute,
    reset
  }
}

/**
 * 简化版 - 只处理加载状态
 */
export function useLoading(initialState = false): [boolean, (asyncFn: () => Promise<any>) => Promise<any>, (loading: boolean) => void] {
  const [loading, setLoading] = useState(initialState)

  const withLoading = useCallback(async (asyncFn: () => Promise<any>) => {
    setLoading(true)
    try {
      return await asyncFn()
    } finally {
      setLoading(false)
    }
  }, [])

  return [loading, withLoading, setLoading]
}
