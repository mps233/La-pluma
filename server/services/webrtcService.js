import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

export const WEBRTC_DIR = process.env.LA_PLUMA_WEBRTC_DIR || `${process.env.HOME || ''}/ScrcpyOverWebRTC`
export const WEBRTC_PORT = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443)
export const DEFAULT_DEVICE_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384'
export const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb'
export const DEFAULT_DEVICE_ID = 'mumu-la-pluma'

let webrtcServerProcess = null
let webrtcAgentProcess = null
let webrtcTurnProcess = null

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
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
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
  return `turn:cloudphone_user:cloudphone_secure_password@${lanIp}:3478?transport=udp,stun:${lanIp}:3478`
}

export async function startLocalTurnServer() {
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) return
  if (await isProcessListeningOnTcpPort(3478)) return
  const fs = await import('fs')
  const { turnLog } = await getWebrtcLogPaths()
  const logFd = fs.openSync(turnLog, 'a')
  const turnserver = '/opt/homebrew/bin/turnserver'
  if (!await pathExists(turnserver)) return
  webrtcTurnProcess = spawn(turnserver, [
    '-n',
    '--no-cli',
    '--no-tls',
    '--no-dtls',
    '-L', '0.0.0.0',
    '-p', '3478',
    '-a',
    '-u', 'cloudphone_user:cloudphone_secure_password',
    '-r', 'cloudphone'
  ], {
    cwd: WEBRTC_DIR,
    stdio: ['ignore', logFd, logFd],
    detached: false
  })
  webrtcTurnProcess.on('exit', () => { webrtcTurnProcess = null })
}

export async function killLocalWebrtcInfrastructure(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) webrtcAgentProcess.kill('SIGTERM')
  if (webrtcServerProcess && !webrtcServerProcess.killed) webrtcServerProcess.kill('SIGTERM')
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) webrtcTurnProcess.kill('SIGTERM')
  webrtcAgentProcess = null
  webrtcServerProcess = null
  webrtcTurnProcess = null

  await killListeningPidsOnTcpPort(WEBRTC_PORT)
  await killListeningPidsOnTcpPort(3478)
  await execFileQuiet(adbPath, ['-s', address, 'shell', 'pkill -f cloudphone-agent || true'])
  await execFileQuiet(adbPath, ['-s', address, 'shell', 'pkill -f scrcpy.Server || true'])
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
    signalingUrl: `ws://${lanIp}:${WEBRTC_PORT}`,
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

export async function startWebrtcServer(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  if (webrtcServerProcess && !webrtcServerProcess.killed) {
    return getWebrtcStatus(address, adbPath)
  }
  if (await isWebrtcServerReachable()) {
    return getWebrtcStatus(address, adbPath)
  }

  const binaryPath = await getWebrtcBinaryPath()
  const assetsPath = path.join(WEBRTC_DIR, 'assets', 'v1')
  if (!await pathExists(binaryPath) || !await pathExists(assetsPath)) {
    throw new Error('WebRTC 组件未安装或未构建')
  }

  await startLocalTurnServer()
  const fs = await import('fs')
  const { serverLog } = await getWebrtcLogPaths()
  const logFd = fs.openSync(serverLog, 'a')
  const iceServers = await getIceServersConfig()
  webrtcServerProcess = spawn(binaryPath, ['-host', '0.0.0.0', '-port', String(WEBRTC_PORT), '-assets', assetsPath, '-ice_servers', iceServers], {
    cwd: WEBRTC_DIR,
    stdio: ['ignore', logFd, logFd],
    detached: false,
    env: { ...process.env, PORT: String(WEBRTC_PORT), PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  })
  webrtcServerProcess.on('exit', () => { webrtcServerProcess = null })
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtcServer(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  await killLocalWebrtcInfrastructure(address, adbPath)
  return getWebrtcStatus(address, adbPath)
}

export async function startWebrtcAgent(address = DEFAULT_DEVICE_ADDRESS, deviceId = DEFAULT_DEVICE_ID, adbPath = DEFAULT_ADB_PATH) {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) {
    return getWebrtcStatus(address, adbPath)
  }
  if (await isDeviceAgentRunning(address, adbPath)) {
    return getWebrtcStatus(address, adbPath)
  }

  const runScript = path.join(WEBRTC_DIR, 'agentd', 'run.sh')
  if (!await pathExists(runScript)) {
    throw new Error('WebRTC agent 未安装')
  }

  const fs = await import('fs')
  const { agentLog } = await getWebrtcLogPaths()
  const logFd = fs.openSync(agentLog, 'a')
  const lanIp = await getMacLanIp()
  const iceServers = await getIceServersConfig()
  webrtcAgentProcess = spawn('bash', [runScript, address, '-id', deviceId, '-signaling', `ws://${lanIp}:${WEBRTC_PORT}`, '-ice-servers', iceServers, '-webrtc-port', '50000'], {
    cwd: path.join(WEBRTC_DIR, 'agentd'),
    stdio: ['ignore', logFd, logFd],
    detached: false,
    env: { ...process.env, ADB_PATH: adbPath, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  })
  webrtcAgentProcess.on('exit', () => { webrtcAgentProcess = null })
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtcAgent(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) {
    webrtcAgentProcess.kill('SIGTERM')
    webrtcAgentProcess = null
  }
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f cloudphone-agent || true'], { timeout: 5000 }).catch(() => {})
  await execFileAsync(adbPath, ['-s', address, 'shell', 'pkill -f scrcpy.Server || true'], { timeout: 5000 }).catch(() => {})
  return getWebrtcStatus(address, adbPath)
}

export async function startWebrtc(address = DEFAULT_DEVICE_ADDRESS, deviceId = DEFAULT_DEVICE_ID, adbPath = DEFAULT_ADB_PATH) {
  await startWebrtcServer(address, adbPath)
  await startWebrtcAgent(address, deviceId, adbPath)
  await new Promise(resolve => setTimeout(resolve, 1200))
  return getWebrtcStatus(address, adbPath)
}

export async function stopWebrtc(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  await stopWebrtcAgent(address, adbPath).catch(() => null)
  await stopWebrtcServer(address, adbPath).catch(() => null)
  return { stopped: true }
}
