import {
  useCallback,
  useRef,
  type TouchEvent as ReactTouchEvent,
  type TouchEventHandler as ReactTouchEventHandler,
} from 'react'

const COARSE_POINTER_QUERY = '(pointer: coarse)'
const PHONE_WIDTH_QUERY = '(max-width: 639px)'
const DEFAULT_SWIPE_THRESHOLD = 56

export const DEFAULT_SWIPE_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[contenteditable="true"]',
  'video',
  '.screen-monitor',
  '.scrcpy-device-container',
  '.combat-mode-shell',
  '[data-swipe-ignore]',
].join(', ')

export interface SwipePagerCommit {
  /** 1 = next page (swipe left), -1 = previous page (swipe right). */
  direction: 1 | -1
  nextIndex: number
}

export interface UseSwipePagerOptions {
  count: number
  index: number
  onChange: (index: number) => void
  threshold?: number
  enabled?: boolean
  ignoreSelector?: string
  /** Appended to the ignore list, e.g. the page's own segmented control shell. */
  extraIgnoreSelector?: string
  /** Called while a horizontal gesture is in progress, with the raw delta. */
  onMove?: (offsetX: number) => void
  /**
   * When provided, the hook reports the gesture instead of changing the index.
   * The consumer owns the exit/enter animation and its final onChange call.
   */
  onRelease?: (commit: SwipePagerCommit | null) => void
}

export type SwipePagerHandlers<T extends HTMLElement = HTMLElement> = {
  onTouchStart: ReactTouchEventHandler<T>
  onTouchMove: ReactTouchEventHandler<T>
  onTouchEnd: ReactTouchEventHandler<T>
  onTouchCancel: ReactTouchEventHandler<T>
}

function isMobileSwipeViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_POINTER_QUERY).matches
    || window.matchMedia(PHONE_WIDTH_QUERY).matches
}

function hasHorizontalScroll(target: Element, boundary: Element | null): boolean {
  let element: Element | null = target
  while (element && element !== boundary) {
    const style = window.getComputedStyle(element)
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) {
      return true
    }
    element = element.parentElement
  }
  return false
}

/**
 * Adds horizontal swipe paging to a container on touch/mobile layouts.
 * The gesture is intentionally conservative: it ignores interactive controls,
 * the device preview, nested horizontal scrollers, and mostly-vertical drags.
 */
export function useSwipePager<T extends HTMLElement = HTMLElement>({
  count,
  index,
  onChange,
  threshold = DEFAULT_SWIPE_THRESHOLD,
  enabled,
  ignoreSelector = DEFAULT_SWIPE_IGNORE_SELECTOR,
  extraIgnoreSelector,
  onMove,
  onRelease,
}: UseSwipePagerOptions): SwipePagerHandlers<T> {
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = useCallback((event: ReactTouchEvent<T>) => {
    startRef.current = null
    if (enabled === false) return
    if (enabled !== true && !isMobileSwipeViewport()) return
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    if (!touch) return

    const target = event.target instanceof Element ? event.target : null
    const selector = extraIgnoreSelector
      ? `${ignoreSelector}, ${extraIgnoreSelector}`
      : ignoreSelector
    if (!target || target.closest(selector)) return
    if (hasHorizontalScroll(target, event.currentTarget)) return

    startRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }, [enabled, ignoreSelector, extraIgnoreSelector])

  const onTouchMove = useCallback((event: ReactTouchEvent<T>) => {
    const start = startRef.current
    if (!start || event.touches.length !== 1) return
    const touch = event.touches[0]
    if (!touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return
    onMove?.(deltaX)
  }, [onMove])

  const onTouchEnd = useCallback((event: ReactTouchEvent<T>) => {
    const start = startRef.current
    startRef.current = null
    if (!start || event.changedTouches.length !== 1) {
      onRelease?.(null)
      return
    }

    const touch = event.changedTouches[0]
    if (!touch) {
      onRelease?.(null)
      return
    }
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) {
      onRelease?.(null)
      return
    }

    const direction: 1 | -1 = deltaX < 0 ? 1 : -1
    const nextIndex = Math.min(count - 1, Math.max(0, index + direction))
    const commit: SwipePagerCommit | null = nextIndex === index ? null : { direction, nextIndex }
    if (onRelease) {
      onRelease(commit)
      return
    }
    if (commit) onChange(commit.nextIndex)
  }, [count, index, onChange, onRelease, threshold])

  const onTouchCancel = useCallback(() => {
    startRef.current = null
    onRelease?.(null)
  }, [onRelease])

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}