import { useEffect, useRef, type RefObject } from 'react'

const USER_SCROLL_SUPPRESS_MS = 500
const OWN_SCROLL_GUARD_MS = 200

/**
 * 把当前执行行滚入视野，但不在用户刚手动浏览列表时抢滚动位置。
 * 调用方渲染滚动容器并给行加 `data-copilot-item-index`。
 */
export function useCopilotItemFollow({
  currentIndex,
  enabled,
}: {
  currentIndex: number | null
  enabled: boolean
}): RefObject<HTMLDivElement | null> {
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastUserScrollAtRef = useRef(0)
  const ownScrollUntilRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const list = listRef.current
    if (!list) return

    const handleScroll = () => {
      if (Date.now() < ownScrollUntilRef.current) return
      lastUserScrollAtRef.current = Date.now()
    }
    list.addEventListener('scroll', handleScroll, { passive: true })
    return () => list.removeEventListener('scroll', handleScroll)
  }, [enabled])

  useEffect(() => {
    if (!enabled || currentIndex === null) return
    const list = listRef.current
    if (!list) return
    if (Date.now() - lastUserScrollAtRef.current < USER_SCROLL_SUPPRESS_MS) return
    const row = list.querySelector<HTMLElement>(`[data-copilot-item-index="${currentIndex}"]`)
    if (!row || typeof row.scrollIntoView !== 'function') return
    ownScrollUntilRef.current = Date.now() + OWN_SCROLL_GUARD_MS
    row.scrollIntoView({ block: 'nearest' })
  }, [currentIndex, enabled])

  return listRef
}
