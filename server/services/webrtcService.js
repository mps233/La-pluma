import { execFile, spawn } from 'child_process'
import { closeSync, openSync } from 'fs'
import { promisify } from 'util'
import path from 'path'
import { setTimeout as delay } from 'timers/promises'

const execFileAsync = promisify(execFile)

export const WEBRTC_DIR = process.env.LA_PLUMA_WEBRTC_DIR || `${process.env.HOME || ''}/ScrcpyOverWebRTC`
export const WEBRTC_PORT = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443)
export const WEBRTC_TURN_PORT = Number(process.env.LA_PLUMA_WEBRTC_TURN_PORT || 3478)
export const DEFAULT_DEVICE_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384'
export const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb'
export const DEFAULT_DEVICE_ID = 'mumu-la-pluma'

const WEBRTC_REQUEST_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_REQUEST_TIMEOUT_MS, 1500)
const WEBRTC_SERVER_START_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_SERVER_START_TIMEOUT_MS, 15000)
const WEBRTC_AGENT_START_TIMEOUT_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_AGENT_START_TIMEOUT_MS, 20000)
const WEBRTC_START_POLL_INTERVAL_MS = readPositiveInteger(process.env.LA_PLUMA_WEBRTC_START_POLL_INTERVAL_MS, 250)
const WEBRTC_USERNAME = process.env.LA_PLUMA_WEBRTC_USERNAME || 'admin'
const WEBRTC_PASSWORD = process.env.LA_PLUMA_WEBRTC_PASSWORD || 'admin123'

let webrtcServerProcess = null
let webrtcAgentProcess = null
let webrtcTurnProcess = null
let webrtcLifecycleQueue = Promise.resolve()
let registeredAgentOwner = null
const processStartupErrors = new WeakMap()

function readPositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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

export async function getWebrtcBinaryPath() {
  const arch = process.arch === 'arm64' ? 'darwin_arm64' : 'darwin_amd64'
  return path.join(WEBRTC_DIR, 'bin', arch, 'webrtc-signaling')
}

export async function getMacLanIp() {
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

async function requestWebrtcAuthToken() {
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
  return data.token
}

export async function getWebrtcAuthToken({ throwOnError = false } = {}) {
  try {
    return await requestWebrtcAuthToken()
  } catch (error) {
    if (throwOnError) throw error
    return ''
  }
}

function normalizeDeviceIds(data) {
  if (!Array.isArray(data)) throw new Error('WebRTC /devices 响应格式无效')
  return data
    .map(item => typeof item === 'string' ? item : (item?.device_id || item?.id))
    .filter(Boolean)
}

export async function getWebrtcDevices({ throwOnError = false } = {}) {
  try {
    const token = await requestWebrtcAuthToken()
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(WEBRTC_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`WebRTC 设备列表请求失败（HTTP ${response.status}）`)
    }
    return normalizeDeviceIds(await response.json())
  } catch (error) {
    if (throwOnError) throw error
    return []
  }
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

export async function isDeviceAgentRunning(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  try {
    const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'ps | grep cloudphone-agent || true'], { timeout: 5000 })
    return stdout.includes('cloudphone-agent')
  } catch {
    return false
  }
}

export async function getIceServersConfig() {
  const lanIp = await getMacLanIp()
  return `turn:cloudphone_user:cloudphone_secure_password@${lanIp}:${WEBRTC_TURN_PORT}?transport=udp,stun:${lanIp}:${WEBRTC_TURN_PORT}`
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
    '-u', 'cloudphone_user:cloudphone_secure_password',
    '-r', 'cloudphone'
  ], turnLog, {
    cwd: WEBRTC_DIR,
    detached: false
  })
  webrtcTurnProcess = trackManagedProcess(child, 'turn')
}

export async function startLocalTurnServer() {
  return enqueueLifecycle(startLocalTurnServerUnlocked)
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

export async function killLocalWebrtcInfrastructure(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  return enqueueLifecycle(() => killLocalWebrtcInfrastructureUnlocked(address, adbPath))
}

export async function getWebrtcStatus(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  const binaryPath = await getWebrtcBinaryPath()
  const assetsPath = path.join(WEBRTC_DIR, 'assets', 'v1')
  const lanIp = await getMacLanIp()
  const logPaths = await getWebrtcLogPaths()
  const serverReachable = await isWebrtcServerReachable()
  const deviceAgentRunning = await isDeviceAgentRunning(address, adbPath)
  return {
    installed: await pathExists(WEBRTC_DIR),
    built: await pathExists(binaryPath) && await pathExists(assetsPath),
    dir: WEBRTC_DIR,
    port: WEBRTC_PORT,
    url: `http://127.0.0.1:${WEBRTC_PORT}`,
    lanUrl: `http://${lanIp}:${WEBRTC_PORT}`,
    signalingUrl: '/webrtc-signaling',
    directSignalingUrl: `ws://${lanIp}:${WEBRTC_PORT}`,
    turnRunning: !!webrtcTurnProcess && !webrtcTurnProcess.killed,
    iceServers: await getIceServersConfig(),
    serverRunning: (!!webrtcServerProcess && !webrtcServerProcess.killed) || serverReachable,
    agentRunning: (!!webrtcAgentProcess && !webrtcAgentProcess.killed) || deviceAgentRunning,
    deviceAddress: address,
    ...logPaths
  }
}

export async function installWebrtc() {
  const fs = await import('fs/promises')
  const parentDir = path.dirname(WEBRTC_DIR) || (process.env.HOME || process.cwd())

  if (!await pathExists(WEBRTC_DIR)) {
    await new Promise((resolve, reject) => {
      const child = spawn('git', ['clone', 'https://github.com/hqw700/ScrcpyOverWebRTC.git', WEBRTC_DIR], {
        cwd: parentDir,
        stdio: 'ignore'
      })
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`git clone 失败: ${code}`)))
      child.on('error', reject)
    })
  }

  const buildScript = path.join(WEBRTC_DIR, 'build.sh')
  await fs.chmod(buildScript, 0o755).catch(() => {})
  await new Promise((resolve, reject) => {
    const child = spawn('bash', ['build.sh'], { cwd: WEBRTC_DIR, stdio: 'ignore' })
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`build.sh 失败: ${code}`)))
    child.on('error', reject)
  })

  return getWebrtcStatus()
}

async function startWebrtcServerUnlocked(address, adbPath) {
  if (await isWebrtcServerReachable()) {
    return getWebrtcStatus(address, adbPath)
  }

  let child = webrtcServerProcess
  let spawned = false
  if (!isChildProcessRunning(child)) {
    const binaryPath = await getWebrtcBinaryPath()
    const assetsPath = path.join(WEBRTC_DIR, 'assets', 'v1')
    if (!await pathExists(binaryPath) || !await pathExists(assetsPath)) {
      throw new Error('WebRTC 组件未安装或未构建')
    }

    await startLocalTurnServerUnlocked()
    const { serverLog } = await getWebrtcLogPaths()
    const iceServers = await getIceServersConfig()
    child = spawnWithLog(binaryPath, ['-host', '0.0.0.0', '-port', String(WEBRTC_PORT), '-assets', assetsPath, '-ice_servers', iceServers], serverLog, {
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
  const child = spawnWithLog('bash', [runScript, address, '-id', deviceId, '-signaling', `ws://${lanIp}:${WEBRTC_PORT}`, '-ice-servers', iceServers, '-webrtc-port', '50000'], agentLog, {
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
