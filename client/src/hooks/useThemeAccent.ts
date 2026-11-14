import { useSyncExternalStore } from 'react'
import { useUIStore } from '@/stores'

const subscribeSystemDark = (onChange: () => void) => {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!media) return () => undefined
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * The app's system accent (`--app-accent`), resolved for island content that draws on its own black
 * pill. The island cannot use the CSS variable directly because the SVG fills need a concrete colour
 * to derive their dimmed track.
 */
export function useThemeAccent(): string {
  const theme = useUIStore(state => state.theme)
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    () => Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches),
    () => false,
  )
  return theme === 'dark' || (theme === 'system' && systemDark) ? '#0a84ff' : '#007aff'
}
