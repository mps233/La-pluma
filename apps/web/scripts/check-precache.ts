#!/usr/bin/env node
// 预缓存完整性校验：新增 manualChunks 分组后若忘记扩展 createWorkboxConfig
// 的 globPatterns，产物里的 chunk 不会进入 sw.js 的 precache 清单，离线时
// 对应资源加载失败、页面白屏。这里直接核对构建产物，而不是比对配置里的
// chunk 名字符串——改个名不会误报，真正漏掉一个 chunk 才失败。
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(__dirname, '..')
const DIST_DIR = path.join(clientRoot, 'dist')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')
const SW_PATH = path.join(DIST_DIR, 'sw.js')
const BUILD_HINT = '请先运行构建：pnpm --filter la-pluma-next-client build'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const entries = await readdir(ASSETS_DIR, { withFileTypes: true }).catch((error: unknown) => {
  console.error(`无法读取产物目录 ${ASSETS_DIR}：${errorMessage(error)}`)
  console.error(BUILD_HINT)
  process.exit(2)
})

// 只检查 assets/ 下的 JS；dist/sw.js、dist/workbox-*.js 位于 dist 根目录，
// 不参与预缓存，也不在检查范围内。
const assetScripts = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name)
  .sort()

if (assetScripts.length === 0) {
  console.error(`产物目录 ${ASSETS_DIR} 中没有 JS 文件，构建结果异常。`)
  process.exit(2)
}

const swSource = await readFile(SW_PATH, 'utf8').catch((error: unknown) => {
  console.error(`无法读取 ${SW_PATH}：${errorMessage(error)}`)
  console.error(BUILD_HINT)
  process.exit(2)
})

// precache 清单每条记录形如 {url:"assets/index-xxxx.js",revision:<hash|null>}。
// 只取带 revision 字段的条目，NavigationRoute 等其他 URL 不会被误当成预缓存。
const precachedUrls = new Set(
  [...swSource.matchAll(/\{\s*url\s*:\s*["']([^"']+)["']\s*,\s*revision\s*:/g)]
    .map((match) => match[1])
    .filter((url): url is string => url !== undefined),
)

if (precachedUrls.size === 0) {
  console.error('sw.js 中没有任何 precache 条目，Service Worker 配置可能已失效。')
  process.exit(1)
}

const missing = assetScripts
  .map((name) => `assets/${name}`)
  .filter((url) => !precachedUrls.has(url))

if (missing.length > 0) {
  console.error(`预缓存校验失败：${missing.length} 个 JS 产物未进入 sw.js 的 precache 清单。`)
  console.error('离线时这些 chunk 会加载失败（白屏）。请把它们加入')
  console.error('apps/web/scripts/vite/pwa.ts 中 createWorkboxConfig 的 globPatterns：')
  console.error('')
  for (const url of missing) {
    console.error(`  缺失：${url}`)
  }
  console.error('')
  console.error('新增 manualChunks 分组后，globPatterns 里的 chunk 名单必须同步更新。')
  process.exit(1)
}

console.log(`预缓存校验通过：${assetScripts.length} 个 JS 产物全部进入 sw.js 的 precache 清单。`)
