import { useSyncExternalStore } from 'react'
import { useUIStore } from '@/state'

const subscribeSystemDark = (onChange: () => void) => {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!media) return () => undefined
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * The app's system accent (`--app-accent`), resolved for island content that draws on its own black
 * pill. The island cannot use the CSS variable directly because the SVG fills need a concrete colour
 * to derive their dimmed track, so the effective theme token is read at render time.
 */
export function useThemeAccent(): string {
  useUIStore(state => state.theme)
  useSyncExternalStore(
    subscribeSystemDark,
    () => Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches),
    () => false,
  )
  if (typeof window === 'undefined') return 'currentColor'
  return window.getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim() || 'currentColor'
}
