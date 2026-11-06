import type { ApiErrorResponse } from '../utils/apiHelper.ts';
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { Express } from 'express'
import {
  createLaPlumaApp,
  loadHttpsOptions,
  normalizeBasePath,
  startLaPlumaServer
} from '../server.ts'
import { WEBRTC_SIGNALING_PATH, type createWebrtcSignalingGateway } from '../services/webrtcSignalingGateway.ts'

const servers: Server[] = []
const tempDirs: string[] = []

type SignalingGateway = ReturnType<typeof createWebrtcSignalingGateway>

function createSignalingGatewayStub(token: string): SignalingGateway {
  return {
    proxyPath: WEBRTC_SIGNALING_PATH,
    async handleLogin(_request, response) {
      return response.json({ token })
    },
    handleUpgrade() {},
    attach() {},
    close() {}
  }
}

async function listen(app: Express) {
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string', 'expected the test server to listen on a TCP port')
  return address.port
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop()!
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

describe('La Pluma transport configuration', () => {
  it('normalizes the production application base path', () => {
    assert.equal(normalizeBasePath(), '/')
    assert.equal(normalizeBasePath('la-pluma'), '/la-pluma/')
    assert.equal(normalizeBasePath('/la-pluma/'), '/la-pluma/')
  })

  it('requires both HTTPS paths and loads both certificate files', () => {
    assert.equal(loadHttpsOptions({}), null)
    assert.throws(
      () => loadHttpsOptions({ LA_PLUMA_HTTPS_CERT_PATH: '/cert.pem' }),
      /必须同时配置/
    )

    const reads: string[] = []
    const options = loadHttpsOptions({
      LA_PLUMA_HTTPS_CERT_PATH: '/cert.pem',
      LA_PLUMA_HTTPS_KEY_PATH: '/key.pem'
    }, (path) => {
      reads.push(path)
      return Buffer.from(path)
    })
    assert.deepEqual(reads, ['/cert.pem', '/key.pem'])
    assert.equal(options!.cert.toString(), '/cert.pem')
    assert.equal(options!.key.toString(), '/key.pem')
  })

  it('protects ticket issuance with LA_PLUMA_TOKEN and hides all other HTTP paths', async () => {
    const signalingGateway = createSignalingGatewayStub('one-use-ticket')
    const app = createLaPlumaApp({
      env: { LA_PLUMA_TOKEN: 'api-secret' },
      signalingGateway
    })
    const port = await listen(app)
    const baseUrl = `http://127.0.0.1:${port}${WEBRTC_SIGNALING_PATH}`

    const unauthorized = await fetch(`${baseUrl}/api/login`, { method: 'POST' })
    assert.equal(unauthorized.status, 401)
    assert.equal((await unauthorized.json() as ApiErrorResponse).error.code, 'AGENT_AUTH_REQUIRED')

    const authorized = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { Authorization: 'Bearer api-secret' }
    })
    assert.equal(authorized.status, 200)
    assert.deepEqual(await authorized.json(), { token: 'one-use-ticket' })

    const hidden = await fetch(`${baseUrl}/devices`)
    assert.equal(hidden.status, 404)
    assert.deepEqual(await hidden.json(), { error: 'Not Found' })
  })

  it('serves the production shell and assets from the configured base path', async () => {
    const clientDistPath = await mkdtemp(join(tmpdir(), 'la-pluma-client-'))
    tempDirs.push(clientDistPath)
    await mkdir(join(clientDistPath, 'assets'))
    await writeFile(join(clientDistPath, 'index.html'), '<!doctype html><title>La Pluma fixture</title>')
    await writeFile(join(clientDistPath, 'assets', 'app.js'), 'globalThis.fixtureLoaded = true')
    await writeFile(join(clientDistPath, 'assets', 'big.js'), `globalThis.bigFixture = ${JSON.stringify('x'.repeat(4096))}`)

    const signalingGateway = createSignalingGatewayStub('fixture-ticket')
    const app = createLaPlumaApp({
      env: { NODE_ENV: 'production', LA_PLUMA_BASE_PATH: '/la-pluma/' },
      signalingGateway,
      clientDistPath
    })
    const port = await listen(app)
    const origin = `http://127.0.0.1:${port}`

    const shell = await fetch(`${origin}/la-pluma/automation`)
    assert.equal(shell.status, 200)
    assert.equal(shell.headers.get('cache-control'), 'no-cache')
    assert.match(await shell.text(), /La Pluma fixture/)

    const asset = await fetch(`${origin}/la-pluma/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type') || '', /javascript/)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.match(await asset.text(), /fixtureLoaded/)

    const bigAsset = await fetch(`${origin}/la-pluma/assets/big.js`)
    assert.equal(bigAsset.status, 200)
    assert.equal(bigAsset.headers.get('content-encoding'), 'gzip')
    assert.equal(bigAsset.headers.get('vary'), 'Accept-Encoding')
    assert.match(await bigAsset.text(), /bigFixture/)

    const missingAsset = await fetch(`${origin}/la-pluma/assets/missing.js`)
    assert.equal(missingAsset.status, 404)

    const wrongRoot = await fetch(`${origin}/`)
    assert.equal(wrongRoot.status, 404)

    for (const reservedPath of ['api', 'health', 'webrtc-signaling']) {
      const reservedResponse = await fetch(`${origin}/la-pluma/${reservedPath}`)
      assert.equal(reservedResponse.status, 404)
      assert.doesNotMatch(await reservedResponse.text(), /La Pluma fixture/)
    }
  })

  it('starts on an ephemeral HTTP port and closes without leaving a listener', async () => {
    const runtime = await startLaPlumaServer({
      env: {},
      host: '127.0.0.1',
      port: 0,
      initializeRunStore: async () => ({
        filePath: '/tmp/test-agent-runs.json',
        restoredRuns: 0,
        interruptedRuns: 0,
        prunedRuns: 0
      }),
      prewarmStageCatalog: false,
      initializeRuntime: async () => ({
        notification: { restored: false },
        schedule: { restored: false },
        autoUpdate: { restored: false },
        telegram: { initialized: false }
      }),
      logger: { log() {}, error() {} }
    })

    try {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/health`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { success: true, status: 'ok' })
      assert.equal(runtime.server.listening, true)
    } finally {
      await runtime.close()
    }
    assert.equal(runtime.server.listening, false)
  })
})
