import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { GatewayError } from '../lib/errors.js'
import {
  handleApiRequest,
  handleMcpRequest,
  internals,
} from '../lib/http.js'

function fakeRequest({ method = 'GET', url = '/dsh-mcp/api/state', headers = {}, body, remote = '127.0.0.1' } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = method
  request.url = url
  request.headers = {
    host: '127.0.0.1:61680',
    'x-dsh-mcp-ui': '1',
    origin: 'http://127.0.0.1:61680',
    ...headers,
  }
  request.socket = { remoteAddress: remote }
  request.connection = request.socket
  return request
}

function fakeResponse() {
  const state = {
    status: null,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers = {}) {
      state.status = status
      state.headers = headers
      state.headersSent = true
      return state
    },
    setHeader(key, value) {
      state.headers[key] = value
      return state
    },
    end(body) {
      if (body !== undefined) state.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
      state.writableEnded = true
    },
    destroy() {
      state.destroyed = true
    },
  }
  return state
}

function ctxMock() {
  return {
    webServer: {
      port: 61680,
      host: '127.0.0.1',
      getOrigin: () => 'http://127.0.0.1:61680',
    },
  }
}

function apiStore({ revision = 1, conflict = false } = {}) {
  let currentRevision = revision
  return {
    snapshot() {
      return { revision: currentRevision, settings: {}, warnings: [] }
    },
    async update(patch, expected) {
      if (conflict || expected !== currentRevision) {
        throw new GatewayError('revision-conflict', 'conflict', {
          expected,
          actual: currentRevision,
        })
      }
      currentRevision += 1
      return { revision: currentRevision }
    },
    async rotateToken(expected) {
      if (expected !== currentRevision) throw new GatewayError('revision-conflict', 'conflict')
      currentRevision += 1
      return { revision: currentRevision }
    },
    async setOnboarding(input, expected) {
      if (expected !== currentRevision) throw new GatewayError('revision-conflict', 'conflict')
      currentRevision += 1
      return { revision: currentRevision }
    },
  }
}

const bridgeMock = {
  async state() {
    return { ok: true, revision: 2, settings: {}, endpoint: {}, catalog: {}, status: {} }
  },
}

function parseBody(response) {
  return JSON.parse(response.body)
}

test('loopback and host parsing helpers', () => {
  assert.equal(internals.isLoopbackAddress('127.0.0.1'), true)
  assert.equal(internals.isLoopbackAddress('::1'), true)
  assert.equal(internals.isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(internals.isLoopbackAddress('192.168.1.2'), false)
  assert.equal(internals.hostnameOf('127.0.0.1:61680'), '127.0.0.1')
  assert.equal(internals.hostnameOf('[::1]:61680'), '::1')
  assert.equal(internals.safeTokenEqual('abc', 'abc'), true)
  assert.equal(internals.safeTokenEqual('abc', 'abd'), false)
})

test('management API requires the UI header and loopback peer', async () => {
  const request = fakeRequest({ headers: { 'x-dsh-mcp-ui': undefined } })
  request.headers['x-dsh-mcp-ui'] = undefined
  const response = fakeResponse()
  await handleApiRequest(request, response, { ctx: ctxMock(), store: apiStore(), bridge: bridgeMock })
  assert.equal(response.status, 403)
  assert.equal(parseBody(response).error.code, 'origin-denied')

  const remote = fakeRequest({ remote: '192.168.1.5' })
  const remoteResponse = fakeResponse()
  await handleApiRequest(remote, remoteResponse, {
    ctx: ctxMock(),
    store: apiStore(),
    bridge: bridgeMock,
  })
  assert.equal(remoteResponse.status, 403)
})

test('management API returns state and enforces revision conflicts', async () => {
  const stateResponse = fakeResponse()
  await handleApiRequest(fakeRequest(), stateResponse, {
    ctx: ctxMock(),
    store: apiStore(),
    bridge: bridgeMock,
  })
  assert.equal(stateResponse.status, 200)
  assert.equal(parseBody(stateResponse).ok, true)

  const body = JSON.stringify({ revision: 99, patch: { permissions: { listModels: true } } })
  const conflict = fakeResponse()
  await handleApiRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/api/settings',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    }),
    conflict,
    { ctx: ctxMock(), store: apiStore({ conflict: true }), bridge: bridgeMock },
  )
  assert.equal(conflict.status, 409)
  assert.equal(parseBody(conflict).error.code, 'revision-conflict')
})

