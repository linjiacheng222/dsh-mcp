/**
 * Per-call approval queue for MCP requests.
 *
 * Approvals are presented by the host through the Windows MessageBox; the
 * waiting MCP handler settles on the decision or fails closed on timeout.
 */

import { randomUUID } from 'node:crypto'
import { GatewayError } from './errors.js'

const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|credential|authorization|value)$/i
const MAX_SUMMARY = 600

function redactValue(value, key = '') {
  if (key !== '' && SECRET_KEY.test(key)) return '••••••'
  if (typeof value === 'string') {
    return value.length > 240 ? `${value.slice(0, 239)}…` : value
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => redactValue(entry))
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const [childKey, child] of Object.entries(value)) {
      result[childKey] = redactValue(child, childKey)
    }
    return result
  }
  return value
}

/** Build a short, non-secret preview for the approval card. */
export function summarizeCall(toolName, args) {
  try {
    const safe = redactValue(args ?? {})
    const text = JSON.stringify(safe)
    return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text
  } catch {
    return '{}'
  }
}

export class ApprovalQueue {
  /**
   * @param {{now?: () => number, logger?: object, defaultTimeoutMs?: number,
   *          onRequest?: (entry: object) => unknown,
   *          onSettle?: (result: {id: string, decision: string, reason: string|null}) => unknown}} [options]
   */
  constructor(options = {}) {
    this.now = options.now ?? Date.now
    this.logger = options.logger ?? console
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 55000
    this.onRequest = typeof options.onRequest === 'function' ? options.onRequest : null
    this.onSettle = typeof options.onSettle === 'function' ? options.onSettle : null
    this.pending = new Map()
    this.closed = false
  }

  /** Pending requests safe for the browser management API. */
  list() {
    return [...this.pending.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((entry) => ({
        id: entry.id,
        capability: entry.capability,
        tool: entry.tool,
        sessionId: entry.sessionId ?? null,
        summary: entry.summary,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      }))
  }

  pendingCount() {
    return this.pending.size
  }

  /**
   * Ask the user to allow one tool call. Resolves `allowed`, `denied`,
   * `timeout`, or `cancelled`; never rejects.
   */
  request({ capability, tool, args, sessionId, summary, timeoutMs }) {
    if (this.closed) {
      return Promise.resolve({ decision: 'cancelled', reason: 'gateway-disposed' })
    }
    const id = randomUUID()
    const createdAt = this.now()
    const configured = Number.isFinite(timeoutMs) ? timeoutMs : this.defaultTimeoutMs
    const unlimited = !Number.isFinite(configured) || configured < 0
    const budget = unlimited ? null : Math.max(1000, Math.floor(configured))
    const entry = {
      id,
      capability,
      tool,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      summary: typeof summary === 'string' ? summary : summarizeCall(tool, args),
      createdAt,
      expiresAt: budget === null ? null : createdAt + budget,
    }
    return new Promise((resolve) => {
      const settle = (decision, reason) => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        clearTimeout(entry.timer)
        this.logger.info?.(
          `[dsh-mcp-gateway] approval ${id} tool=${tool} capability=${capability} decision=${decision}`,
        )
        if (this.onSettle !== null) {
          try {
            this.onSettle({ id, decision, reason: reason ?? null })
          } catch (error) {
            this.logger.warn?.(`[dsh-mcp-gateway] approval settle hook failed: ${String(error)}`)
          }
        }
        resolve({ decision, requestId: id, ...(reason ? { reason } : {}) })
      }
      entry.settle = settle
      if (budget !== null) {
        entry.timer = setTimeout(() => settle('timeout', 'approval-timeout'), budget)
      }
      this.pending.set(id, entry)
      this.logger.info?.(
        `[dsh-mcp-gateway] approval requested ${id} tool=${tool} capability=${capability} session=${entry.sessionId ?? '-'}`,
      )
      if (this.onRequest !== null) {
        try {
          this.onRequest({
            id: entry.id,
            capability: entry.capability,
            tool: entry.tool,
            sessionId: entry.sessionId ?? null,
            summary: entry.summary,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
          })
        } catch (error) {
          this.logger.warn?.(`[dsh-mcp-gateway] approval notifier failed: ${String(error)}`)
        }
      }
    })
  }

  /**
   * Record one user decision.
   * @returns {{ok: boolean, code?: string, pendingCount: number}}
   */
  decide(id, decision) {
    const entry = this.pending.get(id)
    if (entry === undefined) return { ok: false, code: 'not-found', pendingCount: this.pending.size }
    if (decision !== 'allow' && decision !== 'deny') {
      throw new GatewayError('invalid-argument', 'decision must be "allow" or "deny"', {
        field: 'decision',
      })
    }
    entry.settle(decision === 'allow' ? 'allowed' : 'denied')
    return { ok: true, pendingCount: this.pending.size }
  }

  /** Dispose the queue; every waiter fails closed. */
  close() {
    this.closed = true
    for (const entry of [...this.pending.values()]) entry.settle('cancelled', 'gateway-disposed')
    this.pending.clear()
  }
}
