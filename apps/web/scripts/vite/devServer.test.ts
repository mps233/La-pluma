import { describe, expect, it } from 'vitest'
import { createDevServerConfig } from './devServer.ts'

describe('development server addressing', () => {
  it('proxies API, game assets and signaling to the local backend', () => {
    const server = createDevServerConfig({})

    expect(server).toMatchObject({
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: 'http://localhost:3000', changeOrigin: true },
        '/game-assets': { target: 'http://localhost:3000', changeOrigin: true },
        '/webrtc-signaling': { target: 'http://localhost:3000', changeOrigin: false, ws: true },
      },
    })
  })

  it('honours the selected ports and keeps the explicit backend origin for every proxy', () => {
    const server = createDevServerConfig({
      LA_PLUMA_DEV_PORT: '5273',
      PORT: '3100',
      LA_PLUMA_DEV_API_TARGET: 'https://backend.example:3443/',
    })

    expect(server).toMatchObject({
      port: 5273,
      proxy: {
        '/api': { target: 'https://backend.example:3443' },
        '/game-assets': { target: 'https://backend.example:3443' },
        '/webrtc-signaling': { target: 'https://backend.example:3443', ws: true },
      },
    })
  })

  it.each(['0', '65536', '-1', '5273.5', '5273suffix'])('rejects invalid frontend port %s', (port) => {
    expect(() => createDevServerConfig({ LA_PLUMA_DEV_PORT: port })).toThrow('LA_PLUMA_DEV_PORT')
  })

  it.each(['0', '65536', '-1', '3100.5', '3100suffix'])('rejects invalid backend port %s', (port) => {
    expect(() => createDevServerConfig({ PORT: port })).toThrow('PORT')
  })

  it.each(['backend:3100', 'ftp://backend.example', 'http://backend.example/api', 'http://backend.example?token=value'])('rejects invalid backend origin %s', (target) => {
    expect(() => createDevServerConfig({ LA_PLUMA_DEV_API_TARGET: target })).toThrow('LA_PLUMA_DEV_API_TARGET')
  })
})
