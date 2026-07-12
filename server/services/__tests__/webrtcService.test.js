import assert from 'node:assert/strict'
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
  'TEST_WEBRTC_AGENT_COUNT_FILE',
  'TEST_WEBRTC_AGENT_PID_FILE',
  'TEST_WEBRTC_SERVER_PID_FILE'
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
  let agentCountFile
  let agentPidFile
  let serverPidFile
  let fakeAdbPath
  let service
  const previousEnv = new Map()

  before(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'la-pluma-webrtc-'))
    const binaryDir = join(fixtureDir, 'bin', arch() === 'arm64' ? 'darwin_arm64' : 'darwin_amd64')
    const assetsDir = join(fixtureDir, 'assets', 'v1')
    const agentDir = join(fixtureDir, 'agentd')
    await Promise.all([
      mkdir(binaryDir, { recursive: true }),
      mkdir(assetsDir, { recursive: true }),
      mkdir(agentDir, { recursive: true })
    ])

    devicesFile = join(fixtureDir, 'devices.json')
    serverCountFile = join(fixtureDir, 'server-count.log')
    agentCountFile = join(fixtureDir, 'agent-count.log')
    agentPidFile = join(fixtureDir, 'agent.pid')
    serverPidFile = join(fixtureDir, 'server.pid')
    fakeAdbPath = join(fixtureDir, 'adb')
    await writeFile(devicesFile, '[]')

    const signalingPath = join(binaryDir, 'webrtc-signaling')
    await writeFile(signalingPath, `#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')

fs.appendFileSync(process.env.TEST_WEBRTC_SERVER_COUNT_FILE, 'spawn\\n')
fs.writeFileSync(process.env.TEST_WEBRTC_SERVER_PID_FILE, String(process.pid))

const server = http.createServer((request, response) => {
  if (request.url === '/api/login' && request.method === 'POST') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ token: 'fixture-token' }))
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
if [[ "$*" == *"pkill -f cloudphone-agent"* ]]; then
  printf '[]' > "$TEST_WEBRTC_DEVICES_FILE"
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
      TEST_WEBRTC_AGENT_COUNT_FILE: agentCountFile,
      TEST_WEBRTC_AGENT_PID_FILE: agentPidFile,
      TEST_WEBRTC_SERVER_PID_FILE: serverPidFile
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

    await service.startWebrtc('fixture-device', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(serverCountFile), 1)
    assert.equal(await countLines(agentCountFile), 1)

    const logPaths = await service.getWebrtcLogPaths()
    assert.deepEqual(await openFixtureLogDescriptors(Object.values(logPaths)), [])
  })

  it('does not reuse a matching device id that belongs to another address', async () => {
    const beforeSwitch = await countLines(agentCountFile)

    await service.startWebrtcAgent('second-address', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(agentCountFile), beforeSwitch + 1)
    assert.deepEqual(await service.getWebrtcDevices({ throwOnError: true }), ['preview-device'])

    await service.startWebrtcAgent('second-address', 'preview-device', fakeAdbPath)
    assert.equal(await countLines(agentCountFile), beforeSwitch + 1)
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
