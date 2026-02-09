/**
 * Store 错误处理工具
 */

export function createErrorHandler(storeName: string) {
  return (error: Error, context: string) => {
    console.error(`[${storeName}] Error in ${context}:`, error)
    
    // 发送错误到监控服务（如果有）
    if (typeof window !== 'undefined' && (window as any).errorTracker) {
      (window as any).errorTracker.captureException(error, {
        tags: { store: storeName, context }
      })
    }
    
    // 显示用户友好的错误消息
    // 注意：这里不能直接导入 useUIStore，会造成循环依赖
    // 所以我们通过事件系统来通知 UI
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('store-error', {
        detail: {
          store: storeName,
          context,
          message: error.message
        }
      }))
    }
  }
}

/**
 * 包装异步操作，自动处理错误
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorHandler: (error: Error, context: string) => void,
  context: string,
  defaultValue?: T
): Promise<T | undefined> {
  try {
    return await operation()
  } catch (error) {
    errorHandler(error as Error, context)
    return defaultValue
  }
}
