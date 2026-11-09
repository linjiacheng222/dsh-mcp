/**
 * Live scope smoke: verifies the four scope modes against the running gateway.
 *
 * Usage: node scripts/scope-smoke.mjs
 * Temporarily sets open approval mode, exercises session scope except/none,
 * and restores the original settings in a finally block.
 */

import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const base = (process.env.DSH_WEB_URL || 'http://127.0.0.1:59899').replace(/\/+$/, '')

async function api(method, route, body) {
  const response = await fetch(`${base}/dsh-mcp/api${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-dsh-mcp-ui': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route} failed ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

function textOf(result) {
  const blocks = Array.isArray(result?.content) ? result.content : []
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function connect(token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/dsh-mcp/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'dsh-scope-smoke', version: '0.2.0' })
  await client.connect(transport)
  return client
}

function snapshot(settings) {
  return {
    approvalMode: settings.approvalMode,
    capabilities: settings.capabilities,
    scope: settings.scope,
    limits: settings.limits,
  }
}

async function restore(before) {
  const latest = await api('GET', '/state')
  await api('POST', '/settings', { revision: latest.revision, patch: snapshot(before) })
}

async function main() {
  const original = await api('GET', '/state')
  const before = JSON.parse(JSON.stringify(original.settings))
  const sessions = original.catalog.sessions
  if (!Array.isArray(sessions) || sessions.length === 0) throw new Error('no sessions to test')
  const excluded = sessions[0].sessionId
  const allowed = sessions[1]?.sessionId ?? null

  try {
    let state = await api('POST', '/settings', {
      revision: original.revision,
      patch: {
        approvalMode: 'open',
        scope: { ...before.scope, sessionMode: 'except', sessionIds: [excluded], modelMode: 'all' },
      },
    })
    let client = await connect(state.settings.server.token)
    try {
      const listed = textOf(await client.callTool({ name: 'list_sessions', arguments: { limit: 20 } }))
      const ids = listed.sessions.map((row) => row.sessionId)
      console.log('except listed count:', ids.length, 'excluded present:', ids.includes(excluded))
      if (ids.includes(excluded)) throw new Error('excluded session still listed')
      if (allowed !== null && !ids.includes(allowed)) throw new Error('allowed session missing from list')
      const denied = textOf(await client.callTool({
        name: 'read_session',
        arguments: { sessionId: excluded, limit: 1 },
      }))
      console.log('except read excluded:', JSON.stringify(denied).slice(0, 300))
      if (denied?.ok !== false) throw new Error('excluded session was readable')
    } finally {
      await client.close().catch(() => {})
    }

    state = await api('POST', '/settings', {
      revision: (await api('GET', '/state')).revision,
      patch: { scope: { ...before.scope, sessionMode: 'none', sessionIds: [], modelMode: 'all' } },
    })
    client = await connect(state.settings.server.token)
    try {
      const listed = textOf(await client.callTool({ name: 'list_sessions', arguments: { limit: 20 } }))
      console.log('none listed count:', listed.sessions?.length ?? -1)
      if ((listed.sessions?.length ?? -1) !== 0) throw new Error('none mode still listed sessions')
      const denied = textOf(await client.callTool({
        name: 'read_session',
        arguments: { sessionId: excluded, limit: 1 },
      }))
      console.log('none read:', JSON.stringify(denied).slice(0, 300))
      if (denied?.ok !== false) throw new Error('none mode was readable')
    } finally {
      await client.close().catch(() => {})
    }
    console.log('scope smoke: PASS')
  } finally {
    await restore(before)
  }
}

main().catch((error) => {
  console.error('SCOPE SMOKE FAILED:', error)
  process.exitCode = 1
})
