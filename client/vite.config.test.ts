import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import type { Plugin, ViteDevServer } from 'vite'
import {
  createDevPwaSupportPlugin,
  createDevServiceWorkerCleanupScript,
  createNavigateFallbackDenylist,
  createWebManifest,
  createWorkboxConfig,
  normalizeBasePath,
} from './vite.config.ts'

interface DevMiddlewareRequest {
  method: string
  url: string
}

interface DevMiddlewareResponse {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

type DevMiddleware = (
  request: DevMiddlewareRequest,
  response: DevMiddlewareResponse,
  next: () => void,
) => void

interface WorkerEvent {
  waitUntil: (work: Promise<unknown>) => void
}

type WorkerListener = (event: WorkerEvent) => void

const captureDevMiddleware = (plugin: Plugin): DevMiddleware => {
  let middleware: DevMiddleware | undefined
  const server = {
    middlewares: {
      use: (handler: DevMiddleware) => {
        middleware = handler
      },
    },
  } as unknown as ViteDevServer
  const configureServer = plugin.configureServer
  if (typeof configureServer === 'function') {
    configureServer(server)
  } else {
    configureServer?.handler(server)
  }
  if (!middleware) throw new Error('Dev PWA plugin did not register middleware')
  return middleware
}

const createMockResponse = () => {
  const headers = new Map<string, string>()
  const end = vi.fn()
  const response: DevMiddlewareResponse = {
    statusCode: 0,
    setHeader: (name, value) => headers.set(name, value),
    end,
  }
  return { headers, response, end }
}

describe('PWA base path configuration', () => {
  const matchesWorkboxRegExpRoute = (pattern: RegExp, input: string, origin = 'https://la-pluma.test') => {
    const url = new URL(input, origin)
    const result = pattern.exec(url.href)
    return Boolean(result && (url.origin === origin || result.index === 0))
  }

  it('normalizes a configured deployment path', () => {
    expect(normalizeBasePath()).toBe('/')
    expect(normalizeBasePath('la-pluma')).toBe('/la-pluma/')
    expect(normalizeBasePath('/la-pluma/')).toBe('/la-pluma/')
  })

  it('keeps API and signaling routes out of the navigation fallback', () => {
    const denylist = createNavigateFallbackDenylist('/la-pluma/')
    const isDenied = (url: string) => denylist.some(pattern => pattern.test(url))

    expect(isDenied('/api/agent/manifest')).toBe(true)
    expect(isDenied('/api?format=json')).toBe(true)
    expect(isDenied('/health')).toBe(true)
    expect(isDenied('/health?probe=1')).toBe(true)
    expect(isDenied('/webrtc-signaling/socket')).toBe(true)
    expect(isDenied('/webrtc-signaling?probe=1')).toBe(true)
    expect(isDenied('/la-pluma/api/agent/manifest')).toBe(true)
    expect(isDenied('/la-pluma/health?probe=1')).toBe(true)
    expect(isDenied('/la-pluma/webrtc-signaling/socket')).toBe(true)
    expect(isDenied('/la-pluma/automation')).toBe(false)
  })

  it('precaches only the app shell and caches page chunks after use', () => {
    const workbox = createWorkboxConfig('/la-pluma/')
    const runtimeCaching = workbox.runtimeCaching
    expect(runtimeCaching).toBeDefined()
    const pageChunkCache = runtimeCaching?.[0]
    expect(pageChunkCache).toBeDefined()
    if (!pageChunkCache) throw new Error('Expected a runtime caching route')
    const urlPattern = pageChunkCache.urlPattern
    expect(urlPattern).toBeInstanceOf(RegExp)
    if (!(urlPattern instanceof RegExp)) throw new Error('Expected a RegExp url pattern')

    expect(workbox.cleanupOutdatedCaches).toBe(true)
    expect(workbox.globPatterns).toContain('assets/{index,react-vendor,motion-vendor,workbox-window.prod.es5}-*.js')
    expect(workbox.globPatterns).not.toContain('**/*.{js,css,html,ico,png,svg,woff,woff2}')
    expect(matchesWorkboxRegExpRoute(
      urlPattern,
      'https://la-pluma.test/la-pluma/assets/AutomationTasks-abc123.js',
    )).toBe(true)
    expect(matchesWorkboxRegExpRoute(
      urlPattern,
      'https://la-pluma.test/la-pluma/assets/AutomationTasks-abc123.js?reload=1',
    )).toBe(true)
    expect(matchesWorkboxRegExpRoute(
      urlPattern,
      'https://la-pluma.test/assets/AutomationTasks-abc123.js',
    )).toBe(false)
    expect(matchesWorkboxRegExpRoute(
      urlPattern,
      'https://cdn.example.com/la-pluma/assets/AutomationTasks-abc123.js',
    )).toBe(false)
    expect(pageChunkCache.handler).toBe('CacheFirst')
    expect(pageChunkCache.options?.cacheName).toBe('la-pluma-page-chunks')
  })

  it('serves a no-store cleanup worker before the development SPA fallback', () => {
    const middleware = captureDevMiddleware(createDevPwaSupportPlugin('/la-pluma/'))

    const { headers, response, end } = createMockResponse()
    const next = vi.fn()
    middleware(
      { method: 'GET', url: '/la-pluma/sw.js?update=1' },
      response,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(200)
    expect(headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(headers.get('Cache-Control')).toContain('no-store')
    expect(headers.get('Service-Worker-Allowed')).toBe('/la-pluma/')
    expect(headers.get('X-La-Pluma-Dev-Service-Worker')).toBe('cleanup')
    expect(end).toHaveBeenCalledWith(createDevServiceWorkerCleanupScript())
  })

  it('lets unrelated development requests continue through Vite', () => {
    const middleware = captureDevMiddleware(createDevPwaSupportPlugin('/'))

    const next = vi.fn()
    const { response } = createMockResponse()
    middleware(
      { method: 'GET', url: '/src/main.tsx' },
      response,
      next,
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('exposes the install manifest in development without enabling a caching worker', async () => {
    const plugin = createDevPwaSupportPlugin('/la-pluma/')
    const middleware = captureDevMiddleware(plugin)

    const transformIndexHtml = plugin.transformIndexHtml
    if (typeof transformIndexHtml !== 'function') throw new Error('Expected a transformIndexHtml hook')
    expect(await transformIndexHtml('', { path: '/', filename: '/index.html' })).toEqual([{
      tag: 'link',
      attrs: { rel: 'manifest', href: '/la-pluma/manifest.webmanifest' },
      injectTo: 'head',
    }])

    const { headers, response, end } = createMockResponse()
    const next = vi.fn()
    middleware(
      { method: 'GET', url: '/la-pluma/manifest.webmanifest?install=1' },
      response,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(200)
    expect(headers.get('Content-Type')).toBe('application/manifest+json; charset=utf-8')
    expect(headers.get('Cache-Control')).toContain('no-store')
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual(createWebManifest('/la-pluma/'))
  })

  it('builds a worker that clears app caches, unregisters, and refreshes clients', () => {
    const script = createDevServiceWorkerCleanupScript()

    expect(script).toContain("self.addEventListener('install'")
    expect(script).toContain('self.skipWaiting()')
    expect(script).toContain("cacheName.startsWith('workbox-')")
    expect(script).toContain("cacheName === 'google-fonts-cache'")
    expect(script).toContain("cacheName === 'la-pluma-page-chunks'")
    expect(script).toContain('self.registration.unregister()')
    expect(script).toContain('client.navigate(client.url)')
  })

  it('executes the complete cleanup worker lifecycle', async () => {
    const listeners = new Map<string, WorkerListener>()
    const skipWaiting = vi.fn().mockResolvedValue(undefined)
    const claim = vi.fn().mockResolvedValue(undefined)
    const unregister = vi.fn().mockResolvedValue(true)
    const navigate = vi.fn().mockResolvedValue(undefined)
    const deleteCache = vi.fn<(cacheName: string) => Promise<boolean>>().mockResolvedValue(true)
    const workerScope = {
      addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
      skipWaiting,
      clients: {
        claim,
        matchAll: vi.fn().mockResolvedValue([
          { url: 'http://localhost:5173/app/dashboard', navigate },
        ]),
      },
      registration: { unregister },
    }
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue([
        'workbox-precache-v2-http://localhost:5173/',
        'google-fonts-cache',
        'la-pluma-page-chunks',
        'unrelated-cache',
      ]),
      delete: deleteCache,
    }

    vm.runInNewContext(createDevServiceWorkerCleanupScript(), {
      self: workerScope,
      caches: cacheStorage,
    })

    let installWork: Promise<unknown> | undefined
    listeners.get('install')?.({
      waitUntil: (work: Promise<unknown>) => {
        installWork = work
      },
    })
    await installWork

    let activateWork: Promise<unknown> | undefined
    listeners.get('activate')?.({
      waitUntil: (work: Promise<unknown>) => {
        activateWork = work
      },
    })
    await activateWork

    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(deleteCache.mock.calls.map(([cacheName]) => cacheName)).toEqual([
      'workbox-precache-v2-http://localhost:5173/',
      'google-fonts-cache',
      'la-pluma-page-chunks',
    ])
    expect(claim).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('http://localhost:5173/app/dashboard')
  })
})
