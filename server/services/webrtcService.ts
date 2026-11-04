import { getErrorDetails } from '../utils/errors.ts';
import { asErrorWithCode, getErrorCode, getErrorMessage, isRecord } from '../utils/errors.ts';
import type { ErrorWithCode } from '../utils/errors.ts';
import { execFile, spawn } from 'child_process'
import type { ChildProcess, ExecFileOptionsWithStringEncoding, SpawnOptionsWithoutStdio } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { closeSync, createWriteStream, openSync } from 'fs'
import type { Dirent } from 'fs'
import { chmod, cp, mkdtemp, readFile, readdir, rename, rm } from 'fs/promises'
import { Readable, Transform } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import path from 'path'
import { setTimeout as delay } from 'timers/promises'
import { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH } from '../config/connectionDefaults.ts'
import { ensureDir, readJsonFile, writeJsonFile } from '../utils/fileHelper.ts'
import { createLogger } from '../utils/logger.ts'

const execFileAsync = promisify(execFile)
const logger = createLogger('Webrtc')

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


interface WebrtcAgentOwner {
  address: string
  deviceId: string
  adbPath: string
  generation?: number
}

interface WebrtcAuthTokenCache {
  token: string
  expiresAt: number
}

type WebrtcInstallStatus = 'idle' | 'running' | 'succeeded' | 'failed'

interface WebrtcInstallErrorSnapshot {
  code: string
  message: string
  retryable: boolean
  details: unknown
}

interface WebrtcInstallState {
  status: WebrtcInstallStatus
  startedAt: string | null
  finishedAt: string | null
  result: unknown
  error: WebrtcInstallErrorSnapshot | null
}

interface WebrtcInstallStateSnapshot {
  status: WebrtcInstallStatus
  startedAt: string | null
  finishedAt: string | null
  result: Record<string, unknown> | null
  error: WebrtcInstallErrorSnapshot | null
}

interface WebrtcErrorOptions {
  retryable?: boolean
  details?: unknown
  statusCode?: number
}

interface WebrtcDeviceRecord {
  id: string
  online: boolean
  agentVersion: string | null
  snapshotHash: string | null
  screenState: string | null
}

interface WebrtcSnapshot {
  deviceId: string
  image: string
  mediaType: string
  size: number
  capturedAt: string
}

interface WebrtcLogPaths {
  serverLog: string
  agentLog: string
  turnLog: string
}

interface WebrtcStatus extends WebrtcLogPaths {
  installed: boolean
  built: boolean
  dir: string
  port: number
  url: string
  lanUrl: string
  signalingUrl: string
  directSignalingUrl: string
  turnRunning: boolean
  serverRunning: boolean
  agentRunning: boolean
  usingDefaultPassword: boolean
  deviceAddress: string
  runtimeVersion: string | null
}

interface WebrtcReleaseInfo {
  version?: string | null
  assetName?: string | null
  url?: string | null
  size?: number | null
  sha256?: string | null
}

interface WebrtcFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  body?: WebReadableStream<Uint8Array> | null
}

interface WebrtcFetchInit {
  headers?: Record<string, string>
  signal?: AbortSignal
}

type WebrtcFetch = (url: string, init?: WebrtcFetchInit) => Promise<WebrtcFetchResponse>

interface ResolveWebrtcReleaseOptions {
  version?: string
  fetchImpl?: WebrtcFetch
}

interface DownloadWebrtcReleaseOptions {
  fetchImpl?: WebrtcFetch
}

interface DownloadWebrtcReleaseResult {
  size: number
  sha256: string
}

interface InstallWebrtcOptions extends ResolveWebrtcReleaseOptions {
  resolveRelease?: (options: InstallWebrtcOptions) => Promise<WebrtcReleaseInfo>
  downloadRelease?: (release: WebrtcReleaseInfo, destination: string) => Promise<unknown>
  extractRelease?: (archivePath: string, destination: string) => Promise<unknown>
  installRelease?: (releaseRoot: string, release: WebrtcReleaseInfo) => Promise<WebrtcStatus>
  force?: boolean
}

interface StartWebrtcInstallOptions extends InstallWebrtcOptions {
  install?: (options: InstallWebrtcOptions) => Promise<unknown>
}

interface WaitForConditionOptions {
  timeoutMs: number
  pollIntervalMs?: number
  timeoutMessage: string
  timeoutCode?: string
}

interface WaitForAdbDeviceOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  getDeviceState?: () => string | null | Promise<string | null>
}

interface WaitForWebrtcServerReadyOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  isReachable?: () => boolean | Promise<boolean>
  childProcess?: ChildProcess | null
}

interface WaitForWebrtcDeviceOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  getDevices?: () => Promise<string[]>
  childProcess?: ChildProcess | null
  isAgentRunning?: (() => boolean | Promise<boolean>) | null
}

interface WebrtcStatusOptions {
  agentRunning?: boolean | null
}

interface ExecFileQuietResult {
  stdout: string
  stderr: string
  error?: unknown
}

interface WebrtcReleaseLayout {
  binaryPath: string
  assetsIndex: string
  agentRunScript: string
  platformDir: string
}

type ManagedProcessType = 'server' | 'agent' | 'turn'

const WEBRTC_ERROR_STATUS: Record<string, number> = {
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

let webrtcServerProcess: ChildProcess | null = null
let webrtcAgentProcess: ChildProcess | null = null
let webrtcTurnProcess: ChildProcess | null = null
let webrtcLifecycleQueue = Promise.resolve()
let registeredAgentOwner: WebrtcAgentOwner | null = null
let webrtcAuthTokenCache: WebrtcAuthTokenCache = { token: '', expiresAt: 0 }
let webrtcInstallState: WebrtcInstallState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null
}
const processStartupErrors = new WeakMap<ChildProcess, Error>()

function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseWebrtcVersion(value: unknown): number[] | null {
  const match = String(value || '').trim().match(WEBRTC_VERSION_PATTERN)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function normalizeVersionParts(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  return parseWebrtcVersion(value)
}

function compareVersionPart(left: unknown, right: unknown): number {
  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : 1
  }
  return Number(left) < Number(right) ? -1 : 1
}

export function compareWebrtcVersions(left: unknown, right: unknown): number | null {
  const leftParts = normalizeVersionParts(left)
  const rightParts = normalizeVersionParts(right)
  if (!leftParts || !rightParts) return null

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return compareVersionPart(leftParts[index], rightParts[index])
    }
  }
  return 0
}

export function getWebrtcAgentVersionStatus(agentVersion: unknown, minimumVersion: unknown = MINIMUM_WEBRTC_AGENT_VERSION): 'unknown' | 'outdated' | 'ok' {
  const comparison = compareWebrtcVersions(agentVersion, minimumVersion)
  if (comparison === null) return 'unknown'
  return comparison < 0 ? 'outdated' : 'ok'
}

function createWebrtcError(code: string, message: string, { retryable = false, details, statusCode }: WebrtcErrorOptions = {}): ErrorWithCode {
  const error = new Error(message) as ErrorWithCode
  error.code = code
  asErrorWithCode(error).retryable = retryable
  if (details) error.details = details
  const resolvedStatus = statusCode || WEBRTC_ERROR_STATUS[code]
  if (resolvedStatus) error.statusCode = resolvedStatus
  return error
}

