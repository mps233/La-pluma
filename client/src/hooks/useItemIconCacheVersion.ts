import { useEffect, useState } from 'react'
import { getItemIconCacheVersion } from '../services/itemIconCache'

/** 订阅资源更新后的图标缓存版本；版本变化会让调用方重新生成图标地址。 */
export function useItemIconCacheVersion(): number {
  const [version, setVersion] = useState(() => getItemIconCacheVersion())

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail
      setVersion(typeof detail === 'number' ? detail : getItemIconCacheVersion())
    }
    window.addEventListener('item-icon-cache-updated', handleUpdate)
    return () => window.removeEventListener('item-icon-cache-updated', handleUpdate)
  }, [])

  return version
}
