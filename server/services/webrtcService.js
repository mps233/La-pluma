import { execFile, spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { closeSync, createWriteStream, openSync } from 'fs'
import { chmod, cp, mkdtemp, readFile, readdir, rename, rm } from 'fs/promises'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import path from 'path'
import { setTimeout as delay } from 'timers/promises'
import { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH } from '../config/connectionDefaults.js'
import { ensureDir, readJsonFile, writeJsonFile } from '../utils/fileHelper.js'

const execFileAsync = promisify(execFile)

export { DEFAULT_ADB_PATH }

const WEBRTC_DIR = process.env.LA_PLUMA_WEBRTC_DIR || `${process.env.HOME || ''}/ScrcpyOverWebRTC`
export const WEBRTC_PORT = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443)
const WEBRTC_TURN_PORT = Number(process.env.LA_PLUMA_WEBRTC_TURN_PORT || 3478)
export const DEFAULT_DEVICE_ADDRESS = DEFAULT_ADB_ADDRESS
export const DEFAULT_DEVICE_ID = 'mumu-la-pluma'
export const MINIMUM_WEBRTC_AGENT_VERSION = '0.4.3'

const WEBRTC_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i
const WEBRTC_RELEASE_REPO = 'hqw700/ScrcpyOverWebRTC'
const WEBRTC_RELEASE_API = `https://api.github.com/repos/${WEBRTC_RELEASE_REPO}/releases`
const WEBRTC_RELEASE_ASSET_PATTERN = /^cloudphone-v?(\d+\.\d+\.\d+)\.zip$/i

const WEBRTC_ERROR_STATUS = {
  WEBRTC_INSTALL_SERVER_RUNNING: 409,
  WEBRTC_RELEASE_FETCH_FAILED: 502,
  WEBRTC_RELEASE_DOWNLOAD_FAILED: 502,
  WEBRTC_RELEASE_SIZE_MISMATCH: 502,
  WEBRTC_RELEASE_CHECKSUM_MISMATCH: 502,
  WEBRTC_RELEASE_ASSET_MISSING: 502,
  WEBRTC_RELEASE_DIGEST_MISSING: 502,
  WEBRTC_RELEASE_EXTRACT_FAILED: 500,
  WEBRTC_RELEASE_LAYOUT_INVALID: 422,
  WEBRTC_PLATFORM_UNSUPPORTED: 500,
  WEBRTC_DEVICE_SECRET_INVALID: 500,
  WEBRTC_AGENT_DEPLOYMENT_SCRIPT_UNSUPPORTED: 500
}

const WEBRTC_REQUEST_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_REQUEST_TIMEOUT_MS, 1500)
const WEBRTC_SERVER_START_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_SERVER_START_TIMEOUT_MS, 15000)
const WEBRTC_AGENT_START_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_AGENT_START_TIMEOUT_MS, 20000)
const WEBRTC_START_POLL_INTERVAL_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_START_POLL_INTERVAL_MS, 250)
const WEBRTC_RELEASE_REQUEST_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_RELEASE_REQUEST_TIMEOUT_MS, 15_000)
const WEBRTC_RELEASE_DOWNLOAD_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_RELEASE_DOWNLOAD_TIMEOUT_MS, 10 * 60_000)
const WEBRTC_RELEASE_EXTRACT_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_RELEASE_EXTRACT_TIMEOUT_MS, 2 * 60_000)
const WEBRTC_AUTH_TOKEN_TTL_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_TOKEN_TTL_MS, 5 * 60_000)
const DEFAULT_WEBRTC_PASSWORD = 'admin123'
const WEBRTC_DEVICE_SECRET = process.env.LA_PLUMA_WEBRTC_DEVICE_SECRET || ''
const WEBRTC_DEVICE_SECRET_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/
const WEBRTC_USERNAME = process.env.LA_PLUMA_WEBRTC_USERNAME || 'admin'
const WEBRTC_PASSWORD = process.env.LA_PLUMA_WEBRTC_PASSWORD || DEFAULT_WEBRTC_PASSWORD
const WEBRTC_TURN_USERNAME = process.env.LA_PLUMA_WEBRTC_TURN_USERNAME || 'cloudphone_user'
const WEBRTC_TURN_PASSWORD = process.env.LA_PLUMA_WEBRTC_TURN_PASSWORD || 'cloudphone_secure_password@'

let webrtcServerProcess = null
let webrtcAgentProcess = null
let webrtcTurnProcess = null
let webrtcLifecycleQueue = Promise.resolve()
let registeredAgentOwner = null
let webrtcAuthTokenCache = { token: '', expiresAt: 0 }
let webrtcInstallState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null
}
const processStartupErrors = new WeakMap()

function readPositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseWebrtcVersion(value) {
  const match = String(value || '').trim().match(WEBRTC_VERSION_PATTERN)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareWebrtcVersions(left, right) {
  const leftParts = Array.isArray(left) ? left : parseWebrtcVersion(left)
  const rightParts = Array.isArray(right) ? right : parseWebrtcVersion(right)
  if (!leftParts || !rightParts) return null

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1
    }
  }
  return 0
}

export function getWebrtcAgentVersionStatus(agentVersion, minimumVersion = MINIMUM_WEBRTC_AGENT_VERSION) {
  const comparison = compareWebrtcVersions(agentVersion, minimumVersion)
  if (comparison === null) return 'unknown'
  return comparison < 0 ? 'outdated' : 'ok'
}

function createWebrtcError(code, message, { retryable = false, details, statusCode } = {}) {
  const error = new Error(message)
  error.code = code
  error.retryable = retryable
  if (details) error.details = details
  const resolvedStatus = statusCode || WEBRTC_ERROR_STATUS[code]
  if (resolvedStatus) error.statusCode = resolvedStatus
  return error
}

