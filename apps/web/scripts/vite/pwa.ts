import type { HtmlTagDescriptor } from 'vite'
import type { ManifestOptions } from 'vite-plugin-pwa'
import { BOOT_THEME_COLORS } from '../../src/shared/theme/bootTheme.ts'

export interface WorkboxConfig {
  cleanupOutdatedCaches: boolean
  // All app code ships in the statically imported entry chunks, so this glob
  // precaches every JS asset and the app stays fully usable offline.
  globPatterns: string[]
  navigateFallbackDenylist: RegExp[]
}

export const createNavigateFallbackDenylist = (basePath: string): RegExp[] => {
  const denylist = [
    /^\/api(?:[/?]|$)/,
    /^\/health(?:[/?]|$)/,
    /^\/readiness(?:[/?]|$)/,
    /^\/webrtc-signaling(?:[/?]|$)/,
    /^\/game-assets(?:[/?]|$)/,
  ]

  if (basePath !== '/') {
    const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    denylist.push(new RegExp(`^${escapedBasePath}(?:api|health|readiness|webrtc-signaling|game-assets)(?:[/?]|$)`))
  }

  return denylist
}

export const createWorkboxConfig = (basePath: string): WorkboxConfig => ({
  cleanupOutdatedCaches: true,
  globPatterns: [
    '**/*.{css,html,ico,png,svg,woff,woff2}',
    'assets/{index,react-vendor,motion-vendor,ui-vendor,workbox-window.prod.es5,rolldown-runtime}-*.js',
  ],
  navigateFallbackDenylist: createNavigateFallbackDenylist(basePath),
})

export const createWebManifest = (basePath: string): Partial<ManifestOptions> => ({
  name: 'La Pluma Next - MAA WebUI',
  short_name: 'La Pluma Next',
  description: 'MAA CLI 的现代化 Web 界面',
  lang: 'zh-CN',
  theme_color: BOOT_THEME_COLORS.dark.themeColor,
  // 启动画面底色，与浏览器 chrome 的 theme-color 是两种语义，保持独立。
  background_color: '#05090c',
  display: 'standalone',
  scope: basePath,
  start_url: basePath,
  icons: [
    {
      src: 'pwa-graphite-192x192.png',
      sizes: '192x192',
      type: 'image/png'
    },
    {
      src: 'pwa-graphite-512x512.png',
      sizes: '512x512',
      type: 'image/png'
    },
    {
      src: 'pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ]
})

export const createManifestLinkTag = (basePath: string): HtmlTagDescriptor => ({
  tag: 'link',
  attrs: { rel: 'manifest', href: `${basePath}manifest.webmanifest` },
  injectTo: 'head',
})

export interface DevPwaMiddlewareRequest {
  method?: string
  url?: string
}

export interface DevPwaMiddlewareResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export type DevPwaMiddleware = (
  request: DevPwaMiddlewareRequest,
  response: DevPwaMiddlewareResponse,
  next: () => void,
) => void

export const createDevServiceWorkerCleanupScript = () => `
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    const appCacheNames = cacheNames.filter((cacheName) =>
      cacheName.startsWith('workbox-')
      || cacheName === 'google-fonts-cache'
      || cacheName === 'la-pluma-page-chunks')
    await Promise.all(appCacheNames.map((cacheName) => caches.delete(cacheName)))

    await self.clients.claim()
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    await self.registration.unregister()
    await Promise.all(windowClients.map(async (client) => {
      try {
        await client.navigate(client.url)
      } catch {
        // A closed client does not need to be refreshed.
      }
    }))
  })())
})
`.trimStart()

export const createDevPwaMiddleware = (basePath: string): DevPwaMiddleware => {
  const serviceWorkerPath = `${basePath}sw.js`
  const manifestPath = `${basePath}manifest.webmanifest`
  const cleanupScript = createDevServiceWorkerCleanupScript()
  const manifest = createWebManifest(basePath)

  return (request, response, next) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (requestUrl.pathname === manifestPath) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(manifest))
      return
    }
    if (requestUrl.pathname !== serviceWorkerPath) {
      next()
      return
    }

    response.statusCode = 200
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.setHeader('Service-Worker-Allowed', basePath)
    response.setHeader('X-La-Pluma-Dev-Service-Worker', 'cleanup')
    response.end(request.method === 'HEAD' ? undefined : cleanupScript)
  }
}
