import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import {
  createDevServiceWorkerCleanupPlugin,
  createDevServiceWorkerCleanupScript,
  createNavigateFallbackDenylist,
  normalizeBasePath,
} from './vite.config.js'

describe('PWA base path configuration', () => {
  it('normalizes a configured deployment path', () => {
    expect(normalizeBasePath()).toBe('/')
    expect(normalizeBasePath('la-pluma')).toBe('/la-pluma/')
    expect(normalizeBasePath('/la-pluma/')).toBe('/la-pluma/')
  })

  it('keeps API and signaling routes out of the navigation fallback', () => {
    const denylist = createNavigateFallbackDenylist('/la-pluma/')
    const isDenied = (url) => denylist.some(pattern => pattern.test(url))

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

  it('serves a no-store cleanup worker before the development SPA fallback', () => {
    let middleware
    const plugin = createDevServiceWorkerCleanupPlugin('/la-pluma/')
    plugin.configureServer({
      middlewares: {
        use: (handler) => {
          middleware = handler
        },
      },
    })

    const headers = new Map()
    const response = {
      statusCode: 0,
      setHeader: (name, value) => headers.set(name, value),
      end: vi.fn(),
    }
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
    expect(response.end).toHaveBeenCalledWith(createDevServiceWorkerCleanupScript())
  })

  it('lets unrelated development requests continue through Vite', () => {
    let middleware
    const plugin = createDevServiceWorkerCleanupPlugin('/')
    plugin.configureServer({
      middlewares: {
        use: (handler) => {
          middleware = handler
        },
      },
    })

    const next = vi.fn()
    middleware(
      { method: 'GET', url: '/src/main.tsx' },
      { setHeader: vi.fn(), end: vi.fn() },
      next,
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('builds a worker that clears app caches, unregisters, and refreshes clients', () => {
    const script = createDevServiceWorkerCleanupScript()

    expect(script).toContain("self.addEventListener('install'")
    expect(script).toContain('self.skipWaiting()')
    expect(script).toContain("cacheName.startsWith('workbox-')")
    expect(script).toContain("cacheName === 'google-fonts-cache'")
    expect(script).toContain('self.registration.unregister()')
    expect(script).toContain('client.navigate(client.url)')
  })

  it('executes the complete cleanup worker lifecycle', async () => {
    const listeners = new Map()
    const skipWaiting = vi.fn().mockResolvedValue(undefined)
    const claim = vi.fn().mockResolvedValue(undefined)
    const unregister = vi.fn().mockResolvedValue(true)
    const navigate = vi.fn().mockResolvedValue(undefined)
    const deleteCache = vi.fn().mockResolvedValue(true)
    const workerScope = {
      addEventListener: (type, listener) => listeners.set(type, listener),
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
        'unrelated-cache',
      ]),
      delete: deleteCache,
    }

    vm.runInNewContext(createDevServiceWorkerCleanupScript(), {
      self: workerScope,
      caches: cacheStorage,
    })

    let installWork
    listeners.get('install')({
      waitUntil: (work) => {
        installWork = work
      },
    })
    await installWork

    let activateWork
    listeners.get('activate')({
      waitUntil: (work) => {
        activateWork = work
      },
    })
    await activateWork

    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(deleteCache.mock.calls.map(([cacheName]) => cacheName)).toEqual([
      'workbox-precache-v2-http://localhost:5173/',
      'google-fonts-cache',
    ])
    expect(claim).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('http://localhost:5173/app/dashboard')
  })
})
