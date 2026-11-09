/**
 * MCP protocol surface.
 *
 * One `createMcpHandler` serves both the modern (2026-07-28 envelope) and
 * legacy (2025 stateless) MCP revisions. Each HTTP request constructs a fresh
 * `McpServer` from the current settings, so capability/approval changes become
 * visible immediately without restarting the harness.
 */

import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { MCP_SERVER_NAME } from './defaults.js'
import { GatewayError, publicError } from './errors.js'
import {
  APPROVAL_MODES,
  evaluateToolAccess,
  isToolVisible,
  visibleToolNames,
} from './capabilities.js'
import { summarizeCall } from './approvals.js'

const sessionIdSchema = z.string().min(1).max(256)
const timeoutSchema = z.number().int().min(0).max(600000).optional()
const modelSchema = z.string().min(1).max(300).optional()
const reasoningSchema = z.string().min(1).max(120).optional()

const TOOLS = [
  {
    name: 'list_sessions',
    title: 'List DSH sessions',
    description:
      'List existing DeepSeek Harness sessions visible to this MCP gateway. Returns session ids, titles, working directories, models, permission presets and running state. Use the returned sessionId with read_session, ask_dsh or send_message. Subagent sessions are excluded unless the user enabled them.',
    inputSchema: z.object({
      cwd: z.string().max(4096).optional().describe('Only include sessions whose cwd exactly matches this absolute path.'),
      query: z.string().max(200).optional().describe('Case-insensitive literal filter over session id, title and cwd.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum rows to return (default 50).'),
      includeBlank: z.boolean().optional().describe('Include sessions that have not started a turn (default true).'),
    }),
    handle: (bridge, args) => bridge.listSessions(args),
  },
  {
    name: 'read_session',
    title: 'Read one DSH session',
    description:
      'Read a bounded transcript or raw surface-event page from an existing session. Transcripts contain user, assistant and tool messages; image/file payloads are replaced by placeholders. Internal system prompts, request headers and assistant attempt logs are never returned. Use sinceSeq for incremental reads and cursor.lastSeq for the next call.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      view: z.enum(['transcript', 'events']).optional().describe('transcript (default) or a redacted surface-event view.'),
      sinceSeq: z.number().int().min(0).optional().describe('Only return records with seq greater than this value.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum messages/events to return.'),
      includeThoughts: z.boolean().optional().describe('Include assistant reasoning blocks in transcripts (default false).'),
    }),
    handle: (bridge, args) => bridge.readSession(args),
  },
  {
    name: 'send_message',
    title: 'Send a message to a DSH session',
    description:
      'Send a user message into an existing session. followup (default) queues a new turn; steer inserts input into the running turn. By default the call waits for the turn and returns the new transcript records. For a single call that returns just the model reply, use ask_dsh.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      message: z.string().min(1).max(1000000).describe('Message text.'),
      delivery: z.enum(['followup', 'steer']).optional().describe('followup (default) or steer.'),
      model: modelSchema.describe('Optional provider/model switch for the next turn.'),
      reasoningEffort: reasoningSchema.describe('Optional reasoning effort for model; requires model.'),
      wait: z.boolean().optional().describe('Wait for the turn to finish (default true).'),
      timeoutMs: timeoutSchema.describe('Wait timeout in milliseconds; clamped by the gateway setting.'),
    }),
    handle: (bridge, args) => {
      if (args.reasoningEffort !== undefined && args.model === undefined) {
        throw new GatewayError('invalid-argument', 'reasoningEffort requires model', {
          field: 'reasoningEffort',
        })
      }
      return bridge.sendMessage(args)
    },
  },
  {
    name: 'wait_for_completion',
    title: 'Wait for a DSH session',
    description:
      'Wait until the session is idle after the given cursor and return the transcript records added since sinceSeq. Returns {status, running, pendingMessages, sinceSeq, cursor, completedTurns, turnEndReason, messages, truncated}; it does NOT include a top-level reply. Use ask_dsh when you need a single reply, or read the last assistant entry in messages. Returns status queued/running/timeout when the wait budget expires; the turn is not cancelled. Call again with cursor.lastSeq to keep polling.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      sinceSeq: z.number().int().min(0).optional().describe('Last seq already seen; defaults to the current log cursor.'),
      timeoutMs: timeoutSchema.describe('Wait timeout in milliseconds; clamped by the gateway setting.'),
    }),
    handle: (bridge, args) => bridge.waitForCompletion(args),
  },
  {
    name: 'ask_dsh',
    title: 'Ask DSH and get the answer',
    description:
      'One-call interface: send a message to an existing DSH session, block until the turn finishes, and return the final assistant reply. This is the closest analogue to calling a subagent or wait_agent; do not poll or end the wait loop while it runs. Returns {sessionId, reply, status, cursor, messages}. Use list_sessions first to find a session id. The default wait budget is the configured max wait (negative/unlimited by default); if it returns status=timeout with reply=null, poll wait_for_completion with the returned cursor.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      message: z.string().min(1).max(1000000).describe('Question or task text.'),
      model: modelSchema.describe('Optional provider/model for this turn.'),
      reasoningEffort: reasoningSchema.describe('Optional reasoning effort; requires model.'),
      timeoutMs: timeoutSchema.describe('How long to wait for the answer (milliseconds).'),
    }),
    handle: (bridge, args) => {
      if (args.reasoningEffort !== undefined && args.model === undefined) {
        throw new GatewayError('invalid-argument', 'reasoningEffort requires model', {
          field: 'reasoningEffort',
        })
      }
      return bridge.askDsh(args)
    },
  },
  {
    name: 'list_models',
    title: 'List configured models',
    description:
      'List every configured provider/model visible to DSH and the model allowlist filter. Use the returned provider/model key with create_session, run_task, send_message, ask_dsh or set_model.',
    inputSchema: z.object({}),
    handle: async (bridge) => bridge.modelCatalog(),
  },
  {
    name: 'create_session',
    title: 'Create a DSH session',
    description:
      'Create a new DSH session in a workspace, optionally choosing a model and permission preset, then return its id. If cwd is omitted it uses scope.defaultCwd, the first allowed root, the first existing session cwd, or the DSH default workspace; an explicit cwd must be inside one of those roots unless open mode. Only available when the user granted the createSessions capability (or in a mode that permits approved calls).',
    inputSchema: z.object({
      cwd: z.string().max(4096).optional().describe('Absolute working directory; defaults to scope.defaultCwd, the first allowed root, the first existing session cwd, or the DSH default workspace.'),
      model: modelSchema.describe('Optional provider/model for the new session.'),
      reasoningEffort: reasoningSchema.describe('Optional reasoning effort for model.'),
      permissionPreset: z.string().max(80).optional().describe('DSH permission preset; defaults to the gateway newSessionPreset.'),
    }),
    handle: (bridge, args) => {
      if (args.reasoningEffort !== undefined && args.model === undefined) {
        throw new GatewayError('invalid-argument', 'reasoningEffort requires model', {
          field: 'reasoningEffort',
        })
      }
      return bridge.createSession(args)
    },
  },
  {
    name: 'run_task',
    title: 'Run a task in a new DSH session',
    description:
      'Create a new session, send one prompt and wait for the answer. Returns the session id, cursor and transcript records. For an existing session prefer ask_dsh.',
    inputSchema: z.object({
      prompt: z.string().min(1).max(1000000).describe('Task prompt.'),
      cwd: z.string().max(4096).optional().describe('Absolute working directory; defaults to scope.defaultCwd, the first allowed root, the first existing session cwd, or the DSH default workspace.'),
      model: modelSchema.describe('Optional provider/model for the new session.'),
      reasoningEffort: reasoningSchema.describe('Optional reasoning effort for model.'),
      permissionPreset: z.string().max(80).optional().describe('DSH permission preset; defaults to the gateway newSessionPreset.'),
      timeoutMs: timeoutSchema.describe('Wait timeout in milliseconds.'),
    }),
    handle: (bridge, args) => {
      if (args.reasoningEffort !== undefined && args.model === undefined) {
        throw new GatewayError('invalid-argument', 'reasoningEffort requires model', {
          field: 'reasoningEffort',
        })
      }
      return bridge.runTask(args)
    },
  },
  {
    name: 'set_model',
    title: 'Switch a session model',
    description:
      'Select the provider/model used by the session for its next request. The DSH user default model is not changed. Uses the host selectModel API; on DSH builds that expose no out-of-GUI selection seam the call returns an unsupported error.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      model: z.string().min(1).max(300),
      reasoningEffort: reasoningSchema,
    }),
    handle: (bridge, args) => bridge.applyModel(args.sessionId, args.model, args.reasoningEffort),
  },
  {
    name: 'set_permission',
    title: 'Switch a session permission preset',
    description:
      'Switch an existing session to a configured DSH permission preset. The preset controls sandbox mode and approval policy for later turns. danger-full-access requires open approval mode.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      preset: z.string().min(1).max(80),
    }),
    handle: (bridge, args) => bridge.setPermission(args.sessionId, args.preset),
  },
  {
    name: 'cancel_turn',
    title: 'Cancel a running turn',
    description: 'Cancel the active turn of a live session while keeping pending inbox work, equivalent to the GUI stop control for the running turn. It does not remove queued follow-up messages, and an already-completed turn is a no-op.',
    inputSchema: z.object({ sessionId: sessionIdSchema }),
    handle: (bridge, args) => bridge.cancelTurn(args.sessionId),
  },
  {
    name: 'fork_session',
    title: 'Fork a session',
    description: 'Fork a cold-readable exact event prefix into a new session. Omit atSeq for the latest completed turn.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      atSeq: z.number().int().min(0).optional(),
    }),
    handle: (bridge, args) => bridge.forkSession(args.sessionId, args.atSeq),
  },
  {
    name: 'rename_session',
    title: 'Rename a session',
    description: 'Rename a session title.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      title: z.string().min(1).max(200),
    }),
    handle: (bridge, args) => bridge.renameSession(args.sessionId, args.title),
  },
  {
    name: 'settings_describe',
    title: 'Describe DSH settings',
    description:
      'Read live DSH plugin settings namespaces. Secret values are redacted. Use the returned ns/revision with settings_update. A namespace is a DSH configurable plugin/namespace id; omit namespace to list all.',
    inputSchema: z.object({
      namespace: z.string().max(200).optional().describe('Optional profile entry id to describe.'),
    }),
    handle: (bridge, args, signal) => bridge.settingsDescribe(args.namespace, signal),
  },
  {
    name: 'settings_update',
    title: 'Update DSH settings',
    description:
      'Merge a patch into one live DSH settings namespace. The namespace is the plugin/config namespace id returned by settings_describe, not necessarily a plugin package name. Only volatile fields are writable. Pass the revision from settings_describe to detect concurrent edits.',
    inputSchema: z.object({
      namespace: z.string().min(1).max(200),
      patch: z.any().describe('JSON object merged into the namespace value.'),
      expectedRevision: z.number().int().min(0).optional(),
    }),
    handle: (bridge, args, signal) => bridge.settingsUpdate(args, signal),
  },
  {
    name: 'plugins_list',
    title: 'List DSH plugins',
    description: 'List installed plugin entries and profile bundles with enabled/installed state.',
    inputSchema: z.object({}),
    handle: (bridge) => bridge.pluginsList(),
  },
  {
    name: 'plugin_set_enabled',
    title: 'Enable or disable a plugin entry',
    description: 'Enable or disable one loader plugin entry by entryId from plugins_list.',
    inputSchema: z.object({
      entryId: z.string().min(1).max(300),
      enabled: z.boolean(),
    }),
    handle: (bridge, args) => bridge.pluginSetEnabled(args),
  },
  {
    name: 'bundle_set_enabled',
    title: 'Select or deselect a plugin bundle',
    description: 'Enable or disable a profile bundle layer by package name.',
    inputSchema: z.object({
      name: z.string().min(1).max(300),
      enabled: z.boolean(),
    }),
    handle: (bridge, args) => bridge.bundleSetEnabled(args),
  },
  {
    name: 'plugin_install',
    title: 'Install a DSH plugin',
    description:
      'Install a plugin package spec through the DSH plugin manager (pnpm), optionally activating its bundle. This runs package-manager code and may require build-script approval; use plugins_list instead when you only need to inspect.',
    inputSchema: z.object({
      spec: z.string().min(1).max(2000),
      enabled: z.boolean().optional(),
    }),
    handle: (bridge, args) => bridge.pluginInstall(args),
  },
  {
    name: 'plugin_remove',
    title: 'Remove a DSH plugin bundle',
    description: 'Remove an installed plugin bundle selected in the profile.',
    inputSchema: z.object({
      name: z.string().min(1).max(300),
    }),
    handle: (bridge, args) => bridge.pluginRemove(args),
  },
  {
    name: 'credentials_describe',
    title: 'Describe credential references',
    description:
      'Report configured/writable/source state for credential references such as "env:DEEPSEEK_API_KEY". Never returns secret values.',
    inputSchema: z.object({
      refs: z.array(z.string().min(1).max(300)).min(1).max(64),
    }),
    handle: (bridge, args) => bridge.credentialsDescribe(args),
  },
  {
    name: 'credential_set',
    title: 'Set a credential value',
    description:
      'Store or replace one credential reference value. The value is secret and is never echoed or logged by the gateway.',
    inputSchema: z.object({
      ref: z.string().min(1).max(300),
      value: z.string().min(1).max(20000),
    }),
    handle: (bridge, args) => bridge.credentialSet(args),
  },
  {
    name: 'credential_unset',
    title: 'Remove a credential value',
    description: 'Remove one credential reference from the managed store.',
    inputSchema: z.object({
      ref: z.string().min(1).max(300),
    }),
    handle: (bridge, args) => bridge.credentialUnset(args),
  },
]

