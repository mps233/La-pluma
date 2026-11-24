import { defineConfig, loadEnv } from 'vite'
import type { Plugin, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBootThemeTags } from './scripts/vite/bootAssets.ts'
import { createDevServerConfig } from './scripts/vite/devServer.ts'
import { normalizeBasePath, resolveTestWorkers } from './scripts/vite/env.ts'
import { createDevPwaMiddleware, createManifestLinkTag, createWebManifest, createWorkboxConfig } from './scripts/vite/pwa.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface ClientViteConfig extends UserConfig {
  test: { maxWorkers: number }
}

const createDevPwaSupportPlugin = (basePath: string): Plugin => ({
  name: 'la-pluma-dev-pwa-support',
  apply: 'serve',
  transformIndexHtml() {
    return [createManifestLinkTag(basePath)]
  },
  configureServer(server) {
    server.middlewares.use(createDevPwaMiddleware(basePath))
  },
})

const createBootAssetsPlugin = (): Plugin => ({
  name: 'la-pluma-boot-assets',
  transformIndexHtml() {
    return createBootThemeTags()
  },
})

const createViteConfig = (basePath: string, env: Record<string, string | undefined> = {}): ClientViteConfig => ({
  base: basePath,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    exclude: ['@tanstack/react-virtual']
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
  server: createDevServerConfig(env)
})

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, __dirname)
  const devEnv = command === 'serve' && !isPreview ? process.env : {}
  return createViteConfig(normalizeBasePath(env.VITE_BASE_PATH), devEnv)
})