function getWebrtcDeviceSecretOrThrow() {
  if (!WEBRTC_DEVICE_SECRET) return ''
  if (!WEBRTC_DEVICE_SECRET_PATTERN.test(WEBRTC_DEVICE_SECRET)) {
    throw createWebrtcError(
      'WEBRTC_DEVICE_SECRET_INVALID',
      'LA_PLUMA_WEBRTC_DEVICE_SECRET 只能包含字母、数字、点、下划线、波浪线和短横线',
      { retryable: false, statusCode: 500 }
    )
  }
  return WEBRTC_DEVICE_SECRET
}

export function patchAgentDeploymentScript(script, secret = WEBRTC_DEVICE_SECRET) {
  if (!secret) return script
  if (!WEBRTC_DEVICE_SECRET_PATTERN.test(secret)) {
    throw createWebrtcError(
      'WEBRTC_DEVICE_SECRET_INVALID',
      'Agent 设备密钥格式无效',
      { retryable: false, statusCode: 500 }
    )
  }

  const exportLine = `export DEVICE_SECRET='${secret}'; `
  if (script.includes('ENV_EXPORTS=""')) {
    return script.replace('ENV_EXPORTS=""', `ENV_EXPORTS="${exportLine}"`)
  }
  if (script.includes('env GODEBUG=asyncpreemptoff=1')) {
    return script.replace('env GODEBUG=asyncpreemptoff=1', `env GODEBUG=asyncpreemptoff=1 DEVICE_SECRET='${secret}'`)
  }
  throw createWebrtcError(
    'WEBRTC_AGENT_DEPLOYMENT_SCRIPT_UNSUPPORTED',
    'Agent 部署脚本不支持注入设备密钥，请升级 ScrcpyOverWebRTC 或使用 Magisk/App 部署',
    { retryable: false, statusCode: 500 }
  )
}

export function getWebrtcPlatformDir(platform = process.platform, arch = process.arch) {
  const platformName = platform === 'win32'
    ? 'windows'
    : platform === 'darwin' || platform === 'linux'
      ? platform
      : null
  const archName = arch === 'arm64'
    ? 'arm64'
    : arch === 'x64'
      ? 'amd64'
      : null

  if (!platformName || !archName) {
    throw createWebrtcError(
      'WEBRTC_PLATFORM_UNSUPPORTED',
      `不支持的 WebRTC 平台：${platform}/${arch}`,
      { retryable: false }
    )
  }
  return `${platformName}_${archName}`
}

function getWebrtcBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'webrtc-signaling.exe' : 'webrtc-signaling'
}

function enqueueLifecycle(operation) {
  const pending = webrtcLifecycleQueue.then(operation, operation)
  webrtcLifecycleQueue = pending.then(() => undefined, () => undefined)
  return pending
}

function isChildProcessRunning(child) {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

function terminateAgentDeployment(child) {
  if (!isChildProcessRunning(child)) return
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Fall back when the child did not establish its process group.
    }
  }
  child.kill('SIGTERM')
}

function clearManagedProcess(type, child) {
  if (type === 'server' && webrtcServerProcess === child) webrtcServerProcess = null
  if (type === 'agent' && webrtcAgentProcess === child) webrtcAgentProcess = null
  if (type === 'turn' && webrtcTurnProcess === child) webrtcTurnProcess = null
}

function trackManagedProcess(child, type) {
  child.once('error', error => {
    processStartupErrors.set(child, error)
    clearManagedProcess(type, child)
  })
  child.once('exit', () => clearManagedProcess(type, child))
  return child
}

function spawnWithLog(command, args, logPath, options) {
  const logFd = openSync(logPath, 'a')
  try {
    return spawn(command, args, {
      ...options,
      stdio: ['ignore', logFd, logFd]
    })
  } finally {
    closeSync(logFd)
  }
}

function processStartupFailure(child, label, { allowSuccessfulExit = false } = {}) {
  if (!child) return null
  const spawnError = processStartupErrors.get(child)
  if (spawnError) {
    const error = new Error(`${label}进程启动失败：${spawnError.message}`)
    error.code = 'WEBRTC_PROCESS_START_FAILED'
    error.retryable = false
    return error
  }
  if (child.signalCode !== null || (child.exitCode !== null && (!allowSuccessfulExit || child.exitCode !== 0))) {
    const reason = child.signalCode ? `信号 ${child.signalCode}` : `退出码 ${child.exitCode}`
    const error = new Error(`${label}进程在就绪前退出（${reason}）`)
    error.code = 'WEBRTC_PROCESS_EXITED'
    error.retryable = false
    return error
  }
  return null
}

export async function waitForCondition(check, {
  timeoutMs,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
  timeoutMessage,
  timeoutCode = 'WEBRTC_START_TIMEOUT'
}) {
  const startedAt = Date.now()
  let lastError = null

  while (true) {
    try {
      const result = await check()
      if (result) return result
      lastError = null
    } catch (error) {
      if (error?.retryable === false) throw error
      lastError = error
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= timeoutMs) {
      const detail = lastError?.message ? `；最后一次检查失败：${lastError.message}` : ''
      const error = new Error(`${timeoutMessage}${detail}`)
      error.code = timeoutCode
      if (lastError) error.cause = lastError
      throw error
    }
    await delay(Math.min(pollIntervalMs, timeoutMs - elapsed))
  }
}

async function execFileQuiet(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { timeout: 5000, ...options })
  } catch (error) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', error }
  }
}

export function parseAdbDeviceState(devicesOutput, address) {
  for (const line of String(devicesOutput || '').split(/\r?\n/)) {
    const [serial, state] = line.trim().split(/\s+/)
    if (serial === address) return state || null
  }
  return null
}

