import { useSyncExternalStore } from 'react'
import { useUIStore } from '@/stores'

export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DARK_QUERY).matches
}

function subscribeSystemTheme(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const query = window.matchMedia(DARK_QUERY)
  // Safari below 14 has the deprecated listener API only; both are kept so the
  // brand mark never goes stale on an older iOS home screen.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }
  query.addListener(onChange)
  return () => query.removeListener(onChange)
}

const readSystemDark = () => systemPrefersDark()

/**
 * The theme that is actually painted right now.
 *
 * The stored preference can be `system`, in which case the appearance follows
 * the OS and must keep updating when the user flips the system setting. The
 * boot script in index.html already writes `html.dark`, so components only need
 * this to pick the matching asset variant.
 */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useUIStore(state => state.theme)
  const systemDark = useSyncExternalStore(subscribeSystemTheme, readSystemDark, readSystemDark)

  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}
