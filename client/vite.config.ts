import { defineConfig, loadEnv } from 'vite'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import type { ManifestOptions, Options } from 'vite-plugin-pwa'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const normalizeBasePath = (value: string = '/'): string => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

export const createNavigateFallbackDenylist = (basePath: string): RegExp[] => {
  const denylist = [
    /^\/api(?:[/?]|$)/,
    /^\/health(?:[/?]|$)/,
    /^\/webrtc-signaling(?:[/?]|$)/,
  ]

  if (basePath !== '/') {
    const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    denylist.push(new RegExp(`^${escapedBasePath}(?:api|health|webrtc-signaling)(?:[/?]|$)`))
  }

  return denylist
}

export const createWorkboxConfig = (basePath: string): Options['workbox'] => {
  const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return {
    cleanupOutdatedCaches: true,
    globPatterns: [
      '**/*.{css,html,ico,png,svg,woff,woff2}',
      'assets/{index,react-vendor,motion-vendor,workbox-window.prod.es5}-*.js',
    ],
    navigateFallbackDenylist: createNavigateFallbackDenylist(basePath),
    runtimeCaching: [
      {
        // Workbox matches RegExp routes against the full URL. Leaving the
        // pattern unanchored also lets RegExpRoute reject partial cross-origin matches.
        urlPattern: new RegExp(`${escapedBasePath}assets/.*\\.js(?:\\?.*)?$`),
        handler: 'CacheFirst',
        options: {
          cacheName: 'la-pluma-page-chunks',
          expiration: {
            maxEntries: 40,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
    ],
  }
}

export const createDevServiceWorkerCleanupScript = (): string => `
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
  name: 'La Pluma - MAA WebUI',
  short_name: 'La Pluma',
  description: 'MAA CLI 的现代化 Web 界面',
  lang: 'zh-CN',
  theme_color: '#101318',
  background_color: '#101318',
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

export const createDevPwaSupportPlugin = (basePath: string): Plugin => {
  const serviceWorkerPath = `${basePath}sw.js`
  const manifestPath = `${basePath}manifest.webmanifest`
  const cleanupScript = createDevServiceWorkerCleanupScript()
  const manifest = createWebManifest(basePath)

  return {
    name: 'la-pluma-dev-pwa-support',
    apply: 'serve',
    transformIndexHtml() {
      return [{
        tag: 'link',
        attrs: { rel: 'manifest', href: manifestPath },
        injectTo: 'head',
      }]
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
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
      })
    }
  }
}

// https://vite.dev/config/
const apiTarget = globalThis.process?.env?.VITE_API_TARGET || 'http://localhost:3000'

export const createViteConfig = (basePath: string): UserConfig => ({
  base: basePath,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  plugins: [
    createDevPwaSupportPlugin(basePath),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false // 开发模式下禁用 Service Worker
      },
      includeAssets: ['favicon-graphite.png', 'apple-touch-icon-graphite.png'],
      manifest: createWebManifest(basePath),
      workbox: createWorkboxConfig(basePath)
    })
  ],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()]
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion-vendor'
          return undefined
        }
      }
    }
  },
  server: {
    host: '0.0.0.0', // 监听所有网络接口，允许局域网访问
    allowedHosts: ['mps.sgponte'],
    port: 5173,
    strictPort: false, // 如果端口被占用，自动尝试下一个可用端口
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/webrtc-signaling': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      }
    }
  }
})

export default defineConfig(({ mode }: ConfigEnv) => {
  const env = loadEnv(mode, __dirname)
  return createViteConfig(normalizeBasePath(env.VITE_BASE_PATH))
})