async function readAdbDeviceState(address, adbPath) {
  const { stdout, error } = await execFileQuiet(adbPath, ['devices'], { timeout: 5000 })
  if (error) {
    const commandError = new Error(`无法执行 ADB：${error.message}`)
    commandError.code = error.code === 'ENOENT' ? 'WEBRTC_ADB_NOT_FOUND' : 'WEBRTC_ADB_COMMAND_FAILED'
    commandError.retryable = error.code !== 'ENOENT'
    throw commandError
  }
  return parseAdbDeviceState(stdout, address)
}

export async function waitForAdbDeviceReady(address, adbPath, {
  timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
  getDeviceState = () => readAdbDeviceState(address, adbPath)
} = {}) {
  let lastState = null
  try {
    return await waitForCondition(async () => {
      lastState = await getDeviceState()
      return lastState === 'device' ? lastState : false
    }, {
      timeoutMs,
      pollIntervalMs,
      timeoutMessage: `等待 ADB 设备就绪超时（${timeoutMs}ms）：${address}`,
      timeoutCode: 'WEBRTC_ADB_READY_TIMEOUT'
    })
  } catch (error) {
    if (error?.code !== 'WEBRTC_ADB_READY_TIMEOUT') throw error

    const stateMessages = {
      offline: `ADB 设备离线：${address}`,
      unauthorized: `ADB 设备未授权：${address}，请在设备上允许调试`,
      no_permissions: `ADB 无权访问设备：${address}`
    }
    const readinessError = new Error(stateMessages[lastState] || `ADB 中未找到目标设备：${address}`)
    readinessError.code = lastState === 'offline'
      ? 'WEBRTC_ADB_DEVICE_OFFLINE'
      : lastState === 'unauthorized'
        ? 'WEBRTC_ADB_DEVICE_UNAUTHORIZED'
        : lastState === 'no_permissions'
          ? 'WEBRTC_ADB_DEVICE_FORBIDDEN'
          : 'WEBRTC_ADB_DEVICE_NOT_FOUND'
    readinessError.retryable = true
    readinessError.cause = error
    throw readinessError
  }
}

async function getListeningPidsOnTcpPort(port) {
  const { stdout } = await execFileQuiet('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return stdout.trim().split(/\s+/).filter(Boolean)
}

async function isProcessListeningOnTcpPort(port) {
  return (await getListeningPidsOnTcpPort(port)).length > 0
}

async function killListeningPidsOnTcpPort(port) {
  const pids = await getListeningPidsOnTcpPort(port)
  await Promise.all(pids.map(pid => execFileQuiet('/bin/kill', ['-TERM', pid])))
}

export async function pathExists(filePath) {
  const fs = await import('fs/promises')
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function getWebrtcBinaryPath() {
  return path.join(WEBRTC_DIR, 'bin', getWebrtcPlatformDir(), getWebrtcBinaryName())
}

export async function getWebrtcAssetsPath() {
  const legacyAssetsPath = path.join(WEBRTC_DIR, 'assets', 'v1')
  if (await pathExists(legacyAssetsPath)) return legacyAssetsPath

  const releaseAssetsPath = path.join(WEBRTC_DIR, 'assets')
  if (await pathExists(path.join(releaseAssetsPath, 'index.html'))) return releaseAssetsPath

  return null
}

export async function getWebrtcServerVersion() {
  for (const fileName of ['.la-pluma-release.json', 'la-pluma-runtime.json']) {
    const metadata = await readJsonFile(path.join(WEBRTC_DIR, fileName), null).catch(() => null)
    const version = typeof metadata?.version === 'string' ? metadata.version.trim() : ''
    if (version) return version
  }
  return null
}

export function parseSha256Digest(digest) {
  const match = String(digest || '').trim().match(/^sha256:([a-f0-9]{64})$/i)
  return match ? match[1].toLowerCase() : null
}

export function selectWebrtcReleaseAsset(assets = []) {
  const candidates = []
  for (const asset of Array.isArray(assets) ? assets : []) {
    const match = String(asset?.name || '').match(WEBRTC_RELEASE_ASSET_PATTERN)
    if (match) candidates.push({ asset, version: `v${match[1]}` })
  }
  candidates.sort((left, right) => compareWebrtcVersions(right.version, left.version) || 0)
  return candidates[0]?.asset || null
}

export async function resolveWebrtcRelease({
  version = process.env.LA_PLUMA_WEBRTC_VERSION || 'latest',
  fetchImpl = fetch
} = {}) {
  const requestedVersion = String(version || 'latest').trim() || 'latest'
  const endpoint = requestedVersion === 'latest'
    ? `${WEBRTC_RELEASE_API}/latest`
    : `${WEBRTC_RELEASE_API}/tags/${encodeURIComponent(requestedVersion.startsWith('v') ? requestedVersion : `v${requestedVersion}`)}`

  let response
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'la-pluma-webrtc-installer'
      },
      signal: AbortSignal.timeout(WEBRTC_RELEASE_REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_FETCH_FAILED',
      `无法获取 ScrcpyOverWebRTC 发布信息：${error.message}`,
      { retryable: true }
    )
  }

  if (!response.ok) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_FETCH_FAILED',
      `无法获取 ScrcpyOverWebRTC 发布信息（HTTP ${response.status}）`,
      { retryable: response.status >= 500 || response.status === 429 }
    )
  }

  const release = await response.json().catch(() => null)
  const asset = selectWebrtcReleaseAsset(release?.assets)
  if (!asset) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_ASSET_MISSING',
      'ScrcpyOverWebRTC 发布包中未找到 cloudphone-vX.Y.Z.zip',
      { retryable: false }
    )
  }
  if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url) {
    throw createWebrtcError('WEBRTC_RELEASE_ASSET_MISSING', 'WebRTC 发布包缺少下载地址', { retryable: false })
  }

  const sha256 = parseSha256Digest(asset.digest)
  if (!sha256) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DIGEST_MISSING',
      'WebRTC 发布包缺少 SHA256 摘要，已拒绝未校验的安装',
      { retryable: false, details: { assetName: asset.name } }
    )
  }

  return {
    version: typeof release?.tag_name === 'string' && release.tag_name ? release.tag_name : asset.name,
    assetName: asset.name,
    url: asset.browser_download_url,
    size: Number(asset.size) || null,
    sha256
  }
}

