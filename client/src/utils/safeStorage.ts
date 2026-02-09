/**
 * 安全的 localStorage 操作工具
 */

/**
 * 安全地从 localStorage 获取数据
 */
export function safeGetItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key)
    if (!item) return defaultValue
    
    const parsed = JSON.parse(item)
    
    // 验证数据类型
    if (typeof parsed !== typeof defaultValue) {
      console.warn(`Invalid type for ${key}, using default`)
      return defaultValue
    }
    
    return parsed
  } catch (error) {
    console.error(`Failed to get ${key} from localStorage:`, error)
    return defaultValue
  }
}

/**
 * 安全地设置 localStorage 数据
 */
export function safeSetItem<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Failed to set ${key} in localStorage:`, error)
    
    // 如果是 QuotaExceededError，尝试清理旧数据
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      cleanupOldStorage()
      // 重试一次
      try {
        localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (retryError) {
        console.error(`Retry failed for ${key}:`, retryError)
        return false
      }
    }
    
    return false
  }
}

/**
 * 安全地移除 localStorage 数据
 */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch (error) {
    console.error(`Failed to remove ${key} from localStorage:`, error)
    return false
  }
}

/**
 * 清理过期的 localStorage 数据
 */
export function cleanupOldStorage(): void {
  const keys = Object.keys(localStorage)
  const now = Date.now()
  const maxAge = 30 * 24 * 60 * 60 * 1000 // 30 天
  
  keys.forEach(key => {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '{}')
      if (data.timestamp && now - data.timestamp > maxAge) {
        localStorage.removeItem(key)
        console.log(`Removed expired storage key: ${key}`)
      }
    } catch (error) {
      // 损坏的数据，删除
      localStorage.removeItem(key)
      console.log(`Removed corrupted storage key: ${key}`)
    }
  })
}

/**
 * 清理所有 localStorage 数据
 */
export function clearAllStorage(): void {
  try {
    localStorage.clear()
    console.log('Cleared all localStorage data')
  } catch (error) {
    console.error('Failed to clear localStorage:', error)
  }
}

/**
 * 获取 localStorage 使用情况
 */
export function getStorageUsage(): { used: number; total: number; percentage: number } {
  let used = 0
  
  try {
    // 计算已使用空间
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length
      }
    }
    
    // 大多数浏览器的 localStorage 限制是 5MB
    const total = 5 * 1024 * 1024
    const percentage = (used / total) * 100
    
    return { used, total, percentage }
  } catch (error) {
    console.error('Failed to get storage usage:', error)
    return { used: 0, total: 0, percentage: 0 }
  }
}