function instructions(settings) {
  const extra =
    typeof settings.server.instructions === 'string' && settings.server.instructions.trim().length > 0
      ? `\n\nUser instructions:\n${settings.server.instructions.trim()}`
      : ''
  const tools = visibleToolNames(settings)
  const mode = APPROVAL_MODES.find((entry) => entry.value === settings.approvalMode)
  return [
    'This MCP server is a gateway to a live DeepSeek Harness instance on the user machine.',
    'Session ids are opaque strings; use list_sessions to discover them. ask_dsh sends one message and blocks until the final assistant reply (use it instead of an immediate polling loop); send_message + wait_for_completion expose the full transcript and cursor for long-running work.',
    'Permissions and approvals are controlled by the DSH user. If a tool is absent or returns permission-denied, do not retry another way; ask the user to adjust DSH Settings -> Plugins -> DSH MCP Gateway (DSH 0.2.2+) or Settings -> DSH MCP Gateway (0.2.1).',
    `Approval mode: ${mode?.title ?? settings.approvalMode}. Calls that require approval wait for a Windows MessageBox decision and fail closed on timeout; the DSH page does not show the approval card.`,
    `Currently exposed tools: ${tools.length > 0 ? tools.join(', ') : '(none)'}.`,
  ].join('\n') + extra
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function toolError(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error: publicError(error) }, null, 2),
      },
    ],
  }
}