export async function downloadWebrtcRelease(release, destination, { fetchImpl = fetch } = {}) {
  if (!release?.url) {
    throw createWebrtcError('WEBRTC_RELEASE_ASSET_MISSING', 'WebRTC 发布包缺少下载地址', { retryable: false })
  }
  await ensureDir(path.dirname(destination))

  let response
  try {
    response = await fetchImpl(release.url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'la-pluma-webrtc-installer'
      },
      signal: AbortSignal.timeout(WEBRTC_RELEASE_DOWNLOAD_TIMEOUT_MS)
    })
  } catch (error) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DOWNLOAD_FAILED',
      `下载 WebRTC 发布包失败：${error.message}`,
      { retryable: true }
    )
  }

  if (!response.ok || !response.body) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DOWNLOAD_FAILED',
      `下载 WebRTC 发布包失败（HTTP ${response.status}）`,
      { retryable: response.status >= 500 || response.status === 429 }
    )
  }

  const hash = createHash('sha256')
  let size = 0
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    }
  })

  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, { mode: 0o600 }))
  } catch (error) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DOWNLOAD_FAILED',
      `下载 WebRTC 发布包失败：${error.message}`,
      { retryable: true }
    )
  }

  const actualSha256 = hash.digest('hex')
  if (release.size && Number(release.size) !== size) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_SIZE_MISMATCH',
      `WebRTC 发布包大小不匹配（期望 ${release.size}，实际 ${size}）`,
      { retryable: true }
    )
  }
  if (release.sha256 && actualSha256 !== String(release.sha256).toLowerCase()) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_CHECKSUM_MISMATCH',
      'WebRTC 发布包 SHA256 校验失败',
      { retryable: true, details: { expected: release.sha256, actual: actualSha256 } }
    )
  }

  return { size, sha256: actualSha256 }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export async function extractWebrtcArchive(archivePath, destination) {
  await ensureDir(destination)
  try {
    if (process.platform === 'win32') {
      const script = `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destination)} -Force`
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: WEBRTC_RELEASE_EXTRACT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      })
    } else {
      await execFileAsync('unzip', ['-q', '-o', archivePath, '-d', destination], {
        timeout: WEBRTC_RELEASE_EXTRACT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      })
    }
  } catch (error) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_EXTRACT_FAILED',
      `解压 WebRTC 发布包失败：${error.message}`,
      { retryable: error?.code !== 'ENOENT', details: { archivePath } }
    )
  }
}

export async function findWebrtcReleaseRoot(rootDir) {
  const hasLayout = async dir => (
    await pathExists(path.join(dir, 'bin')) &&
    await pathExists(path.join(dir, 'assets')) &&
    await pathExists(path.join(dir, 'agentd'))
  )

  if (await hasLayout(rootDir)) return rootDir

  let entries
  try {
    entries = await readdir(rootDir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(rootDir, entry.name)
    if (await hasLayout(candidate)) return candidate
  }
  return null
}

export async function validateWebrtcReleaseLayout(releaseRoot, {
  platform = process.platform,
  arch = process.arch
} = {}) {
  const platformDir = getWebrtcPlatformDir(platform, arch)
  const binaryPath = path.join(releaseRoot, 'bin', platformDir, getWebrtcBinaryName(platform))
  const assetsIndex = path.join(releaseRoot, 'assets', 'index.html')
  const agentRunScript = path.join(releaseRoot, 'agentd', 'run.sh')
  const missing = []

  if (!await pathExists(binaryPath)) missing.push(path.relative(releaseRoot, binaryPath))
  if (!await pathExists(assetsIndex)) missing.push(path.relative(releaseRoot, assetsIndex))
  if (!await pathExists(agentRunScript)) missing.push(path.relative(releaseRoot, agentRunScript))

  if (missing.length > 0) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_LAYOUT_INVALID',
      `WebRTC 发布包缺少当前平台所需文件：${missing.join(', ')}`,
      { retryable: false, details: { missing, platformDir } }
    )
  }

  return { binaryPath, assetsIndex, agentRunScript, platformDir }
}

async function copyWebrtcReleaseContents(sourceDir, destinationDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  await Promise.all(entries.map(entry => cp(
    path.join(sourceDir, entry.name),
    path.join(destinationDir, entry.name),
    { recursive: true, force: true }
  )))
}

