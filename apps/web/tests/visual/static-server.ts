#!/usr/bin/env node
/**
 * 浏览器测试专用静态服务器：伺服 apps/web/dist（vite build 产物）并对 /app/* 做 SPA 回退。
 * 不用 vite preview，避免 dev/preview 差异与 PWA dev 插件等额外变量。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = process.env.STATIC_DIST_DIR
  ? path.resolve(process.env.STATIC_DIST_DIR)
  : path.resolve(__dirname, '..', '..', 'dist')
const port = Number(process.env.PORT || 4300)
const host = process.env.HOST || '127.0.0.1'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)
    const pathname = decodeURIComponent(url.pathname)

    // Service worker 一律 404：浏览器测试环境必须无 SW 干预。
    if (pathname.endsWith('sw.js')) {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('service worker disabled for browser tests')
      return
    }

    let filePath = path.normalize(path.join(distDir, pathname))
    if (!filePath.startsWith(distDir)) {
      response.writeHead(403)
      response.end()
      return
    }

    let fileStat = await stat(filePath).catch(() => null)
    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
      fileStat = await stat(filePath).catch(() => null)
    }
    if (!fileStat) {
      filePath = path.join(distDir, 'index.html')
      fileStat = await stat(filePath).catch(() => null)
    }
    if (!fileStat) {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('dist not found — run `pnpm build` first')
      return
    }

    const body = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' })
    response.end(errorMessage(error))
  }
})

server.listen(port, host, () => {
  console.log(`visual static server: http://${host}:${port} -> ${distDir}`)
})