/**
 * Create the stateless MCP HTTP handler.
 * @param {{bridge: object, store: object, approvals: object, logger?: object, version?: string}} options
 */
export function createGatewayMcp({ bridge, store, approvals, logger = console, version = '0.1.0' }) {
  const factory = () => {
    const settings = store.current()
    const server = new McpServer(
      { name: MCP_SERVER_NAME, version },
      { instructions: instructions(settings) },
    )
    for (const tool of TOOLS) {
      if (!isToolVisible(settings, tool.name)) continue
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args, ctx) => {
          const started = Date.now()
          const callArgs = args ?? {}
          const signal = ctx?.http?.req?.signal
          try {
            const access = evaluateToolAccess(settings, tool.name)
            if (!access.allowed) {
              throw new GatewayError(
                'permission-denied',
                `The "${access.capability}" capability is not granted in the current approval mode`,
                { tool: tool.name, capability: access.capability, reason: access.reason },
              )
            }
            if (access.approval) {
              if (approvals === undefined || approvals === null) {
                throw new GatewayError(
                  'approval-unavailable',
                  'this MCP request needs user approval but no approval queue is mounted',
                  { tool: tool.name },
                )
              }
              const decision = await approvals.request({
                capability: access.capability,
                tool: tool.name,
                args: callArgs,
                sessionId: typeof callArgs.sessionId === 'string' ? callArgs.sessionId : undefined,
                summary: summarizeCall(tool.name, callArgs),
                timeoutMs: settings.limits.approvalTimeoutMs,
              })
              if (decision.decision !== 'allowed') {
                throw new GatewayError(
                  decision.decision === 'timeout' ? 'approval-timeout' : 'approval-denied',
                  decision.decision === 'timeout'
                    ? 'the user did not answer the approval request in time'
                    : `the user ${decision.decision} this request`,
                  { tool: tool.name, capability: access.capability, decision: decision.decision },
                )
              }
            }
            const value = await tool.handle(bridge, callArgs, signal)
            logger.info?.(
              `[dsh-mcp-gateway] tool=${tool.name} ok durationMs=${Date.now() - started}`,
            )
            return toolResult(value)
          } catch (error) {
            const publicFailure = publicError(error)
            logger.warn?.(
              `[dsh-mcp-gateway] tool=${tool.name} failed code=${publicFailure.code} durationMs=${Date.now() - started}: ${publicFailure.message}`,
            )
            return toolError(error)
          }
        },
      )
    }
    return server
  }

  const handler = createMcpHandler(factory, {
    legacy: 'stateless',
    onerror: (error) => {
      logger.warn?.(`[dsh-mcp-gateway] MCP handler error: ${String(error)}`)
    },
  })
  return {
    handler,
    close: () => handler.close(),
  }
}

/** Exported for tests: tool names and schemas without a running bridge. */
export const MCP_TOOL_DEFINITIONS = TOOLS