export async function installWebrtcReleaseDirectory(releaseRoot, release = {}, {
  platform = process.platform,
  arch = process.arch,
  getStatus = getWebrtcStatus
} = {}) {
  const { platformDir } = await validateWebrtcReleaseLayout(releaseRoot, { platform, arch })

  if (await isWebrtcServerReachable()) {
    throw createWebrtcError(
      'WEBRTC_INSTALL_SERVER_RUNNING',
      'WebRTC 服务正在运行，请先停止服务后再安装或升级组件',
      { retryable: true }
    )
  }

  const parentDir = path.dirname(WEBRTC_DIR) || process.cwd()
  await ensureDir(parentDir)
  const currentVersion = await getWebrtcServerVersion().catch(() => null)
  const safeVersion = String(currentVersion || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-')
  const backupDir = `${WEBRTC_DIR}.backup-${safeVersion}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const hadExisting = await pathExists(WEBRTC_DIR)
  let movedExisting = false

  try {
    if (hadExisting) {
      await rename(WEBRTC_DIR, backupDir)
      movedExisting = true
    }

    await ensureDir(WEBRTC_DIR)
    await copyWebrtcReleaseContents(releaseRoot, WEBRTC_DIR)

    if (movedExisting) {
      for (const name of ['data', 'certs']) {
        const preservedPath = path.join(backupDir, name)
        if (!await pathExists(preservedPath)) continue
        await rm(path.join(WEBRTC_DIR, name), { recursive: true, force: true })
        await cp(preservedPath, path.join(WEBRTC_DIR, name), { recursive: true, force: true })
      }
    }

    await chmod(path.join(WEBRTC_DIR, 'bin', platformDir, getWebrtcBinaryName(platform)), 0o755).catch(() => {})
    await chmod(path.join(WEBRTC_DIR, 'agentd', 'run.sh'), 0o755).catch(() => {})

    const installedAt = new Date().toISOString()
    const metadata = {
      version: typeof release.version === 'string' && release.version ? release.version : (currentVersion || 'unknown'),
      assetName: release.assetName || null,
      source: release.url || null,
      size: release.size || null,
      sha256: release.sha256 || null,
      installedAt,
      backupDir: movedExisting ? backupDir : null
    }
    await writeJsonFile(path.join(WEBRTC_DIR, '.la-pluma-release.json'), metadata)
    await writeJsonFile(path.join(WEBRTC_DIR, 'la-pluma-runtime.json'), {
      version: metadata.version,
      installedAt
    })
    clearWebrtcAuthTokenCache()
  } catch (error) {
    if (movedExisting) {
      await rm(WEBRTC_DIR, { recursive: true, force: true }).catch(() => {})
      await rename(backupDir, WEBRTC_DIR).catch(() => {})
    } else if (!hadExisting) {
      await rm(WEBRTC_DIR, { recursive: true, force: true }).catch(() => {})
    }
    throw error
  }

  return getStatus()
}

async function getMacLanIp() {
  const interfaces = ['en0', 'en1']
  for (const name of interfaces) {
    try {
      const { stdout } = await execFileAsync('ipconfig', ['getifaddr', name], { timeout: 2000 })
      const ip = stdout.trim()
      if (ip) return ip
    } catch {
      // try next interface
    }
  }
  return '127.0.0.1'
}

export async function getWebrtcLogPaths() {
  return {
    serverLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-server.log'),
    agentLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-agent.log'),
    turnLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-turn.log')
  }
}

export async function isWebrtcServerReachable() {
  try {
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}`, {
      signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS)
    })
    return response.ok
  } catch {
    return false
  }
}

async function requestWebrtcAuthToken({ force = false } = {}) {
  const now = Date.now()
  if (!force && webrtcAuthTokenCache.token && now < webrtcAuthTokenCache.expiresAt) {
    return webrtcAuthTokenCache.token
  }

  const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: WEBRTC_USERNAME, password: WEBRTC_PASSWORD }),
    signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`WebRTC 登录失败（HTTP ${response.status}）`)
  }
  const data = await response.json()
  if (!data?.token) throw new Error('WebRTC 登录响应缺少 token')
  webrtcAuthTokenCache = {
    token: data.token,
    expiresAt: Date.now() + WEBRTC_AUTH_TOKEN_TTL_MS
  }
  return data.token
}

export function clearWebrtcAuthTokenCache() {
  webrtcAuthTokenCache = { token: '', expiresAt: 0 }
}

export async function getWebrtcAuthToken({ throwOnError = false } = {}) {
  try {
    return await requestWebrtcAuthToken()
  } catch (error) {
    if (throwOnError) throw error
    return ''
  }
}

async function fetchWebrtcAuthorized(pathname) {
  const request = token => fetch(`http://127.0.0.1:${WEBRTC_PORT}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS)
  })

  let token = await requestWebrtcAuthToken()
  let response = await request(token)
  if (response.status === 401) {
    clearWebrtcAuthTokenCache()
    token = await requestWebrtcAuthToken({ force: true })
    response = await request(token)
  }
  return response
}

async function fetchWebrtcSnapshotResponse(deviceId) {
  const request = token => fetch(
    `http://127.0.0.1:${WEBRTC_PORT}/snapshots/${encodeURIComponent(deviceId)}.jpg?token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS) }
  )

  let token = await requestWebrtcAuthToken()
  let response = await request(token)
  if (response.status === 401) {
    clearWebrtcAuthTokenCache()
    token = await requestWebrtcAuthToken({ force: true })
    response = await request(token)
  }
  return response
}

function normalizeDeviceRecord(item) {
  if (typeof item === 'string') {
    return {
      id: item,
      online: true,
      agentVersion: null,
      snapshotHash: null,
      screenState: null
    }
  }

  const id = item?.device_id || item?.id
  if (typeof id !== 'string' || !id.trim()) return null

  const deviceInfo = item?.device_info && typeof item.device_info === 'object' ? item.device_info : {}
  const rawAgentVersion = typeof deviceInfo.agent_version === 'string'
    ? deviceInfo.agent_version
    : typeof deviceInfo.app_version === 'string'
      ? deviceInfo.app_version
      : ''

  return {
    id: id.trim(),
    online: item?.online !== false,
    agentVersion: rawAgentVersion.trim() || null,
    snapshotHash: typeof item?.snapshot_hash === 'string' ? item.snapshot_hash : null,
    screenState: typeof item?.screen_state === 'string' ? item.screen_state : null
  }
}

export async function getWebrtcDeviceRecords({ throwOnError = false } = {}) {
  try {
    const response = await fetchWebrtcAuthorized('/devices')
    if (!response.ok) {
      throw new Error(`WebRTC 设备列表请求失败（HTTP ${response.status}）`)
    }
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('WebRTC /devices 响应格式无效')
    return data.map(normalizeDeviceRecord).filter(Boolean)
  } catch (error) {
    if (throwOnError) throw error
    return []
  }
}

