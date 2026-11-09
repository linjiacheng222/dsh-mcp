/**
 * dsh-mcp-gateway host plugin entry.
 *
 * The plugin is a plain Cordis host plugin. It mounts no model tools of its own;
 * it registers an authenticated Streamable HTTP MCP endpoint and a same-origin
 * management API on the existing DSH webserver.
 */

import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { ApprovalQueue } from './approvals.js'
import { GatewayBridge } from './bridge.js'
import { registerGatewayRoutes } from './http.js'
import { createGatewayMcp } from './mcp.js'
import { SettingsStore, resolveSettingsPath } from './settings.js'
import { SystemApprovalNotifier } from './system-notify.js'

export const name = 'dsh-mcp-gateway'
export const inject = [
  'webServer',
  'sessionController',
  'sessionQuery',
  'agents',
  'sessions',
  'sessionProjections',
]
export const PLUGIN_VERSION = '0.3.2'

async function activationLog(message) {
  try {
    const file = path.join(path.dirname(resolveSettingsPath()), 'activation.log')
    await appendFile(file, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // diagnostics must never break activation
  }
}

export async function apply(ctx) {
  const logger = ctx.logger ?? console
  try {
    await activationLog('apply:start')
    const store = new SettingsStore({ logger })
    await store.load()
    await activationLog('apply:settings-loaded')
    let notifier
    const approvals = new ApprovalQueue({
      logger,
      onRequest: (entry) => {
        notifier?.notify(entry)
      },
      onSettle: (result) => {
        notifier?.cancel(result.id)
      },
    })
    const bridge = new GatewayBridge({ ctx, store, logger, approvals })
    const endpoint = bridge.endpointInfo()
    const origin = endpoint.origin ?? (typeof ctx.webServer?.port === 'number' ? `http://127.0.0.1:${ctx.webServer.port}` : null)
    notifier = new SystemApprovalNotifier({
      apiBase: origin === null ? null : `${origin}/dsh-mcp/api`,
      logger,
      enabled: () => store.current().server.systemApprovalPopup !== false,
    })
    const mcp = createGatewayMcp({ bridge, store, approvals, logger, version: PLUGIN_VERSION })
    await activationLog('apply:mcp-created')

    ctx.effect(
      () => {
        const disposeRoutes = registerGatewayRoutes({ ctx, store, bridge, mcp, approvals })
        void activationLog('apply:routes-registered')
        return () => {
          void activationLog('apply:routes-disposed')
          disposeRoutes()
          approvals.close()
          notifier.close()
          void mcp.close().catch((error) => {
            logger.warn?.(`[dsh-mcp-gateway] MCP handler close failed: ${String(error)}`)
          })
        }
      },
      'dsh-mcp-gateway.routes',
    )

    const snapshot = store.snapshot()
    const message =
      `[dsh-mcp-gateway] active at ${endpoint.mcpUrl ?? '(origin unavailable)'} ` +
      `(mode=${snapshot.settings.approvalMode}, tools=${bridge.toolCatalog(snapshot.settings).length}, ` +
      `firstRun=${snapshot.settings.onboarding.shownAt === null})`
    logger.info?.(message)
    await activationLog(`apply:active ${message}`)
  } catch (error) {
    await activationLog(`apply:FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    throw error
  }
}

const plugin = { name, inject, apply }
export default plugin
