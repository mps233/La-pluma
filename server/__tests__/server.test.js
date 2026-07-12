import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  createLaPlumaApp,
  loadHttpsOptions,
  normalizeBasePath,
  startLaPlumaServer
} from '../server.js'
import { WEBRTC_SIGNALING_PATH } from '../services/webrtcSignalingGateway.js'

const servers = []
const tempDirs = []

async function listen(app) {
  const server = createServer(app)
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop()
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
  while (tempDirs.length) await rm(tempDirs.pop(), { recursive: true, force: true })
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

    const reads = []
    const options = loadHttpsOptions({
      LA_PLUMA_HTTPS_CERT_PATH: '/cert.pem',
      LA_PLUMA_HTTPS_KEY_PATH: '/key.pem'
    }, path => {
      reads.push(path)
      return Buffer.from(path)
    })
    assert.deepEqual(reads, ['/cert.pem', '/key.pem'])
    assert.equal(options.cert.toString(), '/cert.pem')
    assert.equal(options.key.toString(), '/key.pem')
  })

  it('protects ticket issuance with LA_PLUMA_TOKEN and hides all other HTTP paths', async () => {
    const signalingGateway = {
      proxyPath: WEBRTC_SIGNALING_PATH,
      handleLogin(_req, res) {
        return res.json({ token: 'one-use-ticket' })
      }
    }
    const app = createLaPlumaApp({
      env: { LA_PLUMA_TOKEN: 'api-secret' },
      signalingGateway
    })
    const port = await listen(app)
    const baseUrl = `http://127.0.0.1:${port}${WEBRTC_SIGNALING_PATH}`

    const unauthorized = await fetch(`${baseUrl}/api/login`, { method: 'POST' })
    assert.equal(unauthorized.status, 401)
    assert.equal((await unauthorized.json()).error.code, 'AGENT_AUTH_REQUIRED')

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

    const signalingGateway = {
      proxyPath: WEBRTC_SIGNALING_PATH,
      handleLogin(_req, res) {
        return res.json({ token: 'fixture-ticket' })
      }
    }
    const app = createLaPlumaApp({
      env: { NODE_ENV: 'production', LA_PLUMA_BASE_PATH: '/la-pluma/' },
      signalingGateway,
      clientDistPath
    })
    const port = await listen(app)
    const origin = `http://127.0.0.1:${port}`

    const shell = await fetch(`${origin}/la-pluma/automation`)
    assert.equal(shell.status, 200)
    assert.match(await shell.text(), /La Pluma fixture/)

    const asset = await fetch(`${origin}/la-pluma/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /javascript/)
    assert.match(await asset.text(), /fixtureLoaded/)

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
      initializeRuntime: async () => {},
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