export async function getWebrtcSnapshot(deviceId = DEFAULT_DEVICE_ID, { throwOnError = false } = {}) {
  try {
    const response = await fetchWebrtcSnapshotResponse(deviceId)
    if (!response.ok) {
      throw new Error(`WebRTC 快照请求失败（HTTP ${response.status}）`)
    }
    const mediaType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    if (!mediaType.startsWith('image/')) {
      throw new Error(`WebRTC 快照响应类型无效：${mediaType || 'unknown'}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error('WebRTC 快照为空')
    return {
      deviceId,
      image: buffer.toString('base64'),
      mediaType,
      size: buffer.length,
      capturedAt: new Date().toISOString()
    }
  } catch (error) {
    if (throwOnError) throw error
    return null
  }
}

export async function getWebrtcDevices({ throwOnError = false } = {}) {
  const records = await getWebrtcDeviceRecords({ throwOnError })
  return records.filter(record => record.online).map(record => record.id)
}

export async function waitForWebrtcServerReady({
  timeoutMs = WEBRTC_SERVER_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
  isReachable = isWebrtcServerReachable,
  childProcess = null
} = {}) {
  return waitForCondition(async () => {
    const failure = processStartupFailure(childProcess, 'WebRTC 服务')
    if (failure) throw failure
    return isReachable()
  }, {
    timeoutMs,
    pollIntervalMs,
    timeoutMessage: `WebRTC 服务启动超时（${timeoutMs}ms）：http://127.0.0.1:${WEBRTC_PORT} 未就绪`,
    timeoutCode: 'WEBRTC_SERVER_START_TIMEOUT'
  })
}

async function waitForWebrtcDevicesApi({
  timeoutMs = WEBRTC_SERVER_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS
} = {}) {
  const result = await waitForCondition(async () => ({
    devices: await getWebrtcDevices({ throwOnError: true })
  }), {
    timeoutMs,
    pollIntervalMs,
    timeoutMessage: `WebRTC 鉴权设备接口启动超时（${timeoutMs}ms）：/devices 未就绪`,
    timeoutCode: 'WEBRTC_DEVICES_API_TIMEOUT'
  })
  return result.devices
}

export async function waitForWebrtcDevice(deviceId, {
  timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
  getDevices = () => getWebrtcDevices({ throwOnError: true }),
  childProcess = null,
  isAgentRunning = null
} = {}) {
  return waitForCondition(async () => {
    const failure = processStartupFailure(childProcess, 'WebRTC Agent 部署', { allowSuccessfulExit: true })
    if (failure) throw failure
    if (childProcess && childProcess.exitCode !== 0) return false
    if (childProcess?.exitCode === 0 && isAgentRunning && !await isAgentRunning()) {
      const error = new Error('WebRTC Agent 部署脚本已结束，但设备端进程未启动')
      error.code = 'WEBRTC_AGENT_DEPLOYMENT_FAILED'
      error.retryable = true
      throw error
    }
    const devices = await getDevices()
    if (!devices.includes(deviceId)) return false
    if (isAgentRunning && !await isAgentRunning()) return false
    return devices
  }, {
    timeoutMs,
    pollIntervalMs,
    timeoutMessage: `WebRTC Agent 启动超时（${timeoutMs}ms）：设备 ${deviceId} 未出现在鉴权 /devices 列表中`,
    timeoutCode: 'WEBRTC_AGENT_START_TIMEOUT'
  })
}

async function waitForWebrtcDeviceUnavailable(deviceId, {
  timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS
} = {}) {
  return waitForCondition(async () => {
    const devices = await getWebrtcDevices({ throwOnError: true })
    return devices.includes(deviceId) ? false : devices
  }, {
    timeoutMs,
    pollIntervalMs,
    timeoutMessage: `WebRTC Agent 停止超时（${timeoutMs}ms）：设备 ${deviceId} 仍在鉴权 /devices 列表中`,
    timeoutCode: 'WEBRTC_AGENT_STOP_TIMEOUT'
  })
}

async function isDeviceAgentRunning(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  try {
    const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'ps | grep cloudphone-agent || true'], { timeout: 5000 })
    return stdout.includes('cloudphone-agent')
  } catch {
    return false
  }
}

async function getIceServersConfig() {
  const lanIp = await getMacLanIp()
  return `turn:${WEBRTC_TURN_USERNAME}:${WEBRTC_TURN_PASSWORD}@${lanIp}:${WEBRTC_TURN_PORT}?transport=udp,stun:${lanIp}:${WEBRTC_TURN_PORT}`
}

function isSameAgentOwner(owner, address, deviceId) {
  return owner?.address === address && owner?.deviceId === deviceId
}

async function stopRemoteWebrtcAgent(address, adbPath) {
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f cloudphone-agent || true'], { timeout: 5000 }).catch(() => {})
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f scrcpy.Server || true'], { timeout: 5000 }).catch(() => {})
}

async function startLocalTurnServerUnlocked() {
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) return
  if (await isProcessListeningOnTcpPort(WEBRTC_TURN_PORT)) return
  const turnserver = '/opt/homebrew/bin/turnserver'
  if (!await pathExists(turnserver)) return
  const { turnLog } = await getWebrtcLogPaths()
  const child = spawnWithLog(turnserver, [
    '-n',
    '--no-cli',
    '--no-tls',
    '--no-dtls',
    '-L', '0.0.0.0',
    '-p', String(WEBRTC_TURN_PORT),
    '-a',
    '-u', `${WEBRTC_TURN_USERNAME}:${WEBRTC_TURN_PASSWORD}`,
    '-r', 'cloudphone'
  ], turnLog, {
    cwd: WEBRTC_DIR,
    detached: false
  })
  webrtcTurnProcess = trackManagedProcess(child, 'turn')
}