test('approval endpoints list and decide pending requests', async () => {
  const pending = [
    {
      id: 'approval-1',
      capability: 'listSessions',
      tool: 'list_sessions',
      sessionId: null,
      summary: '{}',
      createdAt: 1,
      expiresAt: 2,
    },
  ]
  const approvals = {
    list: () => pending,
    pendingCount: () => pending.length,
    decide(id, decision) {
      if (id !== 'approval-1') return { ok: false, code: 'not-found', pendingCount: 0 }
      return { ok: true, pendingCount: 0 }
    },
  }
  const store = apiStore()
  const listed = fakeResponse()
  await handleApiRequest(
    fakeRequest({ url: '/dsh-mcp/api/approvals' }),
    listed,
    { ctx: ctxMock(), store, bridge: bridgeMock, approvals },
  )
  assert.equal(listed.status, 200)
  assert.equal(parseBody(listed).pending.length, 1)

  const decided = fakeResponse()
  await handleApiRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/api/approvals/approval-1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }),
    decided,
    { ctx: ctxMock(), store, bridge: bridgeMock, approvals },
  )
  assert.equal(decided.status, 200)
  assert.equal(parseBody(decided).ok, true)

  const missing = fakeResponse()
  await handleApiRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/api/approvals/missing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    }),
    missing,
    { ctx: ctxMock(), store, bridge: bridgeMock, approvals },
  )
  assert.equal(missing.status, 404)
})

test('MCP endpoint rejects missing tokens and disabled serving', async () => {
  const settings = {
    server: {
      enabled: true,
      token: 'dshmcp_0123456789abcdef',
      allowNonLoopback: false,
    },
  }
  const store = { current: () => settings }
  const mcp = { handler: { fetch: async () => new Response('{}') } }

  const unauthenticated = fakeResponse()
  await handleMcpRequest(fakeRequest({ method: 'POST', url: '/dsh-mcp/mcp' }), unauthenticated, {
    ctx: ctxMock(),
    store,
    mcp,
  })
  assert.equal(unauthenticated.status, 401)

  const unauthorized = fakeResponse()
  await handleMcpRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/mcp',
      headers: { authorization: 'Bearer wrong' },
    }),
    unauthorized,
    { ctx: ctxMock(), store, mcp },
  )
  assert.equal(unauthorized.status, 401)

  settings.server.enabled = false
  const disabled = fakeResponse()
  await handleMcpRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/mcp',
      headers: { authorization: `Bearer ${settings.server.token}` },
    }),
    disabled,
    { ctx: ctxMock(), store, mcp },
  )
  assert.equal(disabled.status, 503)
})

test('MCP endpoint rejects cross-site origins and non-loopback peers', async () => {
  const settings = {
    server: {
      enabled: true,
      token: 'dshmcp_0123456789abcdef',
      allowNonLoopback: false,
    },
  }
  const store = { current: () => settings }
  const mcp = { handler: { fetch: async () => new Response('{}') } }
  const crossSite = fakeResponse()
  await handleMcpRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/mcp',
      headers: { authorization: `Bearer ${settings.server.token}`, origin: 'https://evil.example' },
    }),
    crossSite,
    { ctx: ctxMock(), store, mcp },
  )
  assert.equal(crossSite.status, 403)

  const remote = fakeResponse()
  await handleMcpRequest(
    fakeRequest({
      method: 'POST',
      url: '/dsh-mcp/mcp',
      remote: '10.0.0.2',
      headers: { authorization: `Bearer ${settings.server.token}` },
    }),
    remote,
    { ctx: ctxMock(), store, mcp },
  )
  assert.equal(remote.status, 403)
})
