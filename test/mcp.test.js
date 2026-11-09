import assert from 'node:assert/strict'
import test from 'node:test'
import { createGatewayMcp } from '../lib/mcp.js'
import { defaultSettings } from '../lib/defaults.js'

const ENDPOINT = 'http://127.0.0.1:61680/dsh-mcp/mcp'
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

function mockStore(settings) {
  return {
    current: () => settings,
    snapshot: () => ({ revision: 1, updatedAt: Date.now(), settings, warnings: [] }),
  }
}

function allowQueue() {
  const seen = []
  return {
    seen,
    request: async (request) => {
      seen.push(request)
      return { decision: 'allowed', requestId: 'approval-1' }
    },
    pendingCount: () => 0,
  }
}

const bridge = {
  async listSessions() {
    return { sessions: [], total: 0, hasMore: false }
  },
  async readSession() {
    return {
      session: { sessionId: 'session-a' },
      view: 'transcript',
      messages: [],
      cursor: { lastSeq: 0 },
      truncated: false,
    }
  },
  async sendMessage() {
    return { sessionId: 'session-a', accepted: true, requestId: 'r' }
  },
  async waitForCompletion() {
    return { sessionId: 'session-a', status: 'idle', messages: [] }
  },
  async askDsh() {
    return { sessionId: 'session-a', reply: 'OK', status: 'idle' }
  },
  async modelCatalog() {
    return { providers: [], default: null, defaultKey: null, failures: [] }
  },
  async createSession() {
    return { sessionId: 'session-new' }
  },
  async runTask() {
    return { sessionId: 'session-new' }
  },
  async applyModel() {
    return { provider: 'p', model: 'm' }
  },
  async setPermission() {
    return { sessionId: 'session-a', preset: 'workspace-write' }
  },
  async cancelTurn() {
    return { accepted: true }
  },
  async forkSession() {
    return { sessionId: 'session-child' }
  },
  async renameSession() {
    return { title: 't' }
  },
  async settingsDescribe() {
    return { namespaces: [] }
  },
  async settingsUpdate() {
    return { namespaces: [] }
  },
  async pluginsList() {
    return { plugins: [], bundles: [] }
  },
  async pluginSetEnabled() {
    return { ok: true }
  },
  async bundleSetEnabled() {
    return { ok: true }
  },
  async pluginInstall() {
    return { ok: true }
  },
  async pluginRemove() {
    return { ok: true }
  },
  async credentialsDescribe() {
    return { credentials: {} }
  },
  async credentialSet() {
    return { configured: true }
  },
  async credentialUnset() {
    return { configured: false }
  },
}

async function parseResponse(response) {
  const text = await response.text()
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('text/event-stream')) {
    const frames = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean)
    assert.ok(frames.length > 0, `no SSE frames: ${text.slice(0, 300)}`)
    return JSON.parse(frames.at(-1))
  }
  return JSON.parse(text)
}

async function rpc(handler, body) {
  const response = await handler.fetch(
    new Request(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }),
  )
  return { status: response.status, body: await parseResponse(response) }
}

async function initialize(handler) {
  return rpc(handler, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  })
}

async function listTools(handler) {
  const response = await rpc(handler, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  return response.body.result.tools.map((tool) => tool.name).sort()
}

test('default mode exposes the five basic tools and asks for approval', async () => {
  const settings = defaultSettings()
  const approvals = allowQueue()
  const mcp = createGatewayMcp({ bridge, store: mockStore(settings), approvals, logger: {} })
  try {
    await initialize(mcp.handler)
    assert.deepEqual(await listTools(mcp.handler), [
      'ask_dsh',
      'list_sessions',
      'read_session',
      'send_message',
      'wait_for_completion',
    ])
    const response = await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_sessions', arguments: { limit: 5 } },
    })
    assert.equal(response.body.result.isError, undefined)
    assert.equal(approvals.seen.length, 1)
    assert.equal(approvals.seen[0].capability, 'listSessions')
  } finally {
    await mcp.close()
  }
})

test('approval denial becomes an isError result and does not call the bridge', async () => {
  const settings = defaultSettings()
  const denied = {
    request: async () => ({ decision: 'denied', requestId: 'a' }),
    pendingCount: () => 0,
  }
  const mcp = createGatewayMcp({ bridge, store: mockStore(settings), approvals: denied, logger: {} })
  try {
    await initialize(mcp.handler)
    const response = await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_sessions', arguments: {} },
    })
    assert.equal(response.body.result.isError, true)
    assert.match(response.body.result.content[0].text, /approval-denied/)
  } finally {
    await mcp.close()
  }
})

test('open mode lists and runs all tools without approvals', async () => {
  const settings = defaultSettings()
  settings.approvalMode = 'open'
  const approvals = allowQueue()
  const mcp = createGatewayMcp({ bridge, store: mockStore(settings), approvals, logger: {} })
  try {
    await initialize(mcp.handler)
    const names = await listTools(mcp.handler)
    assert.equal(names.length, 23)
    assert.ok(names.includes('plugin_install'))
    assert.ok(names.includes('ask_dsh'))
    const response = await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ask_dsh', arguments: { sessionId: 'session-a', message: 'hi' } },
    })
    assert.equal(response.body.result.isError, undefined)
    assert.equal(JSON.parse(response.body.result.content[0].text).reply, 'OK')
    assert.equal(approvals.seen.length, 0)
  } finally {
    await mcp.close()
  }
})

test('except-checked lets checked tools run directly and approves unchecked ones', async () => {
  const settings = defaultSettings()
  settings.approvalMode = 'except-checked'
  const approvals = allowQueue()
  const mcp = createGatewayMcp({ bridge, store: mockStore(settings), approvals, logger: {} })
  try {
    await initialize(mcp.handler)
    assert.equal((await listTools(mcp.handler)).length, 23)
    await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_sessions', arguments: {} },
    })
    assert.equal(approvals.seen.length, 0)
    await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'create_session', arguments: { cwd: 'C:\\work' } },
    })
    assert.equal(approvals.seen.length, 1)
    assert.equal(approvals.seen[0].capability, 'createSessions')
  } finally {
    await mcp.close()
  }
})

test('MCP errors from a bridge become isError content', async () => {
  const settings = defaultSettings()
  settings.approvalMode = 'open'
  const failingBridge = {
    ...bridge,
    async listSessions() {
      const error = new Error('nope')
      error.code = 'permission-denied'
      throw error
    },
  }
  const mcp = createGatewayMcp({
    bridge: failingBridge,
    store: mockStore(settings),
    approvals: allowQueue(),
    logger: {},
  })
  try {
    await initialize(mcp.handler)
    const response = await rpc(mcp.handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_sessions', arguments: {} },
    })
    assert.equal(response.body.result.isError, true)
    assert.match(response.body.result.content[0].text, /permission-denied/)
  } finally {
    await mcp.close()
  }
})