async function killLocalWebrtcInfrastructureUnlocked(address, adbPath) {
  const owner = registeredAgentOwner
  terminateAgentDeployment(webrtcAgentProcess)
  if (webrtcServerProcess && !webrtcServerProcess.killed) webrtcServerProcess.kill('SIGTERM')
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) webrtcTurnProcess.kill('SIGTERM')
  webrtcAgentProcess = null
  webrtcServerProcess = null
  webrtcTurnProcess = null
  registeredAgentOwner = null

  await killListeningPidsOnTcpPort(WEBRTC_PORT)
  await killListeningPidsOnTcpPort(WEBRTC_TURN_PORT)
  if (owner && owner.address !== address) {
    await stopRemoteWebrtcAgent(owner.address, owner.adbPath)
  }
  await stopRemoteWebrtcAgent(address, adbPath)
}

export async function getWebrtcStatus(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH, {
  agentRunning = null
} = {}) {
  const binaryPath = await getWebrtcBinaryPath()
  const assetsPath = await getWebrtcAssetsPath()
  const lanIp = await getMacLanIp()
  const logPaths = await getWebrtcLogPaths()
  const serverReachable = await isWebrtcServerReachable()
  const deviceAgentRunning = agentRunning === null
    ? await isDeviceAgentRunning(address, adbPath)
    : agentRunning
  return {
    installed: await pathExists(WEBRTC_DIR),
    built: await pathExists(binaryPath) && assetsPath !== null,
    dir: WEBRTC_DIR,
    port: WEBRTC_PORT,
    url: `http://127.0.0.1:${WEBRTC_PORT}`,
    lanUrl: `http://${lanIp}:${WEBRTC_PORT}`,
    signalingUrl: '/webrtc-signaling',
    directSignalingUrl: `ws://${lanIp}:${WEBRTC_PORT}`,
    turnRunning: !!webrtcTurnProcess && !webrtcTurnProcess.killed,
    serverRunning: (!!webrtcServerProcess && !webrtcServerProcess.killed) || serverReachable,
    agentRunning: (!!webrtcAgentProcess && !webrtcAgentProcess.killed) || deviceAgentRunning,
    usingDefaultPassword: WEBRTC_PASSWORD === DEFAULT_WEBRTC_PASSWORD,
    deviceAddress: address,
    ...logPaths
  }
}

export async function installWebrtc(options = {}) {
  const {
    resolveRelease = resolveWebrtcRelease,
    downloadRelease = downloadWebrtcRelease,
    extractRelease = extractWebrtcArchive,
    installRelease = installWebrtcReleaseDirectory,
    force = false
  } = options

  const release = await resolveRelease(options)
  const currentVersion = await getWebrtcServerVersion().catch(() => null)
  const sameVersion = release?.version && currentVersion
    ? compareWebrtcVersions(currentVersion, release.version) === 0
    : false
  const status = sameVersion ? await getWebrtcStatus().catch(() => null) : null
  const hasAgentRuntime = await pathExists(path.join(WEBRTC_DIR, 'agentd', 'run.sh'))

  if (!force && sameVersion && status?.built && hasAgentRuntime) {
    return status
  }

  if (await isWebrtcServerReachable()) {
    throw createWebrtcError(
      'WEBRTC_INSTALL_SERVER_RUNNING',
      'WebRTC 服务正在运行，请先停止服务后再安装或升级组件',
      { retryable: true }
    )
  }

  const parentDir = path.dirname(WEBRTC_DIR) || process.cwd()
  await ensureDir(parentDir)
  const tempDir = await mkdtemp(path.join(parentDir, '.la-pluma-webrtc-install-'))
  const archivePath = path.join(tempDir, release.assetName || 'cloudphone.zip')
  const extractDir = path.join(tempDir, 'extracted')

  try {
    await downloadRelease(release, archivePath)
    await extractRelease(archivePath, extractDir)
    const releaseRoot = await findWebrtcReleaseRoot(extractDir)
    if (!releaseRoot) {
      throw createWebrtcError(
        'WEBRTC_RELEASE_LAYOUT_INVALID',
        'WebRTC 发布包解压后未找到 bin/assets/agentd 目录',
        { retryable: false }
      )
    }
    return await installRelease(releaseRoot, release)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function getWebrtcInstallState() {
  return {
    ...webrtcInstallState,
    result: webrtcInstallState.result ? { ...webrtcInstallState.result } : null,
    error: webrtcInstallState.error ? { ...webrtcInstallState.error } : null
  }
}

export function resetWebrtcInstallStateForTests() {
  webrtcInstallState = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  }
}

export function startWebrtcInstall({ install = installWebrtc, ...options } = {}) {
  if (webrtcInstallState.status === 'running') {
    return getWebrtcInstallState()
  }

  const startedAt = new Date().toISOString()
  webrtcInstallState = {
    status: 'running',
    startedAt,
    finishedAt: null,
    result: null,
    error: null
  }

  void Promise.resolve()
    .then(() => install(options))
    .then(result => {
      webrtcInstallState = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        result,
        error: null
      }
    })
    .catch(error => {
      webrtcInstallState = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: {
          code: error?.code || 'WEBRTC_INSTALL_FAILED',
          message: error?.message || 'WebRTC 组件安装失败',
          retryable: error?.retryable ?? false,
          details: error?.details || {}
        }
      }
    })

  return getWebrtcInstallState()
}

