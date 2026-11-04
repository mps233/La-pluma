import { useEffect, useState } from 'react'
import { useUIStore } from '../../stores'
import './AeroBackdrop.css'

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => Boolean(
    typeof window !== 'undefined' && window.matchMedia?.(query).matches
  ))

  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return undefined
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [query])

  return matches
}

function useIsDarkTheme() {
  const theme = useUIStore(state => state.theme)
  const [systemDark, setSystemDark] = useState(() => Boolean(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ))

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const update = () => setSystemDark(media.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

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
