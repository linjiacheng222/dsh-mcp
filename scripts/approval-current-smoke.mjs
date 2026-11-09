/**
 * Approval smoke against the current live settings (no privileged settings
 * patch). Uses the default only-checked mode: every call is approved or denied
 * through the management API, and the Windows system prompt is closed by the
 * queue settle hook.
 *
 * Run: node scripts/approval-current-smoke.mjs
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const base = (process.env.DSH_WEB_URL || 'http://127.0.0.1:59899').replace(/\/+$/, '')

async function api(method, route, body) {
  const response = await fetch(`${base}/dsh-mcp/api${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-dsh-mcp-ui': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route} failed ${response.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

function textOf(result) {
  const blocks = Array.isArray(result?.content) ? result.content : []
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function waitForPending(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const listed = await api('GET', '/approvals')
    if (listed.pending.length > 0) return listed.pending[0]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('approval request did not appear')
}

async function main() {
  const state = await api('GET', '/state')
  if (state.settings.approvalMode !== 'only-checked') {
    throw new Error(`expected only-checked, got ${state.settings.approvalMode}`)
  }
  const client = new Client({ name: 'dsh-approval-current-smoke', version: '0.3.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/dsh-mcp/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${state.settings.server.token}` } },
  })
  await client.connect(transport)
  try {
    const allowedCall = client.callTool({ name: 'list_sessions', arguments: { limit: 5 } })
    const first = await waitForPending()
    console.log('pending:', JSON.stringify(first).slice(0, 300))
    await api('POST', `/approvals/${first.id}`, { decision: 'allow' })
    const allowed = textOf(await allowedCall)
    console.log('allowed:', JSON.stringify(allowed).slice(0, 300))
    if (allowed?.ok === false) throw new Error('allowed call failed')

    const deniedCall = client.callTool({ name: 'read_session', arguments: { sessionId: first.sessionId ?? state.catalog.sessions[0]?.sessionId ?? 'missing' } })
    const second = await waitForPending()
    await api('POST', `/approvals/${second.id}`, { decision: 'deny' })
    const denied = textOf(await deniedCall)
    console.log('denied:', JSON.stringify(denied).slice(0, 300))
    if (denied?.ok !== false) throw new Error('denied call unexpectedly succeeded')
    console.log('approval-current smoke: PASS')
  } finally {
    await client.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error('APPROVAL SMOKE FAILED:', error)
  process.exitCode = 1
})
