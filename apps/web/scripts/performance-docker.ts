#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const webRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(webRoot, '../..')
const distRoot = path.resolve(process.env.PERFORMANCE_DIST || path.join(webRoot, 'dist'))
const output = path.resolve(repoRoot, process.env.PERFORMANCE_OUTPUT || 'apps/web/test-results/performance/production.json')
if (!output.startsWith(path.join(webRoot, 'test-results/performance/'))) {
  throw new Error('Performance output must stay in ignored apps/web/test-results/performance/')
}
mkdirSync(path.dirname(output), { recursive: true })
const buildMetadata = process.env.PERFORMANCE_BUILD_METADATA
  ? JSON.parse(readFileSync(process.env.PERFORMANCE_BUILD_METADATA, 'utf8'))
  : null
if (distRoot !== path.join(webRoot, 'dist') && (!process.env.PERFORMANCE_SKIP_BUILD || !buildMetadata)) {
  throw new Error('A separate profiling dist requires SKIP_BUILD and its build metadata')
}
const version = JSON.parse(readFileSync(path.join(webRoot, 'node_modules/@playwright/test/package.json'), 'utf8')).version
const image = `mcr.microsoft.com/playwright:v${version}-noble`

function command(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `${cmd} exited ${result.status}`)
  return result.stdout.trim()
}

if (!process.env.PERFORMANCE_SKIP_BUILD) {
  const build = spawnSync('pnpm', ['--filter', 'la-pluma-next-client', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
} else if (!existsSync(path.join(distRoot, 'index.html'))) {
  throw new Error('Selected dist is missing; build before using PERFORMANCE_SKIP_BUILD=1')
}

const packageDirectory = readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
  .find(entry => entry === `playwright@${version}` || entry.startsWith(`playwright@${version}(`))
if (!packageDirectory) throw new Error(`Installed playwright@${version} was not found`)
const cli = `/work/node_modules/.pnpm/${packageDirectory}/node_modules/playwright/cli.js`

function digestFiles(files: string[], root = repoRoot) {
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(`${path.relative(root, file)}\0`)
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

const distFiles: string[] = []
function collect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(file)
    else distFiles.push(file)
  }
}
collect(distRoot)
const distSha256 = digestFiles(distFiles, distRoot)
if (buildMetadata && (buildMetadata.buildMode !== 'production-with-react-profiling'
  || buildMetadata.distSha256 !== distSha256)) {
  throw new Error('Selected dist does not match the profiling build provenance')
}

// --pull=never ensures this entry point uses the existing, reviewed environment.
const metadata = {
  sourceCommit: command('git', ['rev-parse', 'HEAD']),
  sourceFilesDirty: command('git', ['status', '--porcelain', '--', 'apps/web/src', 'apps/web/scripts/vite', 'apps/web/vite.config.ts', 'pnpm-lock.yaml']) !== '',
  buildMode: 'production',
  ...(buildMetadata ?? {}),
  distSha256,
  distDigestPathBase: 'dist-root-relative',
  nodeVersion: process.version,
  pnpmVersion: command('pnpm', ['--version']),
  reactVersion: JSON.parse(readFileSync(path.join(webRoot, 'node_modules/react/package.json'), 'utf8')).version,
  reactDomVersion: JSON.parse(readFileSync(path.join(webRoot, 'node_modules/react-dom/package.json'), 'utf8')).version,
  viteVersion: JSON.parse(readFileSync(path.join(webRoot, 'node_modules/vite/package.json'), 'utf8')).version,
  evidenceHarnessDirty: command('git', ['status', '--porcelain', '--', 'apps/web/scripts/performance*', 'apps/web/tests/performance', 'apps/web/tests/visual/static-server.ts']) !== '',
  fixtureSha256: digestFiles([
    path.join(webRoot, 'tests/visual/fixtures.ts'),
    path.join(webRoot, 'tests/performance/fixtures.ts'),
  ]),
  harnessSha256: digestFiles([
    path.join(webRoot, 'scripts/performance-docker.ts'),
    path.join(webRoot, 'tests/performance/playwright.config.ts'),
    path.join(webRoot, 'tests/performance/interactions.pw.ts'),
    path.join(webRoot, 'scripts/performance-build.ts'),
    path.join(webRoot, 'tests/performance/profiling-overlay.ts'),
    path.join(webRoot, 'tests/visual/harness.ts'),
    path.join(webRoot, 'tests/visual/static-server.ts'),
  ]),
  playwrightVersion: version,
  image,
  imageId: command('docker', ['image', 'inspect', '--format', '{{.Id}}', image]),
  host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length },
}

const result = spawnSync('docker', [
  'run', '--rm', '--pull=never', '--ipc=host',
  '--user', `${process.getuid!()}:${process.getgid!()}`,
  '-e', 'TZ=Asia/Shanghai', '-e', 'XDG_CACHE_HOME=/tmp',
  '-e', `PERFORMANCE_METADATA=${JSON.stringify(metadata)}`,
  '-e', `PERFORMANCE_OUTPUT=/work/${path.relative(repoRoot, output)}`,
  '-e', `PERFORMANCE_EXPECT_DRAG=${process.env.PERFORMANCE_EXPECT_DRAG || 'completed'}`,
  '-e', `PERFORMANCE_PROFILE=${buildMetadata ? '1' : '0'}`,
  '-e', 'STATIC_DIST_DIR=/performance-dist',
  '-v', `${distRoot}:/performance-dist:ro`,
  '-v', `${repoRoot}:/work`, '-w', '/work', image,
  'node', cli, 'test', '--config', 'apps/web/tests/performance/playwright.config.ts',
  ...process.argv.slice(2),
], { cwd: repoRoot, stdio: 'inherit' })
process.exit(result.status ?? 1)
