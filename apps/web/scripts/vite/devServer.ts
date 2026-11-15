import type { UserConfig } from 'vite'

type DevServerEnv = Record<string, string | undefined>

const parseDevPort = (value: string | undefined, fallback: number, name: string): number => {
  const input = value?.trim()
  if (!input) return fallback

  const port = Number(input)
  if (!/^\d+$/.test(input) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

const resolveDevApiTarget = (env: DevServerEnv): string => {
  const input = env.LA_PLUMA_DEV_API_TARGET?.trim()
  if (!input) return `http://localhost:${parseDevPort(env.PORT, 3000, 'PORT')}`

  const target = URL.canParse(input) ? new URL(input) : null
  if (!target || !['http:', 'https:'].includes(target.protocol)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('LA_PLUMA_DEV_API_TARGET must be an HTTP or HTTPS origin without credentials, path, query or fragment')
  }
  return target.origin
}

export const createDevServerConfig = (env: DevServerEnv): NonNullable<UserConfig['server']> => {
  const target = resolveDevApiTarget(env)

  return {
    host: '0.0.0.0',
    port: parseDevPort(env.LA_PLUMA_DEV_PORT, 5173, 'LA_PLUMA_DEV_PORT'),
    strictPort: true,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
      },
      '/game-assets': {
        target,
        changeOrigin: true,
      },
      '/webrtc-signaling': {
        target,
        // 保留浏览器看到的 Host：信令票据入口在无令牌模式下按 Origin/Host
        // 主机名限制签发来源，改写 Host 会把同一页面的请求误判为跨源。
        changeOrigin: false,
        ws: true,
      },
    },
  }
}
