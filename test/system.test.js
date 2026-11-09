import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApprovalQueue } from '../lib/approvals.js'
import { formatApprovalText, SystemApprovalNotifier } from '../lib/system-notify.js'

test('approval queue notifies a system prompt with a safe public entry', async () => {
  let seen
  const queue = new ApprovalQueue({
    defaultTimeoutMs: 1000,
    onRequest: (entry) => {
      seen = entry
    },
  })
  const waiting = queue.request({
    capability: 'listSessions',
    tool: 'list_sessions',
    args: { limit: 5 },
    sessionId: 'session-a',
  })
  assert.ok(seen)
  assert.equal(seen.tool, 'list_sessions')
  assert.equal(seen.capability, 'listSessions')
  assert.equal(seen.sessionId, 'session-a')
  assert.equal(typeof seen.id, 'string')
  assert.equal(typeof seen.expiresAt, 'number')
  assert.equal('settle' in seen, false)
  queue.decide(seen.id, 'deny')
  assert.equal((await waiting).decision, 'denied')
  queue.close()
})

test('system notifier is inert off Windows and formats readable approval text', () => {
  const text = formatApprovalText({
    tool: 'send_message',
    capability: 'sendMessages',
    sessionId: 'session-a',
    summary: '{"message":"hello"}',
    expiresAt: Date.now() + 55000,
  })
  assert.match(text, /send_message/)
  assert.match(text, /sendMessages/)
  assert.match(text, /session-a/)
  assert.match(text, /hello/)
  const unlimited = formatApprovalText({
    tool: 'send_message',
    capability: 'sendMessages',
    summary: '{}',
    expiresAt: null,
  })
  assert.match(unlimited, /无限制/)
  const notifier = new SystemApprovalNotifier({ apiBase: 'http://127.0.0.1:1/dsh-mcp/api', platform: 'linux' })
  assert.equal(notifier.notify({ id: 'approval-1' }), false)
  notifier.close()
  const disabled = new SystemApprovalNotifier({
    apiBase: 'http://127.0.0.1:1/dsh-mcp/api',
    platform: 'win32',
    enabled: () => false,
  })
  assert.equal(disabled.notify({ id: 'approval-1' }), false)
  disabled.close()
})

test('system notifier spawns the Windows prompt process', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshmcp-notify-'))
  const script = path.join(directory, 'noop.ps1')
  await writeFile(script, 'param([string]$ApprovalId,[string]$ApiUrl,[string]$Title,[string]$BodyBase64)\nexit 0\n', 'utf8')
  const warnings = []
  const notifier = new SystemApprovalNotifier({
    apiBase: 'http://127.0.0.1:1/dsh-mcp/api',
    platform: 'win32',
    scriptPath: script,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
  })
  try {
    assert.equal(notifier.notify({ id: 'approval-1', tool: 'list_sessions' }), true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assert.deepEqual(warnings, [])
  } finally {
    notifier.close()
    await rm(directory, { recursive: true, force: true })
  }
})
