import { lazy, Suspense, useEffect, useState } from 'react'

const IslandLayer = lazy(() => import('./IslandLayer'))

/**
 * Mounts the island after the first frame. The chrome layer is absolutely
 * positioned, so deferring it does not shift the page; the win is keeping the
 * island surface and its icon package out of the entry chunk.
 */
export default function IslandHost() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const show = () => {
      if (!cancelled) setReady(true)
    }
    const useFrame = typeof window.requestAnimationFrame === 'function'
    const frame = useFrame
      ? window.requestAnimationFrame(show)
      : window.setTimeout(show, 0)
    return () => {
      cancelled = true
      if (useFrame) window.cancelAnimationFrame(frame)
      else window.clearTimeout(frame)
    }
  }, [])

  if (!ready) return null

  return (
    <Suspense fallback={null}>
      <IslandLayer />
    </Suspense>
  )
}
