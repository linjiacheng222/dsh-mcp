/**
 * Live smoke test for a running dsh-mcp-gateway (settings schema v2).
 *
 * Usage:
 *   node scripts/smoke-live.mjs
 *   node scripts/smoke-live.mjs --write --root E:\some\workspace
 *   node scripts/smoke-live.mjs --full --root E:\some\workspace
 *   node scripts/smoke-live.mjs --approval
 *
 * Every mode temporarily switches approvalMode to `open` and restores the
 * previous settings in a finally block. `--approval` switches to the default
 * `only-checked` mode, waits for the approval card, allows it, and verifies the
 * tool call succeeds.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const args = process.argv.slice(2)
const writeMode = args.includes('--write') || args.includes('--full')
const fullMode = args.includes('--full')
const approvalModeTest = args.includes('--approval')
const rootIndex = args.indexOf('--root')
const requestedRoot = rootIndex >= 0 ? args[rootIndex + 1] : path.resolve(import.meta.dirname, '..')

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function baseUrl() {
  return (process.env.DSH_WEB_URL || 'http://127.0.0.1:59899').replace(/\/+$/, '')
}

async function api(method, route, body) {
  const response = await fetch(`${baseUrl()}/dsh-mcp/api${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-dsh-mcp-ui': '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route} failed ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

async function connect(token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/dsh-mcp/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'dsh-mcp-gateway-smoke', version: '0.2.0' })
  await client.connect(transport)
  return client
}

function textOf(result) {
  const blocks = Array.isArray(result?.content) ? result.content : []
  const text = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function call(client, name, args = {}) {
  return textOf(await client.callTool({ name, arguments: args }))
}

function snapshotPatch(state) {
  const settings = state.settings
  return {
    approvalMode: settings.approvalMode,
    capabilities: settings.capabilities,
    scope: settings.scope,
    limits: settings.limits,
  }
}

async function setOpenMode(state) {
  const next = await api('POST', '/settings', {
    revision: state.revision,
    patch: {
      approvalMode: 'open',
      scope: {
        ...state.settings.scope,
        allowedRoots: [requestedRoot],
        defaultCwd: requestedRoot,
      },
    },
  })
  return next
}

async function restore(state) {
  try {
    const latest = await api('GET', '/state')
    await api('POST', '/settings', {
      revision: latest.revision,
      patch: snapshotPatch(state),
    })
  } catch (error) {
    console.error('restore failed:', error.message)
  }
}

async function approvalFlow(original) {
  const state = await api('POST', '/settings', {
    revision: original.revision,
    patch: { approvalMode: 'only-checked' },
  })
  const client = await connect(state.settings.server.token)
  try {
    const pendingCall = client.callTool({ name: 'list_sessions', arguments: { limit: 5 } })
    let approval
    for (let index = 0; index < 60; index += 1) {
      const listed = await api('GET', '/approvals')
      if (listed.pending.length > 0) {
        approval = listed.pending[0]
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (approval === undefined) throw new Error('approval request did not appear within 15s')
    console.log('approval pending:', JSON.stringify(approval).slice(0, 500))
    await api('POST', `/approvals/${approval.id}`, { decision: 'allow' })
    const result = await pendingCall
    console.log('approval allowed result:', JSON.stringify(textOf(result)).slice(0, 400))

    const deniedCall = client.callTool({ name: 'read_session', arguments: { sessionId: approval.sessionId ?? 'missing' } })
    let second
    for (let index = 0; index < 60; index += 1) {
      const listed = await api('GET', '/approvals')
      if (listed.pending.length > 0) {
        second = listed.pending[0]
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (second !== undefined) {
      await api('POST', `/approvals/${second.id}`, { decision: 'deny' })
      const denied = await deniedCall
      console.log('approval denied result:', JSON.stringify(textOf(denied)).slice(0, 400))
    }
  } finally {
    await client.close().catch(() => {})
    await restore(original)
  }
}

async function main() {
  const original = await api('GET', '/state')
  const before = JSON.parse(JSON.stringify(original))
  try {
    if (approvalModeTest) {
      await approvalFlow(before)
      console.log('approval flow: done')
      return
    }
    const openState = await setOpenMode(original)
    const client = await connect(openState.settings.server.token)
    try {
      const tools = await client.listTools()
      const names = tools.tools.map((tool) => tool.name).sort()
      console.log('tools:', names.join(', '))

      const listed = await call(client, 'list_sessions', { limit: 10 })
      console.log('sessions:', JSON.stringify(listed).slice(0, 500))
      const first = Array.isArray(listed.sessions) ? listed.sessions[0] : undefined
      if (first !== undefined) {
        const read = await call(client, 'read_session', { sessionId: first.sessionId, limit: 5 })
        console.log('read_session:', JSON.stringify(read).slice(0, 700))
      }

      if (args.includes('--advanced')) {
        const described = await call(client, 'settings_describe', {})
        console.log('settings_describe:', JSON.stringify({
          namespaces: Array.isArray(described.namespaces) ? described.namespaces.length : 0,
        }))
        const plugins = await call(client, 'plugins_list', {})
        console.log('plugins_list:', JSON.stringify({
          plugins: Array.isArray(plugins.plugins) ? plugins.plugins.length : 0,
          bundles: Array.isArray(plugins.bundles) ? plugins.bundles.length : 0,
        }))
        const creds = await call(client, 'credentials_describe', {
          refs: ['env:DEEPSEEK_API_KEY'],
        })
        console.log('credentials_describe:', JSON.stringify(creds).slice(0, 300))
      }

      if (writeMode) {
        const root = requestedRoot
        const created = await call(client, 'create_session', {
          cwd: root,
          model: 'deepseek-account/deepseek-flash',
          permissionPreset: fullMode ? 'danger-full-access' : 'workspace-write',
        })
        console.log('create_session:', JSON.stringify(created).slice(0, 500))
        if (created?.ok !== false && typeof created?.sessionId === 'string') {
          console.log('set_permission:', JSON.stringify(await call(client, 'set_permission', {
            sessionId: created.sessionId,
            preset: fullMode ? 'danger-full-access' : 'workspace-write',
          })).slice(0, 300))
          console.log('set_model:', JSON.stringify(await call(client, 'set_model', {
            sessionId: created.sessionId,
            model: 'deepseek-account/deepseek-flash',
            reasoningEffort: 'low',
          })).slice(0, 300))
          const asked = await call(client, 'ask_dsh', {
            sessionId: created.sessionId,
            message: 'Reply with exactly: OK',
            timeoutMs: 60000,
          })
          console.log('ask_dsh:', JSON.stringify(asked).slice(0, 1200))
          console.log('wait_for_completion:', JSON.stringify(await call(client, 'wait_for_completion', {
            sessionId: created.sessionId,
            sinceSeq: asked?.cursor?.lastSeq ?? 0,
            timeoutMs: 1000,
          })).slice(0, 400))
          if (fullMode) {
            const task = await call(client, 'run_task', {
              prompt: 'Reply with exactly: OK',
              cwd: root,
              model: 'deepseek-account/deepseek-flash',
              permissionPreset: 'danger-full-access',
              timeoutMs: 60000,
            })
            console.log('run_task:', JSON.stringify(task).slice(0, 1200))
          }
        }
      }
    } finally {
      await client.close().catch(() => {})
    }
  } finally {
    if (!approvalModeTest) await restore(before)
  }
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error)
  process.exitCode = 1
})