async function startWebrtcServerUnlocked(address, adbPath) {
  if (await isWebrtcServerReachable()) {
    return getWebrtcStatus(address, adbPath)
  }

  let child = webrtcServerProcess
  let spawned = false
  if (!isChildProcessRunning(child)) {
    const binaryPath = await getWebrtcBinaryPath()
    const assetsPath = await getWebrtcAssetsPath()
    if (!await pathExists(binaryPath) || !assetsPath) {
      throw new Error('WebRTC 组件未安装或未构建')
    }

    await startLocalTurnServerUnlocked()
    const { serverLog } = await getWebrtcLogPaths()
    const iceServers = await getIceServersConfig()
    const deviceSecret = getWebrtcDeviceSecretOrThrow()
    const serverArgs = [
      '-host', '0.0.0.0',
      '-port', String(WEBRTC_PORT),
      '-assets', assetsPath,
      '-ice_servers', iceServers,
      '-tls=false',
      ...(deviceSecret ? ['-device-secret', deviceSecret] : [])
    ]
    child = spawnWithLog(binaryPath, serverArgs, serverLog, {
      cwd: WEBRTC_DIR,
      detached: false,
      env: { ...process.env, PORT: String(WEBRTC_PORT), PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
    })
    webrtcServerProcess = trackManagedProcess(child, 'server')
    spawned = true
  }

  try {
    await waitForWebrtcServerReady({ childProcess: child })
  } catch (error) {
    if (spawned && isChildProcessRunning(child)) child.kill('SIGTERM')
    clearManagedProcess('server', child)
    throw error
  }
  return getWebrtcStatus(address, adbPath)
}

export async function startWebrtcServer(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(() => startWebrtcServerUnlocked(address, adbPath))
}

async function stopWebrtcServerUnlocked(address, adbPath) {
  await killLocalWebrtcInfrastructureUnlocked(address, adbPath)
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtcServer(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(() => stopWebrtcServerUnlocked(address, adbPath))
}

async function startWebrtcAgentUnlocked(address, deviceId, adbPath) {
  await waitForWebrtcServerReady()
  const onlineDevices = await waitForWebrtcDevicesApi()
  const currentOwner = registeredAgentOwner
  if (isSameAgentOwner(currentOwner, address, deviceId)
    && onlineDevices.includes(deviceId)
    && await isDeviceAgentRunning(address, adbPath)) {
    registeredAgentOwner = { address, deviceId, adbPath }
    return { ...await getWebrtcStatus(address, adbPath), agentRunning: true }
  }

  if (/^[^:]+:\d+$/.test(address)) {
    await execFileQuiet(adbPath, ['connect', address], { timeout: 5000 })
  }
  await waitForAdbDeviceReady(address, adbPath)

  if (currentOwner) {
    registeredAgentOwner = null
    await stopRemoteWebrtcAgent(currentOwner.address, currentOwner.adbPath)
    await waitForWebrtcDeviceUnavailable(currentOwner.deviceId)
  }

  const runScript = path.join(WEBRTC_DIR, 'agentd', 'run.sh')
  if (!await pathExists(runScript)) {
    throw new Error('WebRTC agent 未安装')
  }

  const { agentLog } = await getWebrtcLogPaths()
  const lanIp = await getMacLanIp()
  const iceServers = await getIceServersConfig()
  const deviceSecret = getWebrtcDeviceSecretOrThrow()
  let deployCommand = 'bash'
  let deployArgs = [
    runScript,
    address,
    '-id', deviceId,
    '-signaling', `ws://${lanIp}:${WEBRTC_PORT}`,
    '-ice-servers', iceServers,
    '-webrtc-port', '50000'
  ]

  if (deviceSecret) {
    const runScriptContent = await readFile(runScript, 'utf8')
    deployArgs = [
      '-c',
      patchAgentDeploymentScript(runScriptContent, deviceSecret),
      'la-pluma-agentd',
      ...deployArgs.slice(1)
    ]
  }

  const child = spawnWithLog(deployCommand, deployArgs, agentLog, {
    cwd: path.join(WEBRTC_DIR, 'agentd'),
    detached: true,
    env: { ...process.env, ADB_PATH: adbPath, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  })
  webrtcAgentProcess = trackManagedProcess(child, 'agent')
  try {
    await waitForWebrtcDevice(deviceId, {
      childProcess: child,
      isAgentRunning: () => isDeviceAgentRunning(address, adbPath)
    })
    registeredAgentOwner = { address, deviceId, adbPath }
    return { ...await getWebrtcStatus(address, adbPath), agentRunning: true }
  } catch (error) {
    terminateAgentDeployment(child)
    clearManagedProcess('agent', child)
    if (isSameAgentOwner(registeredAgentOwner, address, deviceId)) registeredAgentOwner = null
    await stopRemoteWebrtcAgent(address, adbPath)
    throw error
  }
}

export async function startWebrtcAgent(address = DEFAULT_DEVICE_ADDRESS, deviceId = DEFAULT_DEVICE_ID, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(() => startWebrtcAgentUnlocked(address, deviceId, adbPath))
}

async function stopWebrtcAgentUnlocked(address, adbPath) {
  const owner = registeredAgentOwner
  terminateAgentDeployment(webrtcAgentProcess)
  webrtcAgentProcess = null
  registeredAgentOwner = null
  if (owner && owner.address !== address) {
    await stopRemoteWebrtcAgent(owner.address, owner.adbPath)
  }
  await stopRemoteWebrtcAgent(address, adbPath)
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtcAgent(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(() => stopWebrtcAgentUnlocked(address, adbPath))
}

export async function startWebrtc(address = DEFAULT_DEVICE_ADDRESS, deviceId = DEFAULT_DEVICE_ID, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(async () => {
    await startWebrtcServerUnlocked(address, adbPath)
    return startWebrtcAgentUnlocked(address, deviceId, adbPath)
  })
}

export async function stopWebrtc(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(async () => {
    await stopWebrtcAgentUnlocked(address, adbPath).catch(() => null)
    await stopWebrtcServerUnlocked(address, adbPath).catch(() => null)
    return { stopped: true }
  })
}
