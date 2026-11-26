#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'apps', 'web')
const version = JSON.parse(
  readFileSync(path.join(webRoot, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'),
).version

const image = process.env.PLAYWRIGHT_IMAGE || `mcr.microsoft.com/playwright:v${version}-noble`

function parseConfigArg(args) {
  const index = args.indexOf('--config')
  if (index === -1) {
    return { configArg: 'apps/web/tests/screenshots/playwright.config.ts', args }
  }
  const configArg = args[index + 1]
  if (!configArg) {
    console.error('--config 需要配置文件路径')
    process.exit(1)
  }
  return { configArg, args: [...args.slice(0, index), ...args.slice(index + 2)] }
}

const { configArg, args: passthroughArgs } = parseConfigArg(process.argv.slice(2))
const configPath = path.relative(repoRoot, path.resolve(repoRoot, configArg)).replaceAll('\\', '/')
if (configPath.startsWith('..')) {
  console.error(`Playwright 配置不在仓库内：${configArg}`)
  process.exit(1)
}

// 截图只针对构建产物（与生产一致），先在宿主机构建（esbuild/rollup 的
// 原生二进制按宿主机环境安装，不在容器内复用）。
if (!process.env.VISUAL_SKIP_BUILD) {
  const build = spawnSync('pnpm', ['--filter', 'la-pluma-next-client', 'build'], {
    stdio: 'inherit',
    cwd: repoRoot,
  })
  if (build.status !== 0) process.exit(build.status ?? 1)
} else if (!existsSync(path.join(webRoot, 'dist', 'index.html'))) {
  console.error('apps/web/dist 不存在：请先运行 `pnpm --filter la-pluma-next-client build`。')
  process.exit(1)
}

// 解析 playwright CLI 的真实路径：pnpm workspace 把 playwright 包提升在
// 根 node_modules/.pnpm 虚拟仓库（apps/web 的 .bin/playwright 是 shell shim，
// 不能作为 node 入口）。按已装版本精确定位。
function resolvePlaywrightCli(version) {
  const storeDir = path.join(repoRoot, 'node_modules', '.pnpm')
  if (existsSync(storeDir)) {
    for (const entry of readdirSync(storeDir)) {
      if (entry === `playwright@${version}` || entry.startsWith(`playwright@${version}(`)) {
        return path.join(storeDir, entry, 'node_modules', 'playwright', 'cli.js')
      }
    }
  }
  // 非 pnpm 布局的兜底。
  return createRequire(path.join(webRoot, 'package.json')).resolve('playwright/cli.js', {
    paths: [path.join(repoRoot, 'node_modules', `.pnpm`, `playwright@${version}`, 'node_modules')],
  })
}

const playwrightCli = resolvePlaywrightCli(version)
if (!existsSync(playwrightCli)) {
  console.error(`未找到 playwright cli：${playwrightCli}`)
  process.exit(1)
}
const playwrightCliRel = path.relative(repoRoot, playwrightCli).replaceAll('\\', '/')
if (playwrightCliRel.startsWith('..')) {
  console.error(`playwright cli 不在仓库内：${playwrightCli}`)
  process.exit(1)
}

const dockerArgs = [
  'run',
  '--rm',
  // Chromium 推荐共享宿主 /dev/shm，避免渲染进程共享内存不足。
  '--ipc=host',
  '-e', 'TZ=Asia/Shanghai',
  '-e', 'CI',
  '-v', `${repoRoot}:/work`,
  '-w', '/work',
  image,
  'node', `/work/${playwrightCliRel}`,
  'test',
  '--config', configPath,
  ...passthroughArgs,
]

console.log(`[playwright] ${image} (${configPath})`)
const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' })
process.exit(result.status ?? 1)