function getWebrtcDeviceSecretOrThrow(): string {
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

export function patchAgentDeploymentScript(script: string, secret: string = WEBRTC_DEVICE_SECRET): string {
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

export function getWebrtcPlatformDir(platform: string = process.platform, arch: string = process.arch): string {
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

function getWebrtcBinaryName(platform: string = process.platform): string {
  return platform === 'win32' ? 'webrtc-signaling.exe' : 'webrtc-signaling'
}

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const pending = webrtcLifecycleQueue.then(operation, operation)
  webrtcLifecycleQueue = pending.then(() => undefined, () => undefined)
  return pending
}

function isChildProcessRunning(child: ChildProcess | null): child is ChildProcess {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

function terminateAgentDeployment(child: ChildProcess | null): void {
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

function clearManagedProcess(type: ManagedProcessType, child: ChildProcess | null): void {
  if (type === 'server' && webrtcServerProcess === child) webrtcServerProcess = null
  if (type === 'agent' && webrtcAgentProcess === child) webrtcAgentProcess = null
  if (type === 'turn' && webrtcTurnProcess === child) webrtcTurnProcess = null
}

function trackManagedProcess(child: ChildProcess, type: ManagedProcessType): ChildProcess {
  child.once('error', (error: Error) => {
    processStartupErrors.set(child, error)
    clearManagedProcess(type, child)
  })
  child.once('exit', () => clearManagedProcess(type, child))
  return child
}

function spawnWithLog(command: string, args: readonly string[], logPath: string, options: SpawnOptionsWithoutStdio): ChildProcess {
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

function processStartupFailure(child: ChildProcess | null, label: string, { allowSuccessfulExit = false }: { allowSuccessfulExit?: boolean } = {}): ErrorWithCode | null {
  if (!child) return null
  const spawnError = processStartupErrors.get(child)
  if (spawnError) {
    const error = new Error(`${label}进程启动失败：${spawnError.message}`) as ErrorWithCode
    error.code = 'WEBRTC_PROCESS_START_FAILED'
    asErrorWithCode(error).retryable = false
    return error
  }
  if (child.signalCode !== null || (child.exitCode !== null && (!allowSuccessfulExit || child.exitCode !== 0))) {
    const reason = child.signalCode ? `信号 ${child.signalCode}` : `退出码 ${child.exitCode}`
    const error = new Error(`${label}进程在就绪前退出（${reason}）`) as ErrorWithCode
    error.code = 'WEBRTC_PROCESS_EXITED'
    asErrorWithCode(error).retryable = false
    return error
  }
  return null
}

function getLastErrorMessage(error: unknown): string {
  if (isRecord(error) && error.message) return String(error.message)
  if (error instanceof Error) return error.message
  return ''
}

export async function waitForCondition<T>(
  check: () => T | Promise<T>,
  {
    timeoutMs,
    pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
    timeoutMessage,
    timeoutCode = 'WEBRTC_START_TIMEOUT'
  }: WaitForConditionOptions
): Promise<T> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (true) {
    try {
      const result = await check()
      if (result) return result
      lastError = null
    } catch (error) {
      if (asErrorWithCode(error).retryable === false) throw error
      lastError = error
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= timeoutMs) {
      const lastErrorMessage = getLastErrorMessage(lastError)
      const detail = lastErrorMessage ? `；最后一次检查失败：${lastErrorMessage}` : ''
      const error = new Error(`${timeoutMessage}${detail}`) as ErrorWithCode
      error.code = timeoutCode
      if (lastError) error.cause = lastError
      throw error
    }
    await delay(Math.min(pollIntervalMs, timeoutMs - elapsed))
  }
}

function toOutputText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value
  if (!value) return ''
  return value.toString('utf8')
}

async function execFileQuiet(
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding = {}
): Promise<ExecFileQuietResult> {
  try {
    return await execFileAsync(command, args, { timeout: 5000, ...options })
  } catch (error) {
    const failure = asErrorWithCode(error)
    return {
      stdout: toOutputText(failure.stdout),
      stderr: toOutputText(failure.stderr),
      error
    }
  }
}

export function parseAdbDeviceState(devicesOutput: unknown, address: string): string | null {
  for (const line of String(devicesOutput || '').split(/\r?\n/)) {
    const [serial, state] = line.trim().split(/\s+/)
    if (serial === address) return state || null
  }
  return null
}

async function readAdbDeviceState(address: string, adbPath: string): Promise<string | null> {
  const { stdout, error } = await execFileQuiet(adbPath, ['devices'], { timeout: 5000 })
  if (error) {
    const commandError = new Error(`无法执行 ADB：${getErrorMessage(error)}`) as ErrorWithCode
    commandError.code = getErrorCode(error) === 'ENOENT' ? 'WEBRTC_ADB_NOT_FOUND' : 'WEBRTC_ADB_COMMAND_FAILED'
    commandError.retryable = getErrorCode(error) !== 'ENOENT'
    throw commandError
  }
  return parseAdbDeviceState(stdout, address)
}

export async function waitForAdbDeviceReady(
  address: string,
  adbPath: string,
  {
    timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
    pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
    getDeviceState = () => readAdbDeviceState(address, adbPath)
  }: WaitForAdbDeviceOptions = {}
): Promise<string | null> {
  let lastState: string | null = null
  try {
    return await waitForCondition(async () => {
      lastState = await getDeviceState()
      return lastState === 'device' ? lastState : null
    }, {
      timeoutMs,
      pollIntervalMs,
      timeoutMessage: `等待 ADB 设备就绪超时（${timeoutMs}ms）：${address}`,
      timeoutCode: 'WEBRTC_ADB_READY_TIMEOUT'
    })
  } catch (error) {
    if (getErrorCode(error) !== 'WEBRTC_ADB_READY_TIMEOUT') throw error

    const stateMessages: Record<string, string> = {
      offline: `ADB 设备离线：${address}`,
      unauthorized: `ADB 设备未授权：${address}，请在设备上允许调试`,
      no_permissions: `ADB 无权访问设备：${address}`
    }
    const readinessError = new Error(
      (lastState ? stateMessages[lastState] : undefined) || `ADB 中未找到目标设备：${address}`
    ) as ErrorWithCode
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

async function getListeningPidsOnTcpPort(port: number): Promise<string[]> {
  const { stdout } = await execFileQuiet('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return stdout.trim().split(/\s+/).filter(Boolean)
}

async function isProcessListeningOnTcpPort(port: number): Promise<boolean> {
  return (await getListeningPidsOnTcpPort(port)).length > 0
}

async function killListeningPidsOnTcpPort(port: number): Promise<void> {
  const pids = await getListeningPidsOnTcpPort(port)
  await Promise.all(pids.map(pid => execFileQuiet('/bin/kill', ['-TERM', pid])))
}

export async function pathExists(filePath: string): Promise<boolean> {
  const fs = await import('fs/promises')
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function getWebrtcBinaryPath(): Promise<string> {
  return path.join(WEBRTC_DIR, 'bin', getWebrtcPlatformDir(), getWebrtcBinaryName())
}

export async function getWebrtcAssetsPath(): Promise<string | null> {
  const legacyAssetsPath = path.join(WEBRTC_DIR, 'assets', 'v1')
  if (await pathExists(legacyAssetsPath)) return legacyAssetsPath

  const releaseAssetsPath = path.join(WEBRTC_DIR, 'assets')
  if (await pathExists(path.join(releaseAssetsPath, 'index.html'))) return releaseAssetsPath

  return null
}

export async function getWebrtcServerVersion(): Promise<string | null> {
  for (const fileName of ['.la-pluma-release.json', 'la-pluma-runtime.json']) {
    const metadata = await readJsonFile<unknown>(path.join(WEBRTC_DIR, fileName), null).catch(() => null)
    const version = isRecord(metadata) && typeof metadata.version === 'string' ? metadata.version.trim() : ''
    if (version) return version
  }
  return null
}

export function parseSha256Digest(digest: unknown): string | null {
  const match = String(digest || '').trim().match(/^sha256:([a-f0-9]{64})$/i)
  return match ? match[1].toLowerCase() : null
}

export function selectWebrtcReleaseAsset(assets: unknown = []): Record<string, unknown> | null {
  const candidates: Array<{ asset: Record<string, unknown>; version: string }> = []
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!isRecord(asset)) continue
    const match = String(asset.name || '').match(WEBRTC_RELEASE_ASSET_PATTERN)
    if (match) candidates.push({ asset, version: `v${match[1]}` })
  }
  candidates.sort((left, right) => compareWebrtcVersions(right.version, left.version) || 0)
  return candidates[0]?.asset || null
}

export async function resolveWebrtcRelease({
  version = process.env.LA_PLUMA_WEBRTC_VERSION || 'latest',
  fetchImpl = fetch
}: ResolveWebrtcReleaseOptions = {}): Promise<WebrtcReleaseInfo> {
  const requestedVersion = String(version || 'latest').trim() || 'latest'
  const endpoint = requestedVersion === 'latest'
    ? `${WEBRTC_RELEASE_API}/latest`
    : `${WEBRTC_RELEASE_API}/tags/${encodeURIComponent(requestedVersion.startsWith('v') ? requestedVersion : `v${requestedVersion}`)}`

  let response: WebrtcFetchResponse
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
      `无法获取 ScrcpyOverWebRTC 发布信息：${getErrorMessage(error)}`,
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
  const releaseRecord: Record<string, unknown> = isRecord(release) ? release : {}
  const asset = selectWebrtcReleaseAsset(releaseRecord.assets)
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

  const assetName = typeof asset.name === 'string' ? asset.name : String(asset.name || '')
  const releaseVersion = typeof releaseRecord.tag_name === 'string' && releaseRecord.tag_name
    ? releaseRecord.tag_name
    : assetName

  return {
    version: releaseVersion,
    assetName,
    url: asset.browser_download_url,
    size: Number(asset.size) || null,
    sha256
  }
}

export async function downloadWebrtcRelease(
  release: WebrtcReleaseInfo,
  destination: string,
  { fetchImpl = fetch }: DownloadWebrtcReleaseOptions = {}
): Promise<DownloadWebrtcReleaseResult> {
  if (!release.url) {
    throw createWebrtcError('WEBRTC_RELEASE_ASSET_MISSING', 'WebRTC 发布包缺少下载地址', { retryable: false })
  }
  await ensureDir(path.dirname(destination))

  let response: WebrtcFetchResponse
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
      `下载 WebRTC 发布包失败：${getErrorMessage(error)}`,
      { retryable: true }
    )
  }

  const body = response.body
  if (!response.ok || !body) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DOWNLOAD_FAILED',
      `下载 WebRTC 发布包失败（HTTP ${response.status}）`,
      { retryable: response.status >= 500 || response.status === 429 }
    )
  }

  const hash = createHash('sha256')
  let size = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    }
  })

  try {
    await pipeline(Readable.fromWeb(body), meter, createWriteStream(destination, { mode: 0o600 }))
  } catch (error) {
    throw createWebrtcError(
      'WEBRTC_RELEASE_DOWNLOAD_FAILED',
      `下载 WebRTC 发布包失败：${getErrorMessage(error)}`,
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

function quotePowerShellLiteral(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

export async function extractWebrtcArchive(archivePath: string, destination: string): Promise<void> {
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
      `解压 WebRTC 发布包失败：${getErrorMessage(error)}`,
      { retryable: getErrorCode(error) !== 'ENOENT', details: { archivePath } }
    )
  }
}

export async function findWebrtcReleaseRoot(rootDir: string): Promise<string | null> {
  const hasLayout = async (dir: string) => (
    await pathExists(path.join(dir, 'bin')) &&
    await pathExists(path.join(dir, 'assets')) &&
    await pathExists(path.join(dir, 'agentd'))
  )

  if (await hasLayout(rootDir)) return rootDir

  let entries: Dirent[]
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

export async function validateWebrtcReleaseLayout(
  releaseRoot: string,
  {
    platform = process.platform,
    arch = process.arch
  }: { platform?: string; arch?: string } = {}
): Promise<WebrtcReleaseLayout> {
  const platformDir = getWebrtcPlatformDir(platform, arch)
  const binaryPath = path.join(releaseRoot, 'bin', platformDir, getWebrtcBinaryName(platform))
  const assetsIndex = path.join(releaseRoot, 'assets', 'index.html')
  const agentRunScript = path.join(releaseRoot, 'agentd', 'run.sh')
  const missing: string[] = []

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

async function copyWebrtcReleaseContents(sourceDir: string, destinationDir: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  await Promise.all(entries.map(entry => cp(
    path.join(sourceDir, entry.name),
    path.join(destinationDir, entry.name),
    { recursive: true, force: true }
  )))
}

export async function installWebrtcReleaseDirectory(
  releaseRoot: string,
  release: WebrtcReleaseInfo = {},
  {
    platform = process.platform,
    arch = process.arch,
    getStatus = getWebrtcStatus
  }: {
    platform?: string
    arch?: string
    getStatus?: () => Promise<WebrtcStatus>
  } = {}
): Promise<WebrtcStatus> {
  const { platformDir } = await validateWebrtcReleaseLayout(releaseRoot, { platform, arch })

  if (await isWebrtcServerReachable()) {
    if (!hasManagedWebrtcResources()) {
      throw createWebrtcError(
        'WEBRTC_INSTALL_SERVER_RUNNING',
        'WebRTC 服务正在运行且不是由本实例启动，请先停止外部服务后再安装或升级组件',
        { retryable: true }
      )
    }
    await stopWebrtc()
    if (await isWebrtcServerReachable()) {
      throw createWebrtcError(
        'WEBRTC_INSTALL_SERVER_RUNNING',
        'WebRTC 服务仍在运行，请先停止服务后再安装或升级组件',
        { retryable: true }
      )
    }
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
    const metadata: {
      version: string
      assetName: string | null
      source: string | null
      size: number | null
      sha256: string | null
      installedAt: string
      backupDir: string | null
    } = {
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

async function getMacLanIp(): Promise<string> {
  const interfaces: string[] = ['en0', 'en1']
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

export async function getWebrtcLogPaths(): Promise<WebrtcLogPaths> {
  return {
    serverLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-server.log'),
    agentLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-agent.log'),
    turnLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-turn.log')
  }
}

export async function isWebrtcServerReachable(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}`, {
      signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS)
    })
    return response.ok
  } catch {
    return false
  }
}

async function requestWebrtcAuthToken({ force = false }: { force?: boolean } = {}): Promise<string> {
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
  const data: unknown = await response.json()
  const token = isRecord(data) && typeof data.token === 'string' ? data.token : ''
  if (!token) throw new Error('WebRTC 登录响应缺少 token')
  webrtcAuthTokenCache = {
    token,
    expiresAt: Date.now() + WEBRTC_AUTH_TOKEN_TTL_MS
  }
  return token
}

export function clearWebrtcAuthTokenCache(): void {
  webrtcAuthTokenCache = { token: '', expiresAt: 0 }
}

export async function getWebrtcAuthToken({ throwOnError = false }: { throwOnError?: boolean } = {}): Promise<string> {
  try {
    return await requestWebrtcAuthToken()
  } catch (error) {
    if (throwOnError) throw error
    return ''
  }
}

async function fetchWebrtcAuthorized(pathname: string): Promise<Response> {
  const request = (token: string) => fetch(`http://127.0.0.1:${WEBRTC_PORT}${pathname}`, {
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

async function fetchWebrtcSnapshotResponse(deviceId: string): Promise<Response> {
  const request = (token: string) => fetch(
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

function normalizeDeviceRecord(item: unknown): WebrtcDeviceRecord | null {
  if (typeof item === 'string') {
    return {
      id: item,
      online: true,
      agentVersion: null,
      snapshotHash: null,
      screenState: null
    }
  }

  if (!isRecord(item)) return null

  const id = item.device_id || item.id
  if (typeof id !== 'string' || !id.trim()) return null

  const deviceInfo: Record<string, unknown> = isRecord(item.device_info) ? item.device_info : {}
  const rawAgentVersion = typeof deviceInfo.agent_version === 'string'
    ? deviceInfo.agent_version
    : typeof deviceInfo.app_version === 'string'
      ? deviceInfo.app_version
      : ''

  return {
    id: id.trim(),
    online: item.online !== false,
    agentVersion: rawAgentVersion.trim() || null,
    snapshotHash: typeof item.snapshot_hash === 'string' ? item.snapshot_hash : null,
    screenState: typeof item.screen_state === 'string' ? item.screen_state : null
  }
}

export async function getWebrtcDeviceRecords({ throwOnError = false }: { throwOnError?: boolean } = {}): Promise<WebrtcDeviceRecord[]> {
  try {
    const response = await fetchWebrtcAuthorized('/devices')
    if (!response.ok) {
      throw new Error(`WebRTC 设备列表请求失败（HTTP ${response.status}）`)
    }
    const data: unknown = await response.json()
    if (!Array.isArray(data)) throw new Error('WebRTC /devices 响应格式无效')
    return data
      .map(normalizeDeviceRecord)
      .filter((record): record is WebrtcDeviceRecord => record !== null)
  } catch (error) {
    if (throwOnError) throw error
    return []
  }
}

export async function getWebrtcSnapshot(
  deviceId: string = DEFAULT_DEVICE_ID,
  { throwOnError = false }: { throwOnError?: boolean } = {}
): Promise<WebrtcSnapshot | null> {
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

export async function getWebrtcDevices({ throwOnError = false }: { throwOnError?: boolean } = {}): Promise<string[]> {
  const records = await getWebrtcDeviceRecords({ throwOnError })
  return records.filter(record => record.online).map(record => record.id)
}

async function getUpstreamViewerCount(): Promise<number> {
  try {
    const response = await fetchWebrtcAuthorized('/devices')
    if (!response.ok) return 0
    const data: unknown = await response.json()
    if (!Array.isArray(data)) return 0
    let count = 0
    for (const item of data) {
      if (!isRecord(item)) continue
      if (typeof item.client_count === 'number' && Number.isFinite(item.client_count)) {
        count += Math.max(0, Math.trunc(item.client_count))
      } else if (Array.isArray(item.clients)) {
        count += item.clients.length
      }
    }
    return count
  } catch {
    return 0
  }
}

let gatewayViewerCount = 0
let viewerIdleTimer: NodeJS.Timeout | null = null

/**
 * 网关最后一个 viewer 离开后，仅在确认没有上游观看者且 Agent 由本实例启动时
 * 释放设备端 Agent；信令与 TURN 保持运行，新的 view。 会重新触发启动。
 */
export function handleWebrtcViewerCountChange(count: number): void {
  gatewayViewerCount = Math.max(0, count)
  if (gatewayViewerCount > 0) {
    if (viewerIdleTimer) clearTimeout(viewerIdleTimer)
    viewerIdleTimer = null
    return
  }
  if (!registeredAgentOwner) return
  if (viewerIdleTimer) clearTimeout(viewerIdleTimer)
  viewerIdleTimer = setTimeout(() => {
    viewerIdleTimer = null
    void (async () => {
      if (gatewayViewerCount > 0) return
      const upstreamViewers = await getUpstreamViewerCount()
      if (upstreamViewers > 0) return
      const owner = registeredAgentOwner
      if (!owner) return
      try {
        await stopWebrtcAgent(owner.address, owner.adbPath)
        logger.info('预览无观看者，已释放设备端 Agent', { deviceId: owner.deviceId })
      } catch (error) {
        logger.warn('预览空闲释放设备端 Agent 失败', {
          deviceId: owner.deviceId,
          error: getErrorMessage(error)
        })
      }
    })()
  }, 3_000)
  viewerIdleTimer.unref?.()
}

export async function waitForWebrtcServerReady({
  timeoutMs = WEBRTC_SERVER_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
  isReachable = isWebrtcServerReachable,
  childProcess = null
}: WaitForWebrtcServerReadyOptions = {}): Promise<boolean> {
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
}: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<string[]> {
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

export async function waitForWebrtcDevice(
  deviceId: string,
  {
    timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
    pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS,
    getDevices = () => getWebrtcDevices({ throwOnError: true }),
    childProcess = null,
    isAgentRunning = null
  }: WaitForWebrtcDeviceOptions = {}
): Promise<false | string[]> {
  return waitForCondition(async () => {
    const failure = processStartupFailure(childProcess, 'WebRTC Agent 部署', { allowSuccessfulExit: true })
    if (failure) throw failure
    if (childProcess && childProcess.exitCode !== 0) return false
    if (childProcess?.exitCode === 0 && isAgentRunning && !await isAgentRunning()) {
      const error = new Error('WebRTC Agent 部署脚本已结束，但设备端进程未启动') as ErrorWithCode
      error.code = 'WEBRTC_AGENT_DEPLOYMENT_FAILED'
      asErrorWithCode(error).retryable = true
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

async function waitForWebrtcDeviceUnavailable(deviceId: string, {
  timeoutMs = WEBRTC_AGENT_START_TIMEOUT_MS,
  pollIntervalMs = WEBRTC_START_POLL_INTERVAL_MS
}: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<false | string[]> {
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

async function isDeviceAgentRunning(address: string = DEFAULT_DEVICE_ADDRESS, adbPath: string = DEFAULT_ADB_PATH): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'ps | grep cloudphone-agent || true'], { timeout: 5000 })
    return stdout.includes('cloudphone-agent')
  } catch {
    return false
  }
}

async function getIceServersConfig(): Promise<string> {
  const lanIp = await getMacLanIp()
  return `turn:${WEBRTC_TURN_USERNAME}:${WEBRTC_TURN_PASSWORD}@${lanIp}:${WEBRTC_TURN_PORT}?transport=udp,stun:${lanIp}:${WEBRTC_TURN_PORT}`
}

function isSameAgentOwner(owner: WebrtcAgentOwner | null, address: string, deviceId: string): boolean {
  return owner?.address === address && owner?.deviceId === deviceId
}

async function stopRemoteWebrtcAgent(address: string, adbPath: string): Promise<void> {
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f cloudphone-agent || true'], { timeout: 5000 }).catch(() => {})
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f scrcpy.Server || true'], { timeout: 5000 }).catch(() => {})
}

async function startLocalTurnServerUnlocked(): Promise<void> {
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) return
  if (await isProcessListeningOnTcpPort(WEBRTC_TURN_PORT)) return
  const turnserver = '/opt/homebrew/bin/turnserver'
  if (!await pathExists(turnserver)) return
  const { turnLog } = await getWebrtcLogPaths()
  const lanIp = await getMacLanIp()
  const child = spawnWithLog(turnserver, [
    '-n',
    '--no-tls',
    '-L', '0.0.0.0',
    '--external-ip', lanIp,
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

async function killLocalWebrtcInfrastructureUnlocked(address: string, adbPath: string): Promise<void> {
  const owner = registeredAgentOwner
  const ownedServer = Boolean(webrtcServerProcess)
  const ownedTurn = Boolean(webrtcTurnProcess)
  terminateAgentDeployment(webrtcAgentProcess)
  if (webrtcServerProcess && !webrtcServerProcess.killed) webrtcServerProcess.kill('SIGTERM')
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) webrtcTurnProcess.kill('SIGTERM')
  webrtcAgentProcess = null
  webrtcServerProcess = null
  webrtcTurnProcess = null
  registeredAgentOwner = null

  // 只回收本实例启动的服务/TURN；port 上若仍是外部资源，不在这里杀掉。
  if (ownedServer) await killListeningPidsOnTcpPort(WEBRTC_PORT)
  if (ownedTurn) await killListeningPidsOnTcpPort(WEBRTC_TURN_PORT)
  if (owner) await stopRemoteWebrtcAgent(owner.address, owner.adbPath)
}

export async function getWebrtcStatus(
  address: string = DEFAULT_DEVICE_ADDRESS,
  adbPath: string = DEFAULT_ADB_PATH,
  { agentRunning = null }: WebrtcStatusOptions = {}
): Promise<WebrtcStatus> {
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
    turnRunning: !!webrtcTurnProcess && !webrtcTurnProcess.killed
      || await isProcessListeningOnTcpPort(WEBRTC_TURN_PORT),
    serverRunning: (!!webrtcServerProcess && !webrtcServerProcess.killed) || serverReachable,
    agentRunning: (!!webrtcAgentProcess && !webrtcAgentProcess.killed) || deviceAgentRunning,
    usingDefaultPassword: WEBRTC_PASSWORD === DEFAULT_WEBRTC_PASSWORD,
    deviceAddress: address,
    runtimeVersion: await getWebrtcServerVersion().catch(() => null),
    ...logPaths
  }
}

export function hasManagedWebrtcResources(): boolean {
  return Boolean(webrtcServerProcess || webrtcTurnProcess || registeredAgentOwner)
}

export async function installWebrtc(options: InstallWebrtcOptions = {}): Promise<WebrtcStatus> {
  const {
    resolveRelease = resolveWebrtcRelease,
    downloadRelease = downloadWebrtcRelease,
    extractRelease = extractWebrtcArchive,
    installRelease = installWebrtcReleaseDirectory,
    force = false
  } = options

  const release = await resolveRelease(options)
  const currentVersion = await getWebrtcServerVersion().catch(() => null)
  const sameVersion = release.version && currentVersion
    ? compareWebrtcVersions(currentVersion, release.version) === 0
    : false
  const status = sameVersion ? await getWebrtcStatus().catch(() => null) : null
  const hasAgentRuntime = await pathExists(path.join(WEBRTC_DIR, 'agentd', 'run.sh'))

  if (!force && sameVersion && status && status.built && hasAgentRuntime) {
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

function cloneSnapshotValue(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  return Object.assign({}, value) as Record<string, unknown>
}

export function getWebrtcInstallState(): WebrtcInstallStateSnapshot {
  return {
    ...webrtcInstallState,
    result: cloneSnapshotValue(webrtcInstallState.result),
    error: webrtcInstallState.error ? { ...webrtcInstallState.error } : null
  }
}

export function resetWebrtcInstallStateForTests(): void {
  webrtcInstallState = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  }
}

export function startWebrtcInstall({ install = installWebrtc, ...options }: StartWebrtcInstallOptions = {}): WebrtcInstallStateSnapshot {
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
    .then((result: unknown) => {
      webrtcInstallState = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        result,
        error: null
      }
    })
    .catch((error: unknown) => {
      webrtcInstallState = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: {
          code: getErrorCode(error) || 'WEBRTC_INSTALL_FAILED',
          message: getErrorMessage(error) || 'WebRTC 组件安装失败',
          retryable: asErrorWithCode(error).retryable ?? false,
          details: getErrorDetails(error) || {}
        }
      }
    })

  return getWebrtcInstallState()
}

async function startWebrtcServerUnlocked(address: string, adbPath: string): Promise<WebrtcStatus> {
  if (await isWebrtcServerReachable()) {
    // 信令可能由上一个实例或外部启动；TURN 仍可能缺失，不能直接返回。
    await startLocalTurnServerUnlocked()
    return getWebrtcStatus(address, adbPath)
  }

  let child: ChildProcess | null = webrtcServerProcess
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
    const serverArgs: string[] = [
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

export async function startWebrtcServer(address: string = DEFAULT_DEVICE_ADDRESS, adbPath: string = DEFAULT_ADB_PATH): Promise<WebrtcStatus> {
  return enqueueLifecycle(() => startWebrtcServerUnlocked(address, adbPath))
}

async function stopWebrtcServerUnlocked(address: string, adbPath: string): Promise<WebrtcStatus> {
  await killLocalWebrtcInfrastructureUnlocked(address, adbPath)
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtcServer(address: string = DEFAULT_DEVICE_ADDRESS, adbPath: string = DEFAULT_ADB_PATH): Promise<WebrtcStatus> {
  return enqueueLifecycle(() => stopWebrtcServerUnlocked(address, adbPath))
}

async function startWebrtcAgentUnlocked(address: string, deviceId: string, adbPath: string): Promise<WebrtcStatus> {
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
  let deployArgs: string[] = [
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

export async function startWebrtcAgent(
  address: string = DEFAULT_DEVICE_ADDRESS,
  deviceId: string = DEFAULT_DEVICE_ID,
  adbPath: string = DEFAULT_ADB_PATH
): Promise<WebrtcStatus> {
  return enqueueLifecycle(() => startWebrtcAgentUnlocked(address, deviceId, adbPath))
}

async function stopWebrtcAgentUnlocked(address: string, adbPath: string): Promise<WebrtcStatus> {
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

export async function stopWebrtcAgent(address: string = DEFAULT_DEVICE_ADDRESS, adbPath: string = DEFAULT_ADB_PATH): Promise<WebrtcStatus> {
  return enqueueLifecycle(() => stopWebrtcAgentUnlocked(address, adbPath))
}

export async function startWebrtc(
  address: string = DEFAULT_DEVICE_ADDRESS,
  deviceId: string = DEFAULT_DEVICE_ID,
  adbPath: string = DEFAULT_ADB_PATH
): Promise<WebrtcStatus> {
  return enqueueLifecycle(async () => {
    await startWebrtcServerUnlocked(address, adbPath)
    return startWebrtcAgentUnlocked(address, deviceId, adbPath)
  })
}

export async function stopWebrtc(
  address: string = DEFAULT_DEVICE_ADDRESS,
  adbPath: string = DEFAULT_ADB_PATH
): Promise<{ stopped: true }> {
  return enqueueLifecycle(async () => {
    await stopWebrtcAgentUnlocked(address, adbPath).catch(() => null)
    await stopWebrtcServerUnlocked(address, adbPath).catch(() => null)
    return { stopped: true }
  })
}
