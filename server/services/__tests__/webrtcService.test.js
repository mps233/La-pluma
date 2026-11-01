import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const ENV_KEYS = [
  'LA_PLUMA_WEBRTC_DIR',
  'LA_PLUMA_WEBRTC_PORT',
  'LA_PLUMA_WEBRTC_TURN_PORT',
  'LA_PLUMA_WEBRTC_REQUEST_TIMEOUT_MS',
  'LA_PLUMA_WEBRTC_SERVER_START_TIMEOUT_MS',
  'LA_PLUMA_WEBRTC_AGENT_START_TIMEOUT_MS',
  'LA_PLUMA_WEBRTC_START_POLL_INTERVAL_MS',
  'TEST_WEBRTC_DEVICES_FILE',
  'TEST_WEBRTC_SERVER_COUNT_FILE',
  'TEST_WEBRTC_SERVER_ARGS_FILE',
  'TEST_WEBRTC_AGENT_COUNT_FILE',
  'TEST_WEBRTC_AGENT_PID_FILE',
  'TEST_WEBRTC_SERVER_PID_FILE',
  'TEST_WEBRTC_OFFLINE_DEVICE_ID',
  'TEST_WEBRTC_LOGIN_COUNT_FILE'
]

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

async function countLines(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

async function openFixtureLogDescriptors(logPaths) {
  const openTargets = []
  for (const entry of await readdir('/dev/fd')) {
    try {
      const target = await readlink(`/dev/fd/${entry}`)
      if (logPaths.includes(target)) openTargets.push(target)
    } catch {
      // File descriptors can close while /dev/fd is being inspected.
    }
  }
  return openTargets
}

describe('WebRTC startup readiness', () => {
  let fixtureDir
  let devicesFile
  let serverCountFile
  let serverArgsFile
  let agentCountFile
  let agentPidFile
  let serverPidFile
  let loginCountFile
  let fakeAdbPath
  let service
  const previousEnv = new Map()

  before(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'la-pluma-webrtc-'))
    const platformName = process.platform === 'win32' ? 'windows' : process.platform
    const archName = arch() === 'arm64' ? 'arm64' : 'amd64'
    const binaryDir = join(fixtureDir, 'bin', `${platformName}_${archName}`)
    const assetsDir = join(fixtureDir, 'assets', 'v1')
    const agentDir = join(fixtureDir, 'agentd')
    await Promise.all([
      mkdir(binaryDir, { recursive: true }),
      mkdir(assetsDir, { recursive: true }),
      mkdir(agentDir, { recursive: true })
    ])

    devicesFile = join(fixtureDir, 'devices.json')
    serverCountFile = join(fixtureDir, 'server-count.log')
    serverArgsFile = join(fixtureDir, 'server-args.json')
    agentCountFile = join(fixtureDir, 'agent-count.log')
    agentPidFile = join(fixtureDir, 'agent.pid')
    serverPidFile = join(fixtureDir, 'server.pid')
    loginCountFile = join(fixtureDir, 'login-count.log')
    fakeAdbPath = join(fixtureDir, 'adb')
    await writeFile(devicesFile, '[]')

    const signalingPath = join(binaryDir, process.platform === 'win32' ? 'webrtc-signaling.exe' : 'webrtc-signaling')
    await writeFile(signalingPath, `#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')

fs.appendFileSync(process.env.TEST_WEBRTC_SERVER_COUNT_FILE, 'spawn\\n')
fs.writeFileSync(process.env.TEST_WEBRTC_SERVER_ARGS_FILE, JSON.stringify(process.argv.slice(2)))
fs.writeFileSync(process.env.TEST_WEBRTC_SERVER_PID_FILE, String(process.pid))

const server = http.createServer((request, response) => {
  if (request.url === '/api/login' && request.method === 'POST') {
    fs.appendFileSync(process.env.TEST_WEBRTC_LOGIN_COUNT_FILE, 'login\\n')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ token: 'fixture-token' }))
    return
  }
  if (request.url.startsWith('/snapshots/')) {
    if (!request.url.includes('token=fixture-token')) {
      response.statusCode = 401
      response.end('unauthorized')
      return
    }
    response.setHeader('Content-Type', 'image/jpeg')
    response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    return
  }
  if (request.url === '/devices') {
    if (request.headers.authorization !== 'Bearer fixture-token') {
      response.statusCode = 401
      response.end('unauthorized')
      return
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(fs.readFileSync(process.env.TEST_WEBRTC_DEVICES_FILE, 'utf8'))
    return
  }
  response.statusCode = 200
  response.end('ready')
})

setTimeout(() => server.listen(Number(process.env.PORT), '127.0.0.1'), 120)
process.on('SIGTERM', () => {
  server.closeAllConnections()
  server.close(() => process.exit(0))
})
`)

    const runScript = join(agentDir, 'run.sh')
    await writeFile(runScript, `#!/bin/bash
printf 'spawn\\n' >> "$TEST_WEBRTC_AGENT_COUNT_FILE"
printf '%s' "$$" > "$TEST_WEBRTC_AGENT_PID_FILE"
if [ "$1" = "failure-address" ]; then
  exit 7
fi
if [ "$1" = "timeout-address" ]; then
  sleep 2
  exit 0
fi
sleep 0.15
printf '["%s"]' "$3" > "$TEST_WEBRTC_DEVICES_FILE"
`)

    await writeFile(fakeAdbPath, `#!/bin/bash
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nfixture-device\\tdevice\\nsecond-address\\tdevice\\nfailure-address\\tdevice\\ntimeout-address\\tdevice\\nqueued-address\\tdevice\\n'
  exit 0
fi
if [[ "$*" == *"pkill -f cloudphone-agent"* ]]; then
  if [ -n "\${TEST_WEBRTC_OFFLINE_DEVICE_ID:-}" ]; then
    printf '[{"device_id":"%s","online":false}]' "$TEST_WEBRTC_OFFLINE_DEVICE_ID" > "$TEST_WEBRTC_DEVICES_FILE"
  else
    printf '[]' > "$TEST_WEBRTC_DEVICES_FILE"
  fi
  exit 0
fi
if [[ "$*" == *"ps | grep cloudphone-agent"* ]] && ! grep -q '^\\[\\]$' "$TEST_WEBRTC_DEVICES_FILE"; then
  echo cloudphone-agent
fi
`)
    await Promise.all([chmod(signalingPath, 0o755), chmod(runScript, 0o755), chmod(fakeAdbPath, 0o755)])

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key])
    const port = await getAvailablePort()
    const turnPort = await getAvailablePort()
    Object.assign(process.env, {
      LA_PLUMA_WEBRTC_DIR: fixtureDir,
      LA_PLUMA_WEBRTC_PORT: String(port),
      LA_PLUMA_WEBRTC_TURN_PORT: String(turnPort),
      LA_PLUMA_WEBRTC_REQUEST_TIMEOUT_MS: '200',
      LA_PLUMA_WEBRTC_SERVER_START_TIMEOUT_MS: '3000',
      LA_PLUMA_WEBRTC_AGENT_START_TIMEOUT_MS: '1000',
      LA_PLUMA_WEBRTC_START_POLL_INTERVAL_MS: '20',
      TEST_WEBRTC_DEVICES_FILE: devicesFile,
      TEST_WEBRTC_SERVER_COUNT_FILE: serverCountFile,
      TEST_WEBRTC_SERVER_ARGS_FILE: serverArgsFile,
      TEST_WEBRTC_AGENT_COUNT_FILE: agentCountFile,
      TEST_WEBRTC_AGENT_PID_FILE: agentPidFile,
      TEST_WEBRTC_SERVER_PID_FILE: serverPidFile,
      TEST_WEBRTC_LOGIN_COUNT_FILE: loginCountFile
    })
    service = await import(`../webrtcService.js?webrtc-test=${Date.now()}`)
  })

  after(async () => {
    try {
      const pid = Number(await readFile(serverPidFile, 'utf8'))
      if (Number.isInteger(pid)) process.kill(pid, 'SIGTERM')
    } catch {
      // The fixture server may not have started when an earlier assertion failed.
    }
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(fixtureDir, { recursive: true, force: true })
  })

  it('compares the installed agent version against the v0.4.3 minimum', () => {
    assert.equal(service.getWebrtcAgentVersionStatus('v0.4.3-1b7d786'), 'ok')
    assert.equal(service.getWebrtcAgentVersionStatus('0.4.3'), 'ok')
    assert.equal(service.getWebrtcAgentVersionStatus('v0.4.2'), 'outdated')
    assert.equal(service.getWebrtcAgentVersionStatus('v0.3.9'), 'outdated')
    assert.equal(service.getWebrtcAgentVersionStatus(''), 'unknown')
    assert.equal(service.getWebrtcAgentVersionStatus(null), 'unknown')
    assert.equal(service.compareWebrtcVersions('v0.4.10', 'v0.4.3'), 1)
    assert.equal(service.compareWebrtcVersions('v0.4.3', 'v0.4.3'), 0)
  })

  it('reads the installed server version from release metadata', async () => {
    const releaseFile = join(fixtureDir, '.la-pluma-release.json')
    await writeFile(releaseFile, JSON.stringify({ version: 'v0.4.3' }))
    try {
      assert.equal(await service.getWebrtcServerVersion(), 'v0.4.3')
    } finally {
      await rm(releaseFile, { force: true })
    }
  })

  it('injects a device secret into the agent deployment script', () => {
    const script = 'ENV_EXPORTS=""\nSTART_CMD="$ENV_EXPORTS env GODEBUG=asyncpreemptoff=1 agent"\n'
    const patched = service.patchAgentDeploymentScript(script, 'secret_1')
    assert.match(patched, /DEVICE_SECRET='secret_1'/)

    const fallback = service.patchAgentDeploymentScript(
      'env GODEBUG=asyncpreemptoff=1 /data/local/tmp/cloudphone-agent',
      'secret_2'
    )
    assert.match(fallback, /DEVICE_SECRET='secret_2'/)

    assert.throws(
      () => service.patchAgentDeploymentScript(script, 'invalid secret'),
      error => error.code === 'WEBRTC_DEVICE_SECRET_INVALID'
    )
    assert.throws(
      () => service.patchAgentDeploymentScript('no supported command', 'secret_3'),
      error => error.code === 'WEBRTC_AGENT_DEPLOYMENT_SCRIPT_UNSUPPORTED'
    )
  })

  it('tracks background install jobs through completion and failure', async () => {
    service.resetWebrtcInstallStateForTests()
    let resolveInstall
    const installPromise = new Promise(resolve => {
      resolveInstall = resolve
    })
    const started = service.startWebrtcInstall({ install: () => installPromise })
    assert.equal(started.status, 'running')

    await service.waitForCondition(() => Boolean(resolveInstall), {
      timeoutMs: 500,
      pollIntervalMs: 10,
      timeoutMessage: 'install job did not start'
    })
    resolveInstall({ installed: true, built: true })
    await service.waitForCondition(() => service.getWebrtcInstallState().status === 'succeeded', {
      timeoutMs: 500,
      pollIntervalMs: 10,
      timeoutMessage: 'install job did not finish'
    })
    assert.deepEqual(service.getWebrtcInstallState().result, { installed: true, built: true })

    const failure = new Error('download failed')
    failure.code = 'WEBRTC_RELEASE_DOWNLOAD_FAILED'
    failure.retryable = true
    service.resetWebrtcInstallStateForTests()
    service.startWebrtcInstall({ install: async () => { throw failure } })
    await service.waitForCondition(() => service.getWebrtcInstallState().status === 'failed', {
      timeoutMs: 500,
      pollIntervalMs: 10,
      timeoutMessage: 'failed install job did not settle'
    })
    assert.equal(service.getWebrtcInstallState().error.code, failure.code)
    assert.equal(service.getWebrtcInstallState().error.retryable, true)
  })

  it('polls readiness and returns a clear timeout for a missing device', async () => {
    let attempts = 0
    const ready = await service.waitForWebrtcServerReady({
      timeoutMs: 200,
      pollIntervalMs: 5,
      isReachable: async () => ++attempts === 3
    })
    assert.equal(ready, true)
    assert.equal(attempts, 3)

    await assert.rejects(
      service.waitForWebrtcDevice('missing-device', {
        timeoutMs: 30,
        pollIntervalMs: 5,
        getDevices: async () => []
      }),
      error => error.code === 'WEBRTC_AGENT_START_TIMEOUT'
        && error.message.includes('missing-device')
        && error.message.includes('/devices')
    )
  })

  it('waits for the selected ADB target and reports its actual state', async () => {
    assert.equal(service.parseAdbDeviceState(
      'List of devices attached\n127.0.0.1:5555\tdevice product:test\n',
      '127.0.0.1:5555'
    ), 'device')

    const states = [null, 'offline', 'device']
    let attempts = 0
    const ready = await service.waitForAdbDeviceReady('127.0.0.1:5555', fakeAdbPath, {
      timeoutMs: 1000,
      pollIntervalMs: 5,
      getDeviceState: async () => {
        attempts += 1
        return states.length ? states.shift() : 'device'
      }
    })
    assert.equal(ready, 'device')
    assert.equal(attempts, 3)

    await assert.rejects(
      service.waitForAdbDeviceReady('127.0.0.1:5555', fakeAdbPath, {
        timeoutMs: 20,
        pollIntervalMs: 5,
        getDeviceState: async () => 'unauthorized'
      }),
      error => error.code === 'WEBRTC_ADB_DEVICE_UNAUTHORIZED'
        && error.message.includes('允许调试')
        && error.retryable === true
    )
  })

  it('recognizes a binary release assets layout without requiring build.sh', async () => {
    const legacyAssetsDir = join(fixtureDir, 'assets', 'v1')
    const releaseIndex = join(fixtureDir, 'assets', 'index.html')

    await rm(legacyAssetsDir, { recursive: true, force: true })
    await writeFile(releaseIndex, '<!doctype html>')

    try {
      assert.equal(await service.getWebrtcAssetsPath(), join(fixtureDir, 'assets'))
    } finally {
      await Promise.all([
        rm(releaseIndex, { force: true }),
        mkdir(legacyAssetsDir, { recursive: true })
      ])
    }
  })

  it('maps supported platforms and selects the normal release package', () => {
    assert.equal(service.getWebrtcPlatformDir('darwin', 'arm64'), 'darwin_arm64')
    assert.equal(service.getWebrtcPlatformDir('linux', 'x64'), 'linux_amd64')
    assert.equal(service.getWebrtcPlatformDir('win32', 'arm64'), 'windows_arm64')
    assert.throws(
      () => service.getWebrtcPlatformDir('freebsd', 'x64'),
      error => error.code === 'WEBRTC_PLATFORM_UNSUPPORTED'
    )

    const sha256 = 'a'.repeat(64)
    const asset = service.selectWebrtcReleaseAsset([
      { name: 'cloudphone-agent-magisk-v0.4.3.zip' },
      { name: 'cloudphone-v0.4.2.zip' },
      { name: 'cloudphone-v0.4.3.zip', digest: `sha256:${sha256}` },
      { name: 'cloudphone-v0.4.3-netdisk.zip' }
    ])
    assert.equal(asset.name, 'cloudphone-v0.4.3.zip')
    assert.equal(service.parseSha256Digest(`sha256:${sha256}`), sha256)
    assert.equal(service.parseSha256Digest('md5:abc'), null)
  })

  it('resolves release metadata and rejects an unverifiable package', async () => {
    const sha256 = 'b'.repeat(64)
    const fetchImpl = async url => {
      assert.match(url, /releases\/latest$/)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v0.4.3',
          assets: [{
            name: 'cloudphone-v0.4.3.zip',
            size: 123,
            digest: `sha256:${sha256}`,
            browser_download_url: 'https://example.invalid/cloudphone-v0.4.3.zip'
          }]
        })
      }
    }

    const release = await service.resolveWebrtcRelease({ fetchImpl })
    assert.equal(release.version, 'v0.4.3')
    assert.equal(release.assetName, 'cloudphone-v0.4.3.zip')
    assert.equal(release.sha256, sha256)
    assert.equal(release.size, 123)

    const missingDigestFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.4.3',
        assets: [{
          name: 'cloudphone-v0.4.3.zip',
          browser_download_url: 'https://example.invalid/cloudphone-v0.4.3.zip'
        }]
      })
    })
    await assert.rejects(
      service.resolveWebrtcRelease({ fetchImpl: missingDigestFetch }),
      error => error.code === 'WEBRTC_RELEASE_DIGEST_MISSING'
    )
  })

  it('downloads and verifies a release archive', async () => {
    const payload = Buffer.from('cloudphone release payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const destination = join(fixtureDir, 'release-download.zip')
    const badDestination = join(fixtureDir, 'release-download-bad.zip')

    try {
      const result = await service.downloadWebrtcRelease({
        url: `data:application/octet-stream;base64,${payload.toString('base64')}`,
        size: payload.length,
        sha256
      }, destination)
      assert.equal(result.sha256, sha256)
      assert.equal(await readFile(destination, 'utf8'), payload.toString())

      await assert.rejects(
        service.downloadWebrtcRelease({
          url: `data:application/octet-stream;base64,${payload.toString('base64')}`,
          size: payload.length,
          sha256: '0'.repeat(64)
        }, badDestination),
        error => error.code === 'WEBRTC_RELEASE_CHECKSUM_MISMATCH'
      )
    } finally {
      await Promise.all([
        rm(destination, { force: true }),
        rm(badDestination, { force: true })
      ])
    }
  })

  it('installs a release directory and preserves data and certs', async () => {
    const installRoot = await mkdtemp(join(tmpdir(), 'la-pluma-install-'))
    const releaseRoot = join(installRoot, 'release')
    const targetDir = join(installRoot, 'target')
    const platformDir = service.getWebrtcPlatformDir()
    const binaryName = process.platform === 'win32' ? 'webrtc-signaling.exe' : 'webrtc-signaling'
    const previousEnv = {
      dir: process.env.LA_PLUMA_WEBRTC_DIR,
      port: process.env.LA_PLUMA_WEBRTC_PORT,
      turnPort: process.env.LA_PLUMA_WEBRTC_TURN_PORT
    }

    await Promise.all([
      mkdir(join(releaseRoot, 'bin', platformDir), { recursive: true }),
      mkdir(join(releaseRoot, 'assets'), { recursive: true }),
      mkdir(join(releaseRoot, 'agentd'), { recursive: true }),
      mkdir(join(releaseRoot, 'data'), { recursive: true }),
      mkdir(join(releaseRoot, 'certs'), { recursive: true }),
      mkdir(join(targetDir, 'data'), { recursive: true }),
      mkdir(join(targetDir, 'certs'), { recursive: true })
    ])
    await Promise.all([
      writeFile(join(releaseRoot, 'bin', platformDir, binaryName), '#!/bin/sh\nexit 0\n'),
      writeFile(join(releaseRoot, 'assets', 'index.html'), '<!doctype html>'),
      writeFile(join(releaseRoot, 'agentd', 'run.sh'), '#!/bin/bash\n'),
      writeFile(join(releaseRoot, 'data', 'default.txt'), 'release-data'),
      writeFile(join(releaseRoot, 'certs', 'default.crt'), 'release-cert'),
      writeFile(join(targetDir, 'data', 'users.json'), '{"user":"existing"}'),
      writeFile(join(targetDir, 'certs', 'server.crt'), 'existing-cert'),
      writeFile(join(targetDir, '.la-pluma-release.json'), JSON.stringify({ version: 'v0.2.7' }))
    ])

    process.env.LA_PLUMA_WEBRTC_DIR = targetDir
    process.env.LA_PLUMA_WEBRTC_PORT = String(await getAvailablePort())
    process.env.LA_PLUMA_WEBRTC_TURN_PORT = String(await getAvailablePort())

    try {
      const installService = await import(`../webrtcService.js?webrtc-install-test=${Date.now()}`)
      const status = await installService.installWebrtcReleaseDirectory(
        releaseRoot,
        {
          version: 'v0.4.3',
          assetName: 'cloudphone-v0.4.3.zip',
          url: 'https://example.invalid/cloudphone-v0.4.3.zip',
          size: 123,
          sha256: 'c'.repeat(64)
        },
        { getStatus: async () => ({ installed: true, built: true }) }
      )

      assert.deepEqual(status, { installed: true, built: true })
      assert.equal(await readFile(join(targetDir, 'data', 'users.json'), 'utf8'), '{"user":"existing"}')
      assert.equal(await readFile(join(targetDir, 'certs', 'server.crt'), 'utf8'), 'existing-cert')
      assert.equal(await installService.pathExists(join(targetDir, 'data', 'default.txt')), false)

      const metadata = JSON.parse(await readFile(join(targetDir, '.la-pluma-release.json'), 'utf8'))
      assert.equal(metadata.version, 'v0.4.3')
      assert.equal(metadata.sha256, 'c'.repeat(64))
      assert.ok(metadata.backupDir)
      assert.equal(await readFile(join(metadata.backupDir, 'data', 'users.json'), 'utf8'), '{"user":"existing"}')
    } finally {
      if (previousEnv.dir === undefined) delete process.env.LA_PLUMA_WEBRTC_DIR
      else process.env.LA_PLUMA_WEBRTC_DIR = previousEnv.dir
      if (previousEnv.port === undefined) delete process.env.LA_PLUMA_WEBRTC_PORT
      else process.env.LA_PLUMA_WEBRTC_PORT = previousEnv.port
      if (previousEnv.turnPort === undefined) delete process.env.LA_PLUMA_WEBRTC_TURN_PORT
      else process.env.LA_PLUMA_WEBRTC_TURN_PORT = previousEnv.turnPort
      await rm(installRoot, { recursive: true, force: true })
    }
  })

  it('skips downloading when the installed release already matches', async () => {
    const metadataPath = join(fixtureDir, '.la-pluma-release.json')
    await writeFile(metadataPath, JSON.stringify({ version: 'v0.4.3' }))
    let downloadCalled = false

    try {
      const status = await service.installWebrtc({
        resolveRelease: async () => ({ version: 'v0.4.3', assetName: 'cloudphone-v0.4.3.zip' }),
        downloadRelease: async () => { downloadCalled = true }
      })
      assert.equal(status.installed, true)
      assert.equal(status.built, true)
      assert.equal(downloadCalled, false)
    } finally {
      await rm(metadataPath, { force: true })
    }
  })

  it('serializes concurrent starts and waits for authenticated device registration', async () => {
    const [first, second] = await Promise.all([
      service.startWebrtc('fixture-device', 'preview-device', fakeAdbPath),
      service.startWebrtc('fixture-device', 'preview-device', fakeAdbPath)
    ])

    assert.equal(first.serverRunning, true)
    assert.equal(first.agentRunning, true)
    assert.equal(first.signalingUrl, '/webrtc-signaling')
    assert.match(first.directSignalingUrl, /^ws:\/\//)
    assert.equal(second.serverRunning, true)
    assert.equal(second.agentRunning, true)
    assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['preview-device'])
    assert.equal(await countLines(serverCountFile), 1)
    assert.equal(await countLines(agentCountFile), 1)
    const serverArgs = JSON.parse(await readFile(serverArgsFile, 'utf8'))
    assert.equal(serverArgs.includes('-tls=false'), true)
    assert.deepEqual(serverArgs.slice(serverArgs.indexOf('-assets'), serverArgs.indexOf('-assets') + 2), [
      '-assets',
      join(fixtureDir, 'assets', 'v1')
    ])

    await service.startWebrtc('fixture-device', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(serverCountFile), 1)
    assert.equal(await countLines(agentCountFile), 1)

    const logPaths = await service.getWebrtcLogPaths()
    assert.deepEqual(await openFixtureLogDescriptors(Object.values(logPaths)), [])
  })

  it('keeps retained offline records out of the online device list', async () => {
    const previousDevices = await readFile(devicesFile, 'utf8')
    await writeFile(devicesFile, JSON.stringify([
      {
        device_id: 'online-device',
        online: true,
        snapshot_hash: 'online-hash',
        device_info: { agent_version: 'v0.4.3-1b7d786' }
      },
      {
        device_id: 'offline-device',
        online: false,
        snapshot_hash: 'offline-hash',
        device_info: { agent_version: 'v0.2.7-abcdef' }
      }
    ]))

    try {
      assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['online-device'])
      assert.deepEqual(
        (await service.getWebrtcDeviceRecords({ throwOnError: true })).map(record => ({
          id: record.id,
          online: record.online,
          agentVersion: record.agentVersion,
          snapshotHash: record.snapshotHash
        })),
        [
          { id: 'online-device', online: true, agentVersion: 'v0.4.3-1b7d786', snapshotHash: 'online-hash' },
          { id: 'offline-device', online: false, agentVersion: 'v0.2.7-abcdef', snapshotHash: 'offline-hash' }
        ]
      )
    } finally {
      await writeFile(devicesFile, previousDevices)
    }
  })

  it('reuses the signaling token and reads the latest device snapshot', async () => {
    await writeFile(loginCountFile, '')
    service.clearWebrtcAuthTokenCache()

    assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['preview-device'])
    const snapshot = await service.getWebrtcSnapshot('preview-device', { throwOnError: true })

    assert.equal(snapshot.mediaType, 'image/jpeg')
    assert.equal(snapshot.size, 4)
    assert.equal(snapshot.image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'))
    assert.equal(await countLines(loginCountFile), 1)
  })

  it('does not reuse a matching device id that belongs to another address', async () => {
    const beforeSwitch = await countLines(agentCountFile)

    await service.startWebrtcAgent('second-address', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(agentCountFile), beforeSwitch + 1)
    assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['preview-device'])

    await service.startWebrtcAgent('second-address', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(agentCountFile), beforeSwitch + 1)
  })

  it('falls back to a fresh deployment when the previous owner only has an offline record', async () => {
    await service.startWebrtcAgent('fixture-device', 'preview-device', fakeAdbPath)
    process.env.TEST_WEBRTC_OFFLINE_DEVICE_ID = 'preview-device'

    try {
      const result = await service.startWebrtcAgent('second-address', 'preview-device', fakeAdbPath)
      assert.equal(result.agentRunning, true)
      assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['preview-device'])
    } finally {
      delete process.env.TEST_WEBRTC_OFFLINE_DEVICE_ID
    }
  })

  it('rejects a nonzero agent deployment and cleans up the target address', async () => {
    const beforeFailure = await countLines(agentCountFile)

    await assert.rejects(
      service.startWebrtcAgent('failure-address', 'failed-device', fakeAdbPath),
      error => error.code === 'WEBRTC_PROCESS_EXITED' && error.message.includes('退出码 7')
    )

    assert.equal(await countLines(agentCountFile), beforeFailure + 1)
    assert.deepEqual(JSON.parse(await readFile(devicesFile, 'utf8')), [])
  })

  it('terminates and cleans up an agent deployment that times out', async () => {
    const beforeTimeout = await countLines(agentCountFile)

    await assert.rejects(
      service.startWebrtcAgent('timeout-address', 'timeout-device', fakeAdbPath),
      error => error.code === 'WEBRTC_AGENT_START_TIMEOUT' && error.message.includes('timeout-device')
    )

    assert.equal(await countLines(agentCountFile), beforeTimeout + 1)
    assert.deepEqual(JSON.parse(await readFile(devicesFile, 'utf8')), [])
    assert.equal((await service.getWebrtcStatus('timeout-address', fakeAdbPath)).agentRunning, false)
    const deploymentPid = Number(await readFile(agentPidFile, 'utf8'))
    await service.waitForCondition(() => {
      try {
        process.kill(deploymentPid, 0)
        return false
      } catch (error) {
        return error.code === 'ESRCH'
      }
    }, {
      timeoutMs: 200,
      pollIntervalMs: 10,
      timeoutMessage: 'timed-out agent deployment was not terminated'
    })
  })

  it('serializes start, start, and stop so no queued start resurrects the preview', async () => {
    const beforeInterleaving = await countLines(agentCountFile)
    const results = await Promise.all([
      service.startWebrtc('queued-address', 'queued-device', fakeAdbPath),
      service.startWebrtc('queued-address', 'queued-device', fakeAdbPath),
      service.stopWebrtc('queued-address', fakeAdbPath)
    ])

    assert.equal(results[0].agentRunning, true)
    assert.equal(results[1].agentRunning, true)
    assert.deepEqual(results[2], { stopped: true })
    assert.equal(await countLines(agentCountFile), beforeInterleaving + 1)
    assert.deepEqual(JSON.parse(await readFile(devicesFile, 'utf8')), [])

    await service.waitForCondition(async () => !await service.isWebrtcServerReachable(), {
      timeoutMs: 500,
      pollIntervalMs: 10,
      timeoutMessage: 'fixture signaling server did not stop'
    })
    assert.equal(await countLines(serverCountFile), 1)
  })
})
