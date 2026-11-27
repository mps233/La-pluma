import { useCallback, useEffect, useRef, useState } from 'react'

/** How far the page must travel in one direction before the bar folds or opens. */
export const FOLD_DISTANCE = 8
/** Hold a new state a little longer than its 280 ms animation before reversing. */
export const FOLD_LATCH_MS = 320
/** Opening is immediate this close to the top of the page. */
export const FOLD_TOP_OPEN = 48

export interface FoldScrollSample {
  scrollTop: number
  maxScrollTop: number
  viewportHeight: number
}

export interface FoldTracker {
  folded: boolean
  lastTop: number
  travel: number
  latchedAt: number
}

export function createFoldTracker(): FoldTracker {
  return { folded: false, lastTop: 0, travel: 0, latchedAt: Number.NEGATIVE_INFINITY }
}

/**
 * Folds the tab bar after 8 px of downward travel and opens it after 8 px up,
 * or as soon as a folded bar is within 48 px of the top. The bounce past either
 * end and a jump of more than one screen (a restored position, a jump to a
 * section) do not count. Each new state is latched for longer than its
 * animation so the plate never turns round halfway.
 */
export function sampleFold(
  tracker: FoldTracker,
  sample: FoldScrollSample,
  now: number,
  canFold: boolean,
): FoldTracker {
  const { scrollTop, maxScrollTop, viewportHeight } = sample
  const delta = scrollTop - tracker.lastTop

  // The bounce past either end and a jump of more than one screen (a restored
  // position, a jump to a section) are not scrolling the person did. Being
  // within 48 px of the top still opens the bar, even at the very top.
  if (scrollTop <= 0 || scrollTop >= maxScrollTop || Math.abs(delta) > viewportHeight) {
    if (tracker.folded && scrollTop <= FOLD_TOP_OPEN) {
      return { folded: false, lastTop: scrollTop, travel: 0, latchedAt: now }
    }
    return { ...tracker, lastTop: scrollTop, travel: 0 }
  }

  let travel = tracker.travel
  if (Math.sign(delta) !== Math.sign(travel)) travel = 0
  travel += delta

  // Near the top the bar opens at once; the latch only exists to keep a fold
  // or opening from being reversed halfway through its animation.
  if (tracker.folded && scrollTop <= FOLD_TOP_OPEN) {
    return { folded: false, lastTop: scrollTop, travel: 0, latchedAt: now }
  }

  if (now - tracker.latchedAt < FOLD_LATCH_MS) {
    return { ...tracker, lastTop: scrollTop, travel }
  }

  if (!tracker.folded && canFold && travel >= FOLD_DISTANCE) {
    return { folded: true, lastTop: scrollTop, travel: 0, latchedAt: now }
  }
  if (tracker.folded && travel <= -FOLD_DISTANCE) {
    return { folded: false, lastTop: scrollTop, travel: 0, latchedAt: now }
  }

  return { ...tracker, lastTop: scrollTop, travel }
}

/**
 * Wires the tracker to the page's scroll host. `open` is called when the
 * folded bar is tapped, a key inside it takes focus, or the view changes.
 */
export function useTabBarFold() {
  const [folded, setFolded] = useState(false)
  const trackerRef = useRef(createFoldTracker())
  const barRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const host = document.querySelector<HTMLElement>('.la-pluma-scroll-host')
    if (!host) return undefined

    const onScroll = () => {
      const canFold = !barRef.current?.contains(document.activeElement)
      const next = sampleFold(trackerRef.current, {
        scrollTop: host.scrollTop,
        maxScrollTop: Math.max(0, host.scrollHeight - host.clientHeight),
        viewportHeight: host.clientHeight,
      }, performance.now(), canFold)
      const changed = next.folded !== trackerRef.current.folded
      trackerRef.current = next
      if (changed) setFolded(next.folded)
    }

    host.addEventListener('scroll', onScroll, { passive: true })
    return () => host.removeEventListener('scroll', onScroll)
  }, [])

  const open = useCallback(() => {
    if (!trackerRef.current.folded) return
    trackerRef.current = {
      ...trackerRef.current,
      folded: false,
      travel: 0,
      latchedAt: performance.now(),
    }
    setFolded(false)
  }, [])

  return { folded, open, barRef }
}
