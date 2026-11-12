import { useCallback, useSyncExternalStore, useState } from 'react'
import { useUIStore } from '../../stores'
import './AeroBackdrop.css'

function useMediaQuery(query: string) {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const media = window.matchMedia?.(query)
    if (!media) return () => {}
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onStoreChange)
      return () => media.removeEventListener('change', onStoreChange)
    }
    media.addListener?.(onStoreChange)
    return () => media.removeListener?.(onStoreChange)
  }, [query])

  const getSnapshot = useCallback(
    () => Boolean(typeof window !== 'undefined' && window.matchMedia?.(query).matches),
    [query],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function useIsDarkTheme() {
  const theme = useUIStore(state => state.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/**
 * Static Aero Shards still, pre-rendered from the original shader.
 *
 * A still avoids WebGPU work, video decoding, and loop seams at runtime.
 */
export default function AeroBackdrop() {
  const isDark = useIsDarkTheme()
  const isWideEnough = useMediaQuery('(min-width: 768px)')
  const [failed, setFailed] = useState(false)
  const theme = isDark ? 'dark' : 'light'
  const src = `${import.meta.env.BASE_URL}ambient/aero-shards-${theme}.jpg?v=3`

  if (!isWideEnough || failed) return null

  return (
    <div className="aero-backdrop" aria-hidden="true">
      <img
        key={src}
        className="aero-backdrop-image"
        src={src}
        alt=""
        onError={() => setFailed(true)}
      />
    </div>
  )
}
