import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'
import express from 'express'
import { afterEach, describe, it } from 'node:test'
import {
  createWebrtcSignalingGateway,
  WEBRTC_SIGNALING_PATH
} from '../webrtcSignalingGateway.js'

const cleanupTasks = []

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function closeServer(server) {
  if (!server.listening) return
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function openUpgrade(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let response = ''
    const finish = () => {
      if (!response.includes('\r\n\r\n')) return
      socket.off('error', reject)
      resolve({ socket, response })
    }
    socket.once('error', reject)
    socket.on('data', chunk => {
      response += chunk.toString('utf8')
      finish()
    })
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Origin: https://console.example',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        ''
      ].join('\r\n'))
    })
  })
}

async function createFixture({ now = () => Date.now(), ticketTtlMs } = {}) {
  const upstreamRequests = []
  const upstream = createTcpServer(socket => {
    let request = ''
    socket.on('data', chunk => {
      request += chunk.toString('utf8')
      if (!request.includes('\r\n\r\n')) return
      upstreamRequests.push(request)
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: websocket',
        '',
        ''
      ].join('\r\n'))
    })
  })
  const upstreamPort = await listen(upstream)
  let ticketSequence = 0
  const gateway = createWebrtcSignalingGateway({
    targetPort: upstreamPort,
    now,
    ticketTtlMs,
    createTicket: () => `proxy-ticket-${++ticketSequence}`,
    getUpstreamToken: async () => 'upstream-secret'
  })
  const app = express()
  app.post(`${WEBRTC_SIGNALING_PATH}/api/login`, gateway.handleLogin)
  const server = createHttpServer(app)
  gateway.attach(server)
  const port = await listen(server)

  cleanupTasks.push(async () => {
    gateway.close()
    await closeServer(server)
    await closeServer(upstream)
  })
  return { gateway, port, upstreamRequests }
}

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()()
})

describe('WebRTC same-origin signaling gateway', () => {
  it('exchanges the protected HTTP login for a one-use proxy ticket', async () => {
    const fixture = await createFixture()
    const response = await fetch(`http://127.0.0.1:${fixture.port}${WEBRTC_SIGNALING_PATH}/api/login`, {
      method: 'POST'
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(body.token, 'proxy-ticket-1')
    assert.equal(body.expiresInMs, 15_000)
    assert.equal(JSON.stringify(body).includes('upstream-secret'), false)

    const first = await openUpgrade(
      fixture.port,
      `${WEBRTC_SIGNALING_PATH}/connect_client?token=${body.token}`
    )
    assert.match(first.response, /^HTTP\/1\.1 101 Switching Protocols/)
    assert.equal(fixture.upstreamRequests.length, 1)
    assert.match(fixture.upstreamRequests[0], /^GET \/connect_client\?token=upstream-secret HTTP\/1\.1/m)
    assert.equal(fixture.upstreamRequests[0].includes('proxy-ticket-1'), false)
    assert.doesNotMatch(fixture.upstreamRequests[0], /^Origin:/im)
    first.socket.destroy()

    const replay = await openUpgrade(
      fixture.port,
      `${WEBRTC_SIGNALING_PATH}/connect_client?token=${body.token}`
    )
    assert.match(replay.response, /^HTTP\/1\.1 401 Unauthorized/)
    assert.equal(fixture.upstreamRequests.length, 1)
    replay.socket.destroy()
  })

  it('rejects expired tickets and every non-client signaling path', async () => {
    let currentTime = 1_000
    const fixture = await createFixture({ now: () => currentTime, ticketTtlMs: 25 })
    const response = await fetch(`http://127.0.0.1:${fixture.port}${WEBRTC_SIGNALING_PATH}/api/login`, {
      method: 'POST'
    })
    const { token } = await response.json()
    currentTime += 26

    const expired = await openUpgrade(
      fixture.port,
      `${WEBRTC_SIGNALING_PATH}/connect_client?token=${token}`
    )
    assert.match(expired.response, /^HTTP\/1\.1 401 Unauthorized/)
    expired.socket.destroy()

    const forbidden = await openUpgrade(
      fixture.port,
      `${WEBRTC_SIGNALING_PATH}/connect_agent?token=${token}`
    )
    assert.match(forbidden.response, /^HTTP\/1\.1 404 Not Found/)
    forbidden.socket.destroy()
    assert.equal(fixture.upstreamRequests.length, 0)
  })
})
