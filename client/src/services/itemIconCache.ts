let itemIconCacheVersion = 0

/** 资源更新后推进图标版本；页面订阅此版本重新生成图标 URL。 */
export function bumpItemIconCacheVersion(): number {
  itemIconCacheVersion += 1
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('item-icon-cache-updated', { detail: itemIconCacheVersion }))
  }
  return itemIconCacheVersion
}

export function getItemIconCacheVersion(): number {
  return itemIconCacheVersion
}
