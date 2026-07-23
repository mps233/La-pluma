import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const normalizeBasePath = (value = '/') => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

export const createNavigateFallbackDenylist = (basePath) => {
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

export const createDevServiceWorkerCleanupScript = () => `
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    const appCacheNames = cacheNames.filter((cacheName) =>
      cacheName.startsWith('workbox-') || cacheName === 'google-fonts-cache')
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

export const createDevServiceWorkerCleanupPlugin = (basePath) => {
  const serviceWorkerPath = `${basePath}sw.js`
  const cleanupScript = createDevServiceWorkerCleanupScript()

  return {
    name: 'la-pluma-dev-service-worker-cleanup',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://localhost')
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
export const createViteConfig = (basePath) => ({
  base: basePath,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types')
    }
  },
  plugins: [
    createDevServiceWorkerCleanupPlugin(basePath),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false // 开发模式下禁用 Service Worker
      },
      includeAssets: ['favicon-graphite.png', 'apple-touch-icon-graphite.png'],
      manifest: {
        name: 'La Pluma - MAA WebUI',
        short_name: 'La Pluma',
        description: 'MAA CLI 的现代化 Web 界面',
        lang: 'zh-CN',
        theme_color: '#05090c',
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
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        navigateFallbackDenylist: createNavigateFallbackDenylist(basePath),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0', // 监听所有网络接口，允许局域网访问
    port: 5173,
    strictPort: false, // 如果端口被占用，自动尝试下一个可用端口
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/webrtc-signaling': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname)
  return createViteConfig(normalizeBasePath(env.VITE_BASE_PATH))
})
