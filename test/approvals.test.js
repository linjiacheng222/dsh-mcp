import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalQueue, summarizeCall } from '../lib/approvals.js'

test('redacts secret-looking keys and truncates long previews', () => {
  const summary = summarizeCall('credential_set', {
    ref: 'env:API_KEY',
    value: 'super-secret',
    nested: { password: 'hunter2', note: 'ok' },
  })
  assert.doesNotMatch(summary, /super-secret/)
  assert.doesNotMatch(summary, /hunter2/)
  assert.match(summary, /••••••/)
  assert.match(summary, /env:API_KEY/)
})

test('request resolves allowed when the user decides', async () => {
  const queue = new ApprovalQueue({ logger: {}, defaultTimeoutMs: 5000 })
  const pending = queue.request({
    capability: 'listSessions',
    tool: 'list_sessions',
    args: {},
    sessionId: 'session-a',
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(queue.pendingCount(), 1)
  const listed = queue.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].tool, 'list_sessions')
  const result = queue.decide(listed[0].id, 'allow')
  assert.equal(result.ok, true)
  assert.deepEqual(await pending, {
    decision: 'allowed',
    requestId: listed[0].id,
  })
  assert.equal(queue.pendingCount(), 0)
})

test('deny and unknown ids settle predictably', async () => {
  const queue = new ApprovalQueue({ logger: {}, defaultTimeoutMs: 5000 })
  const pending = queue.request({ capability: 'readSessions', tool: 'read_session', args: {} })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const id = queue.list()[0].id
  queue.decide(id, 'deny')
  assert.equal((await pending).decision, 'denied')
  assert.deepEqual(queue.decide('missing', 'allow'), { ok: false, code: 'not-found', pendingCount: 0 })
})

test('timeout fails closed and close cancels waiters', async () => {
  const queue = new ApprovalQueue({ logger: {}, now: () => 1, defaultTimeoutMs: 1000 })
  const pending = queue.request({ capability: 'managePlugins', tool: 'plugin_install', args: {} })
  const result = await pending
  assert.equal(result.decision, 'timeout')

  const queued = queue.request({ capability: 'managePlugins', tool: 'plugin_install', args: {} })
  queue.close()
  assert.equal((await queued).decision, 'cancelled')
  assert.equal(queue.pendingCount(), 0)
})

test('negative approval timeout disables the timer', async () => {
  const queue = new ApprovalQueue({ logger: {}, now: () => 1, defaultTimeoutMs: 1000 })
  const pending = queue.request({
    capability: 'managePlugins',
    tool: 'plugin_install',
    args: {},
    timeoutMs: -1,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const listed = queue.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].expiresAt, null)
  queue.decide(listed[0].id, 'allow')
  assert.equal((await pending).decision, 'allowed')
})
