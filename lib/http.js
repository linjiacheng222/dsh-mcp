/**
 * HTTP plumbing between Node's `http` server and the MCP SDK's Web-standard
 * fetch handler, plus the same-origin management API used by the browser UI.
 *
 * The DSH webserver route table owns authentication for `/api`; these routes
 * are separate and therefore enforce their own loopback/host/origin/token
 * checks.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { API_PREFIX, MCP_PATH } from './defaults.js'
import { GatewayError, httpStatusFor, publicError } from './errors.js'

const MCP_MAX_BODY = 8 * 1024 * 1024
const API_MAX_BODY = 256 * 1024

function headerValue(request, name) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function remoteAddress(request) {
  return request.socket?.remoteAddress ?? request.connection?.remoteAddress ?? ''
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  let value = address.toLowerCase()
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length)
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (value === 'localhost') return true
  if (/^127(?:\.\d{1,3}){3}$/.test(value)) {
    return value
      .split('.')
      .slice(1)
      .every((part) => Number(part) >= 0 && Number(part) <= 255)
  }
  return false
}

export function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return null
  let value = hostHeader.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0) return null
    return value.slice(1, end).toLowerCase()
  }
  const colon = value.lastIndexOf(':')
  if (colon >= 0 && value.indexOf(':') === colon) value = value.slice(0, colon)
  return value.toLowerCase() || null
}

function originHostname(origin) {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

function allowedOrigins(ctx) {
  const values = new Set()
  try {
    const origin = ctx.webServer?.getOrigin?.()
    if (typeof origin === 'string') values.add(origin)
  } catch {
    // not bound yet
  }
  const port = ctx.webServer?.port
  if (typeof port === 'number' && port > 0) {
    values.add(`http://127.0.0.1:${port}`)
    values.add(`http://localhost:${port}`)
    values.add(`http://[::1]:${port}`)
  }
  return values
}

function allowedHosts(ctx) {
  const values = new Set(['localhost', '::1'])
  const bindHost = ctx.webServer?.host
  if (typeof bindHost === 'string' && bindHost.length > 0) values.add(bindHost.toLowerCase())
  try {
    const origin = ctx.webServer?.getOrigin?.()
    const hostname = origin === undefined ? null : originHostname(origin)
    if (hostname !== null) values.add(hostname)
  } catch {
    // ignore
  }
  return values
}

function hostAllowed(request, ctx, allowNonLoopback) {
  const hostname = hostnameOf(headerValue(request, 'host'))
  if (hostname === null) return false
  if (isLoopbackAddress(hostname)) return true
  if (allowNonLoopback !== true) return false
  return allowedHosts(ctx).has(hostname)
}

function originAllowed(request, ctx) {
  const origin = headerValue(request, 'origin')
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin.length === 0) return false
  return allowedOrigins(ctx).has(origin)
}

function crossSite(request) {
  return headerValue(request, 'sec-fetch-site') === 'cross-site'
}

function safeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(request) {
  const value = headerValue(request, 'authorization')
  if (typeof value !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match === null ? null : match[1].trim()
}

export function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(headerValue(request, 'content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new GatewayError('bad-request', 'request body is too large', { maxBytes }))
      request.resume()
      return
    }
    const chunks = []
    let total = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onClose)
      reject(error)
    }
    const onData = (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        fail(new GatewayError('bad-request', 'request body is too large', { maxBytes }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      request.removeListener('data', onData)
      request.removeListener('error', onError)
      request.removeListener('aborted', onClose)
      resolve(Buffer.concat(chunks))
    }
    const onError = (error) => fail(error)
    const onClose = () => fail(new GatewayError('bad-request', 'request was aborted'))
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onClose)
  })
}

function absoluteOrigin(request, ctx) {
  try {
    const origin = ctx.webServer?.getOrigin?.()
    if (typeof origin === 'string') return origin
  } catch {
    // fall through
  }
  const host = headerValue(request, 'host')
  return `http://${typeof host === 'string' && host.length > 0 ? host : '127.0.0.1'}`
}

export function toWebRequest(request, body, ctx, res) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.once('aborted', abort)
  if (res !== undefined) res.once('close', abort)
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'undefined') continue
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry)
    } else {
      headers.set(key, value)
    }
  }
  const url = new URL(request.url ?? '/', absoluteOrigin(request, ctx))
  const method = request.method ?? 'GET'
  return new Request(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: controller.signal,
  })
}

export async function writeWebResponse(response, request, res) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  if (res.headersSent) return
  res.writeHead(response.status, headers)
  if (request.method === 'HEAD' || response.body === null) {
    res.end()
    return
  }
  const stream = Readable.fromWeb(response.body)
  const cleanup = () => {
    res.removeListener('close', onClose)
    stream.removeListener('end', cleanup)
    stream.removeListener('error', onError)
  }
  const onClose = () => {
    if (res.writableEnded) return
    cleanup()
    stream.destroy()
  }
  const onError = () => {
    cleanup()
    if (!res.writableEnded) res.destroy()
  }
  res.once('close', onClose)
  stream.once('end', cleanup)
  stream.on('error', onError)
  stream.pipe(res)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res, error) {
  const status = httpStatusFor(error)
  sendJson(res, status, { ok: false, error: publicError(error) })
}

function jsonRpcError(res, status, message) {
  sendJson(res, status, {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message },
  })
}

function requireUiRequest(request, ctx) {
  if (!isLoopbackAddress(remoteAddress(request))) {
    throw new GatewayError('origin-denied', 'management API is available on loopback only')
  }
  if (!hostAllowed(request, ctx, false)) {
    throw new GatewayError('host-denied', 'management API host is not allowed')
  }
  if (crossSite(request)) {
    throw new GatewayError('origin-denied', 'cross-site management request refused')
  }
  if (!originAllowed(request, ctx)) {
    throw new GatewayError('origin-denied', 'management API origin is not the DSH application')
  }
  if (headerValue(request, 'x-dsh-mcp-ui') !== '1') {
    throw new GatewayError('origin-denied', 'missing X-DSH-MCP-UI header')
  }
}

function requireMcpTrust(request, ctx, settings) {
  if (settings.server.allowNonLoopback !== true && !isLoopbackAddress(remoteAddress(request))) {
    throw new GatewayError('origin-denied', 'MCP endpoint is restricted to loopback clients')
  }
  if (!hostAllowed(request, ctx, settings.server.allowNonLoopback === true)) {
    throw new GatewayError('host-denied', 'MCP request host is not allowed')
  }
  if (crossSite(request)) {
    throw new GatewayError('origin-denied', 'cross-site MCP request refused')
  }
  if (!originAllowed(request, ctx)) {
    throw new GatewayError('origin-denied', 'MCP request origin is not the DSH application')
  }
}

function requireMcpToken(request, settings) {
  const supplied = bearerToken(request)
  if (!safeTokenEqual(supplied, settings.server.token)) {
    throw new GatewayError('unauthorized', 'missing or invalid MCP bearer token')
  }
}

/** Handle one `/dsh-mcp/mcp` request. */
export async function handleMcpRequest(request, res, { ctx, store, mcp }) {
  try {
    const settings = store.current()
    requireMcpTrust(request, ctx, settings)
    if (settings.server.enabled !== true) {
      jsonRpcError(res, 503, 'DSH MCP gateway is disabled in settings')
      return
    }
    requireMcpToken(request, settings)
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRequestBody(request, MCP_MAX_BODY)
    const webRequest = toWebRequest(request, body, ctx, res)
    const webResponse = await mcp.handler.fetch(webRequest)
    await writeWebResponse(webResponse, request, res)
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'unauthorized') {
      res.setHeader('www-authenticate', 'Bearer realm="dsh-mcp-gateway"')
      jsonRpcError(res, 401, error.message)
      return
    }
    if (error instanceof GatewayError && error.code === 'origin-denied') {
      jsonRpcError(res, 403, error.message)
      return
    }
    if (error instanceof GatewayError && error.code === 'host-denied') {
      jsonRpcError(res, 403, error.message)
      return
    }
    if (error instanceof GatewayError && error.code === 'bad-request') {
      jsonRpcError(res, 400, error.message)
      return
    }
    if (!res.headersSent) {
      jsonRpcError(res, 500, 'MCP gateway internal error')
    } else if (!res.writableEnded) {
      res.destroy()
    }
  }
}

