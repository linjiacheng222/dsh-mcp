/**
 * Short-lived real system-prompt smoke test.
 *
 * Creates one local approval request with a 1.2s timeout and the real Windows
 * notifier. The prompt appears briefly and is killed when the timeout settles;
 * no MCP client and no settings change are involved.
 */

import { ApprovalQueue } from '../lib/approvals.js'
import { SystemApprovalNotifier } from '../lib/system-notify.js'

const apiBase = (process.env.DSH_WEB_URL || 'http://127.0.0.1:59899').replace(/\/+$/, '') + '/dsh-mcp/api'
const notifier = new SystemApprovalNotifier({
  apiBase,
  platform: process.platform,
  enabled: () => true,
})

const approvals = new ApprovalQueue({
  logger: { info: (line) => console.log(line), warn: (line) => console.warn(line) },
  defaultTimeoutMs: 1200,
  onRequest: (entry) => notifier.notify(entry),
  onSettle: (result) => notifier.cancel(result.id),
})

try {
  const result = await approvals.request({
    capability: 'systemSmoke',
    tool: 'system_popup_smoke',
    args: { test: true },
    summary: '{"test":true}',
  })
  console.log('result:', JSON.stringify(result))
  if (result.decision !== 'timeout') {
    console.error('unexpected decision (expected timeout)')
    process.exitCode = 1
  } else {
    console.log('system popup smoke: PASS')
  }
} finally {
  approvals.close()
  notifier.close()
}
