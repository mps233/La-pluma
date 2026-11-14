import { defineConfig, loadEnv } from 'vite'
import type { HtmlTagDescriptor, Plugin, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { ManifestOptions } from 'vite-plugin-pwa'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOT_THEME_COLORS, createBootScript } from './src/shared/theme/bootTheme.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const normalizeBasePath = (value = '/') => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

export const DEFAULT_TEST_WORKERS = 4

export const resolveTestWorkers = (
  value: string | undefined,
  parallelism: number = availableParallelism()
): number => {
  const trimmed = value?.trim()
  if (!trimmed) return Math.max(1, Math.min(DEFAULT_TEST_WORKERS, parallelism))
  if (!/^[1-9]\d*$/.test(trimmed)) throw new Error('LA_PLUMA_TEST_WORKERS must be a positive integer')
  return Number(trimmed)
}

export interface ClientViteConfig extends UserConfig {
  test: { maxWorkers: number }
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

export interface WorkboxConfig {
  cleanupOutdatedCaches: boolean
  // All app code ships in the statically imported entry chunks, so this glob
  // precaches every JS asset and the app stays fully usable offline.
  globPatterns: string[]
  navigateFallbackDenylist: RegExp[]
  importScripts: string[]
}

export const createWorkboxConfig = (basePath: string): WorkboxConfig => ({
  cleanupOutdatedCaches: true,
  globPatterns: [
    '**/*.{css,html,ico,png,svg,woff,woff2}',
    'assets/{index,react-vendor,motion-vendor,ui-vendor,workbox-window.prod.es5,rolldown-runtime}-*.js',
  ],
  navigateFallbackDenylist: createNavigateFallbackDenylist(basePath),
  importScripts: [`${basePath}legacy-page-cache-cleanup.js`],
})

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

export const createManifestLinkTag = (basePath: string): HtmlTagDescriptor => ({
  tag: 'link',
  attrs: { rel: 'manifest', href: `${basePath}manifest.webmanifest` },
  injectTo: 'head',
})

export const createDevPwaSupportPlugin = (basePath: string): Plugin => ({
  name: 'la-pluma-dev-pwa-support',
  apply: 'serve',
  transformIndexHtml() {
    return [createManifestLinkTag(basePath)]
  },
  configureServer(server) {
    server.middlewares.use(createDevPwaMiddleware(basePath))
  }
})

/**
 * 把首帧主题 meta 与脚本依次注入 index.html 的 head 末尾（dev 与 build 都生效）。
 * 用 'head' 而不是 'head-prepend'：同一 injectTo 下按数组顺序输出，因此两个
 * meta 必然排在脚本之前，applyTheme 首次运行才能覆写它们。
 * 初始值取深色：<html> 静态就是 class="dark"，index.html 的默认主题也是深色；
 * 脚本随后按 localStorage 中的偏好改写。meta content 与脚本内容都由
 * shared/theme/bootTheme.ts 单一生成，index.html 里不再内联副本。
 */
export const createBootThemeTags = (): HtmlTagDescriptor[] => [
  {
    tag: 'meta',
    attrs: { name: 'theme-color', content: BOOT_THEME_COLORS.dark.themeColor },
    injectTo: 'head',
  },
  {
    tag: 'meta',
    attrs: { name: 'apple-mobile-web-app-status-bar-style', content: BOOT_THEME_COLORS.dark.statusBar },
    injectTo: 'head',
  },
  {
    tag: 'script',
    children: createBootScript(),
    injectTo: 'head',
  },
]

export const createBootAssetsPlugin = (): Plugin => ({
  name: 'la-pluma-boot-assets',
  transformIndexHtml() {
    return createBootThemeTags()
  },
})

const parseDevPort = (value: string | undefined, fallback: number, name: string): number => {
  const input = value?.trim()
  if (!input) return fallback

  const port = Number(input)
  if (!/^\d+$/.test(input) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

const resolveDevApiTarget = (env: Record<string, string | undefined>): string => {
  const input = env.LA_PLUMA_DEV_API_TARGET?.trim()
  if (!input) return `http://localhost:${parseDevPort(env.PORT, 3000, 'PORT')}`

  const target = URL.canParse(input) ? new URL(input) : null
  if (!target || !['http:', 'https:'].includes(target.protocol)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('LA_PLUMA_DEV_API_TARGET must be an HTTP or HTTPS origin without credentials, path, query or fragment')
  }
  return target.origin
}

export const createViteConfig = (basePath: string, env: Record<string, string | undefined> = {}): ClientViteConfig => ({
  base: basePath,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    maxWorkers: resolveTestWorkers(process.env.LA_PLUMA_TEST_WORKERS)
  },
  plugins: [
    createDevPwaSupportPlugin(basePath),
    createBootAssetsPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false
      },
      includeAssets: ['favicon-graphite.png', 'apple-touch-icon-graphite.png'],
      manifest: createWebManifest(basePath),
      workbox: createWorkboxConfig(basePath)
    })
  ],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion-vendor'
          if (/node_modules\/(@base-ui\/react|@base-ui\/utils|sonner|cn|class-variance-authority)\//.test(id)) return 'ui-vendor'
          return undefined
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: parseDevPort(env.LA_PLUMA_DEV_PORT, 5173, 'LA_PLUMA_DEV_PORT'),
    strictPort: true,
    proxy: {
      '/api': {
        target: resolveDevApiTarget(env),
        changeOrigin: true,
      },
      '/game-assets': {
        target: resolveDevApiTarget(env),
        changeOrigin: true,
      },
      '/webrtc-signaling': {
        target: resolveDevApiTarget(env),
        // 保留浏览器看到的 Host：信令票据入口在无令牌模式下按 Origin/Host
        // 主机名限制签发来源，改写 Host 会把同一页面的请求误判为跨源。
        changeOrigin: false,
        ws: true,
      }
    }
  }
})

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, __dirname)
  const devEnv = command === 'serve' && !isPreview ? process.env : {}
  return createViteConfig(normalizeBasePath(env.VITE_BASE_PATH), devEnv)
})
