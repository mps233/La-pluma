import { randomUUID } from 'node:crypto'
import { connect as connectTcp } from 'node:net'
import { getWebrtcAuthToken, WEBRTC_PORT } from './webrtcService.js'

export const WEBRTC_SIGNALING_PATH = '/webrtc-signaling'

const DEFAULT_TICKET_TTL_MS = 15_000
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_TICKETS = 256

function writeUpgradeError(socket, statusCode, statusText) {
  if (socket.destroyed) return
  const body = `${statusText}\n`
  socket.end([
    `HTTP/1.1 ${statusCode} ${statusText}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body
  ].join('\r\n'))
}

function serializeUpgradeRequest(request, upstreamPath, targetAuthority) {
  const lines = [`${request.method || 'GET'} ${upstreamPath} HTTP/${request.httpVersion || '1.1'}`]
  let hasHost = false

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    const lowerName = name.toLowerCase()
    // ScrcpyOverWebRTC rejects browser Origin checks on its loopback listener.
    // The public gateway already authenticates a short-lived, one-use ticket.
    if (lowerName === 'origin' || lowerName === 'proxy-authorization') continue
    if (lowerName === 'host') {
      lines.push(`${name}: ${targetAuthority}`)
      hasHost = true
      continue
    }
    lines.push(`${name}: ${value}`)
  }

  if (!hasHost) lines.push(`Host: ${targetAuthority}`)
  lines.push('', '')
  return lines.join('\r\n')
}

function parseClientUpgrade(request, proxyPath) {
  let url
  try {
    url = new URL(request.url || '/', 'http://localhost')
  } catch {
    return null
  }

  if (url.pathname !== `${proxyPath}/connect_client`) return null
  const ticket = url.searchParams.get('token')?.trim()
  return ticket ? { ticket } : null
}

export function createWebrtcSignalingGateway({
  proxyPath = WEBRTC_SIGNALING_PATH,
  targetHost = '127.0.0.1',
  targetPort = WEBRTC_PORT,
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  maxTickets = DEFAULT_MAX_TICKETS,
  now = () => Date.now(),
  createTicket = () => randomUUID(),
  getUpstreamToken = () => getWebrtcAuthToken({ throwOnError: true }),
  connect = connectTcp
} = {}) {
  const tickets = new Map()
  const activeSockets = new Set()
  const ticketLimit = Number.isInteger(maxTickets) && maxTickets > 0 ? maxTickets : DEFAULT_MAX_TICKETS
  let attachedServer = null

  function pruneTickets() {
    const currentTime = now()
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt <= currentTime) tickets.delete(ticket)
    }
  }

  async function handleLogin(request, response) {
    request.resume()
    try {
      const upstreamToken = await getUpstreamToken()
      if (typeof upstreamToken !== 'string' || !upstreamToken.trim()) {
        throw new Error('WebRTC signaling token is unavailable')
      }

      pruneTickets()
      while (tickets.size >= ticketLimit) tickets.delete(tickets.keys().next().value)
      const ticket = createTicket()
      tickets.set(ticket, {
        upstreamToken,
        expiresAt: now() + ticketTtlMs
      })
      response.set('Cache-Control', 'no-store')
      return response.json({ token: ticket, expiresInMs: ticketTtlMs })
    } catch {
      response.set('Cache-Control', 'no-store')
      return response.status(503).json({ error: 'WebRTC signaling service is unavailable' })
    }
  }

  function consumeTicket(ticket) {
    pruneTickets()
    const entry = tickets.get(ticket)
    tickets.delete(ticket)
    if (!entry || entry.expiresAt <= now()) return null
    return entry.upstreamToken
  }

  function handleUpgrade(request, clientSocket, head) {
    const parsed = parseClientUpgrade(request, proxyPath)
    if (!parsed) {
      writeUpgradeError(clientSocket, 404, 'Not Found')
      return
    }

    const upstreamToken = consumeTicket(parsed.ticket)
    if (!upstreamToken) {
      writeUpgradeError(clientSocket, 401, 'Unauthorized')
      return
    }

    const targetAuthority = `${targetHost}:${targetPort}`
    const upstreamPath = `/connect_client?token=${encodeURIComponent(upstreamToken)}`
    const upstreamSocket = connect({ host: targetHost, port: targetPort })
    let connected = false
    let failedBeforeConnect = false

    activeSockets.add(clientSocket)
    activeSockets.add(upstreamSocket)
    const forgetClient = () => activeSockets.delete(clientSocket)
    const forgetUpstream = () => activeSockets.delete(upstreamSocket)
    clientSocket.once('close', forgetClient)
    upstreamSocket.once('close', forgetUpstream)

    clientSocket.once('error', () => upstreamSocket.destroy())
    clientSocket.once('close', () => upstreamSocket.destroy())
    const failBeforeConnect = (statusCode, statusText) => {
      if (failedBeforeConnect) return
      failedBeforeConnect = true
      writeUpgradeError(clientSocket, statusCode, statusText)
      upstreamSocket.destroy()
    }
    upstreamSocket.setTimeout(connectTimeoutMs, () => {
      if (!connected) failBeforeConnect(504, 'Gateway Timeout')
    })
    upstreamSocket.once('error', () => {
      if (!connected) failBeforeConnect(502, 'Bad Gateway')
      else clientSocket.destroy()
    })
    upstreamSocket.once('close', () => {
      if (connected) clientSocket.destroy()
      else if (!failedBeforeConnect) failBeforeConnect(502, 'Bad Gateway')
    })

    upstreamSocket.once('connect', () => {
      if (clientSocket.destroyed) {
        upstreamSocket.destroy()
        return
      }
      connected = true
      upstreamSocket.setTimeout(0)
      upstreamSocket.write(serializeUpgradeRequest(request, upstreamPath, targetAuthority))
      if (head?.length) upstreamSocket.write(head)
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })
  }

  function attach(server) {
    if (attachedServer === server) return
    if (attachedServer) throw new Error('WebRTC signaling gateway is already attached')
    attachedServer = server
    server.on('upgrade', handleUpgrade)
  }

  function close() {
    if (attachedServer) attachedServer.off('upgrade', handleUpgrade)
    attachedServer = null
    tickets.clear()
    for (const socket of activeSockets) socket.destroy()
    activeSockets.clear()
  }

  return {
    proxyPath,
    handleLogin,
    handleUpgrade,
    attach,
    close
  }
}
