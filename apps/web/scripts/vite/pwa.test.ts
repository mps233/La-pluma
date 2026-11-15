import { readdirSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createDevPwaMiddleware,
  createDevServiceWorkerCleanupScript,
  createManifestLinkTag,
  createNavigateFallbackDenylist,
  createWebManifest,
  createWorkboxConfig,
} from './pwa.ts'

type ServiceWorkerListener = (event: { waitUntil: (work: Promise<unknown>) => void }) => void

const publicDir = new URL('../../public/', import.meta.url)

describe('offline navigation fallback', () => {
  it('keeps API and signaling routes out of the navigation fallback', () => {
    const denylist = createNavigateFallbackDenylist('/la-pluma/')
    const isDenied = (url: string) => denylist.some(pattern => pattern.test(url))

    expect(isDenied('/api/agent/manifest')).toBe(true)
    expect(isDenied('/api?format=json')).toBe(true)
    expect(isDenied('/health')).toBe(true)
    expect(isDenied('/health?probe=1')).toBe(true)
    expect(isDenied('/readiness')).toBe(true)
    expect(isDenied('/readiness?probe=1')).toBe(true)
    expect(isDenied('/webrtc-signaling/socket')).toBe(true)
    expect(isDenied('/webrtc-signaling?probe=1')).toBe(true)
    expect(isDenied('/game-assets/item/30011.png')).toBe(true)
    expect(isDenied('/game-assets?probe=1')).toBe(true)
    expect(isDenied('/la-pluma/api/agent/manifest')).toBe(true)
    expect(isDenied('/la-pluma/health?probe=1')).toBe(true)
    expect(isDenied('/la-pluma/readiness?probe=1')).toBe(true)
    expect(isDenied('/la-pluma/webrtc-signaling/socket')).toBe(true)
    expect(isDenied('/la-pluma/game-assets/item/30011.png')).toBe(true)
    expect(isDenied('/la-pluma/automation')).toBe(false)
  })
})

describe('precache configuration', () => {
  it('cleans outdated caches and loads the legacy cleanup worker at the deployment path', () => {
    const workbox = createWorkboxConfig('/la-pluma/')

    expect(workbox.cleanupOutdatedCaches).toBe(true)
    expect(workbox.importScripts).toEqual(['/la-pluma/legacy-page-cache-cleanup.js'])
    expect(createWorkboxConfig('/').importScripts).toEqual(['/legacy-page-cache-cleanup.js'])
  })
})

describe('installable manifest', () => {
  it('scopes and starts the app at the deployment path', () => {
    expect(createWebManifest('/la-pluma/')).toMatchObject({ scope: '/la-pluma/', start_url: '/la-pluma/' })
    expect(createWebManifest('/')).toMatchObject({ scope: '/', start_url: '/' })
  })

  it('references icons that ship in the public directory', () => {
    const published = new Set(readdirSync(publicDir))
    const icons = createWebManifest('/').icons ?? []

    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(published.has(icon.src)).toBe(true)
  })

  it('links the install manifest at the deployment path', () => {
    expect(createManifestLinkTag('/la-pluma/').attrs).toEqual({
      rel: 'manifest',
      href: '/la-pluma/manifest.webmanifest',
    })
    expect(createManifestLinkTag('/').attrs).toEqual({
      rel: 'manifest',
      href: '/manifest.webmanifest',
    })
  })
})

describe('legacy page cache cleanup', () => {
  it('purges the legacy page-chunk cache when the worker activates', async () => {
    const listeners = new Map<string, ServiceWorkerListener>()
    const deleteCache = vi.fn().mockResolvedValue(true)
    runInNewContext(
      readFileSync(new URL('../../public/legacy-page-cache-cleanup.js', import.meta.url), 'utf8'),
      {
        self: {
          addEventListener: (type: string, listener: ServiceWorkerListener) => listeners.set(type, listener),
        },
        caches: { delete: deleteCache },
      },
    )

    let activateWork: Promise<unknown> | undefined
    listeners.get('activate')!({
      waitUntil: (work) => {
        activateWork = work
      },
    })
    await activateWork

    expect(deleteCache).toHaveBeenCalledWith('la-pluma-page-chunks')
  })
})

describe('development service worker', () => {
  it('serves a no-store cleanup worker and manifest before the SPA fallback', () => {
    const middleware = createDevPwaMiddleware('/la-pluma/')
    const request = (url: string) => {
      const headers = new Map<string, string>()
      const response = {
        statusCode: 0,
        setHeader: (name: string, value: string) => headers.set(name, value),
        end: vi.fn(),
      }
      const next = vi.fn()
      middleware({ method: 'GET', url }, response, next)
      return { headers, response, next }
    }

    const worker = request('/la-pluma/sw.js?update=1')
    expect(worker.next).not.toHaveBeenCalled()
    expect(worker.response.statusCode).toBe(200)
    expect(worker.headers.get('Cache-Control')).toContain('no-store')
    expect(worker.headers.get('Service-Worker-Allowed')).toBe('/la-pluma/')
    expect(worker.response.end).toHaveBeenCalledWith(createDevServiceWorkerCleanupScript())

    const manifest = request('/la-pluma/manifest.webmanifest')
    expect(manifest.next).not.toHaveBeenCalled()
    expect(manifest.headers.get('Content-Type')).toContain('manifest+json')
    expect(manifest.headers.get('Cache-Control')).toContain('no-store')
    expect(JSON.parse(manifest.response.end.mock.calls[0]?.[0] as string)).toMatchObject({
      scope: '/la-pluma/',
      start_url: '/la-pluma/',
    })

    const other = request('/src/main.tsx')
    expect(other.next).toHaveBeenCalledOnce()
  })

  it('executes the cleanup worker lifecycle without touching unrelated caches', async () => {
    const listeners = new Map<string, ServiceWorkerListener>()
    const skipWaiting = vi.fn().mockResolvedValue(undefined)
    const claim = vi.fn().mockResolvedValue(undefined)
    const unregister = vi.fn().mockResolvedValue(true)
    const navigate = vi.fn().mockResolvedValue(undefined)
    const deleteCache = vi.fn().mockResolvedValue(true)

    runInNewContext(createDevServiceWorkerCleanupScript(), {
      self: {
        addEventListener: (type: string, listener: ServiceWorkerListener) => listeners.set(type, listener),
        skipWaiting,
        clients: {
          claim,
          matchAll: vi.fn().mockResolvedValue([{ url: 'http://localhost:5173/app/dashboard', navigate }]),
        },
        registration: { unregister },
      },
      caches: {
        keys: vi.fn().mockResolvedValue([
          'workbox-precache-v2-http://localhost:5173/',
          'google-fonts-cache',
          'la-pluma-page-chunks',
          'unrelated-cache',
        ]),
        delete: deleteCache,
      },
    })

    let installWork: Promise<unknown> | undefined
    listeners.get('install')!({ waitUntil: (work) => { installWork = work } })
    await installWork
    expect(skipWaiting).toHaveBeenCalledOnce()

    let activateWork: Promise<unknown> | undefined
    listeners.get('activate')!({ waitUntil: (work) => { activateWork = work } })
    await activateWork

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
