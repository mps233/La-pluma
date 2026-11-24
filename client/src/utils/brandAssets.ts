import type { ResolvedTheme } from '@/hooks/useResolvedTheme'

/**
 * Cache-busting suffix for the brand assets. Bump together with the `?v=` on the
 * favicon links in index.html whenever any logo-*.png or favicon-*.png changes,
 * so an already-installed home-screen icon refreshes on the next visit.
 */
export const BRAND_ASSET_VERSION = '7'

function asset(name: string) {
  return `${import.meta.env.BASE_URL}${name}?v=${BRAND_ASSET_VERSION}`
}

/**
 * Square brand marks used inside the app (navbar, install prompt). These are the
 * only logo assets that genuinely follow the theme at runtime, because the app
 * can swap an <img> source the moment the user changes the setting.
 *
 * The favicon is swapped by the boot script in index.html instead: it has to be
 * correct before hydration, and it is the same code path the theme toggle calls.
 */
export function brandMarkUrl(theme: ResolvedTheme) {
  return asset(theme === 'light' ? 'logo-graphite-light.png' : 'logo-graphite-dark.png')
}