function parseJsonBody(buffer) {
  if (buffer.length === 0) {
    throw new GatewayError('bad-request', 'request body is empty')
  }
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new GatewayError('bad-request', 'request body is not valid JSON')
  }
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GatewayError('invalid-argument', 'revision must be a non-negative integer', {
      field: 'revision',
    })
  }
  return value
}

/** Handle one `/dsh-mcp/api/*` request. */
export async function handleApiRequest(request, res, { ctx, store, bridge, approvals }) {
  try {
    requireUiRequest(request, ctx)
    const url = new URL(request.url ?? '/', absoluteOrigin(request, ctx))
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/'
    if (request.method === 'GET' && (route === '/state' || route === '/catalog')) {
      sendJson(res, 200, await bridge.state())
      return
    }
    if (request.method === 'GET' && route === '/approvals') {
      sendJson(res, 200, {
        ok: true,
        revision: store.snapshot().revision,
        pending: approvals?.list?.() ?? [],
      })
      return
    }
    if (request.method === 'POST' && route === '/settings') {
      const body = parseJsonBody(await readRequestBody(request, API_MAX_BODY))
      if (typeof body !== 'object' || body === null) {
        throw new GatewayError('bad-request', 'body must be an object')
      }
      const revision = requireRevision(body.revision)
      await store.update(body.patch, revision)
      sendJson(res, 200, await bridge.state())
      return
    }
    if (request.method === 'POST' && route === '/token') {
      const body = parseJsonBody(await readRequestBody(request, API_MAX_BODY))
      const revision = requireRevision(body.revision)
      await store.rotateToken(revision)
      sendJson(res, 200, await bridge.state())
      return
    }
    if (request.method === 'POST' && route === '/onboarding') {
      const body = parseJsonBody(await readRequestBody(request, API_MAX_BODY))
      const revision = requireRevision(body.revision)
      const input = {}
      if (body.shown !== undefined) input.shown = body.shown
      if (body.acknowledged !== undefined) input.acknowledged = body.acknowledged
      await store.setOnboarding(input, revision)
      sendJson(res, 200, await bridge.state())
      return
    }
    if (request.method === 'POST' && route.startsWith('/approvals/')) {
      if (approvals === undefined || approvals === null) {
        throw new GatewayError('unsupported', 'approval queue is not mounted')
      }
      const id = route.slice('/approvals/'.length)
      if (id.length === 0) throw new GatewayError('invalid-argument', 'approval id is required')
      const body = parseJsonBody(await readRequestBody(request, API_MAX_BODY))
      const result = approvals.decide(id, body.decision)
      if (!result.ok) {
        throw new GatewayError('not-found', 'approval request is no longer pending', { id })
      }
      sendJson(res, 200, {
        ok: true,
        pending: approvals.list(),
        pendingCount: result.pendingCount,
      })
      return
    }
    if (
      route === '/state' ||
      route === '/catalog' ||
      route === '/settings' ||
      route === '/token' ||
      route === '/onboarding' ||
      route === '/approvals' ||
      route.startsWith('/approvals/')
    ) {
      res
        .writeHead(405, { allow: route === '/state' || route === '/approvals' ? 'GET' : 'POST' })
        .end()
      return
    }
    sendJson(res, 404, {
      ok: false,
      error: { code: 'not-found', message: `unknown management route "${route}"` },
    })
  } catch (error) {
    if (!res.headersSent) sendError(res, error)
    else if (!res.writableEnded) res.destroy()
  }
}

/**
 * Register both routes on the DSH webserver and return a disposer.
 * @param {{ctx: object, store: object, bridge: object, mcp: object, approvals: object}} options
 */
export function registerGatewayRoutes({ ctx, store, bridge, mcp, approvals }) {
  const disposeMcp = ctx.webServer.register({
    kind: 'exact',
    path: MCP_PATH,
    handler: (request, res) => {
      void handleMcpRequest(request, res, { ctx, store, mcp })
    },
  })
  const disposeApi = ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (request, res) => {
      void handleApiRequest(request, res, { ctx, store, bridge, approvals })
    },
  })
  return () => {
    disposeMcp()
    disposeApi()
  }
}

/** Exported for unit tests. */
export const internals = {
  safeTokenEqual,
  hostnameOf,
  isLoopbackAddress,
  hostAllowed,
  originAllowed,
  allowedOrigins,
  allowedHosts,
  bearerToken,
  MCP_MAX_BODY,
  API_MAX_BODY,
}
