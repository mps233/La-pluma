'use client'

import { useEffect, useState } from 'react'

// Local performance patch: the glass engine is loaded after first paint, or on
// the first interaction. Hosts keep the kit's CSS fallback until then, so the
// steady-state appearance is unchanged.
const IDLE_MS = 900

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export function useDeferredGlassComponent<T>(loader: () => Promise<T>): T | null {
  const [loaded, setLoaded] = useState<{ value: T } | null>(null)

  useEffect(() => {
    let cancelled = false
    const show = () => {
      void loader()
        .then((value) => {
          if (!cancelled) setLoaded({ value })
        })
        .catch(() => undefined)
    }
    const onInteract = () => show()
    window.addEventListener('pointerdown', onInteract, { capture: true, once: true })
    window.addEventListener('focusin', onInteract, { once: true })
    window.addEventListener('keydown', onInteract, { once: true })

    const idleWindow = window as IdleWindow
    let idleHandle: number | null = null
    let timer: number | null = null
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(show, { timeout: IDLE_MS })
    } else {
      timer = window.setTimeout(show, IDLE_MS / 2)
    }

    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', onInteract, { capture: true })
      window.removeEventListener('focusin', onInteract)
      window.removeEventListener('keydown', onInteract)
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [loader])

  return loaded?.value ?? null
}
