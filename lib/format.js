/**
 * Session event projection for MCP clients.
 *
 * DSH session events are rich durable records. MCP callers get either a
 * compact transcript (user / assistant / tool messages) or a bounded, redacted
 * view of the current surface events. Internal request headers, system
 * prompts, raw base64 images and unbounded provider metadata never leave the
 * process.
 */

import { GatewayError } from './errors.js'

const SURFACE_EVENT_TYPES = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'developer/message',
])

const EVENT_VIEW_TYPES = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'turn/start',
  'turn/end',
  'session/title',
  'compaction/start',
  'compaction/end',
])

const MAX_STRING = 4000
const MAX_DEPTH = 10
const MAX_ARRAY = 200
const MAX_KEYS = 100

function isoTime(time) {
  if (typeof time === 'number' && Number.isFinite(time)) {
    try {
      return new Date(time).toISOString()
    } catch {
      return String(time)
    }
  }
  return typeof time === 'string' ? time : null
}

function truncate(text, max = MAX_STRING) {
  if (typeof text !== 'string') return text
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…[truncated ${text.length - max + 1} chars]`
}

function sanitizeValue(value, depth = 0, budget = { keys: 0 }) {
  if (depth > MAX_DEPTH) return '[depth limit]'
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return null
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((entry) => sanitizeValue(entry, depth + 1, budget))
  }
  if (typeof value === 'object') {
    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      if (budget.keys >= MAX_KEYS) {
        result._truncated = true
        break
      }
      budget.keys += 1
      if (key === 'attachment' && entry && typeof entry === 'object') {
        result[key] = {
          attachmentId: typeof entry.attachmentId === 'string' ? truncate(entry.attachmentId, 120) : undefined,
          name: typeof entry.name === 'string' ? truncate(entry.name, 120) : undefined,
          mediaType: typeof entry.mediaType === 'string' ? entry.mediaType : undefined,
          width: typeof entry.width === 'number' ? entry.width : undefined,
          height: typeof entry.height === 'number' ? entry.height : undefined,
        }
        continue
      }
      result[key] = sanitizeValue(entry, depth + 1, budget)
    }
    return result
  }
  return null
}

function blockText(block, options) {
  if (block === null || typeof block !== 'object') return ''
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : ''
    case 'reasoning':
      return options.includeThoughts && typeof block.text === 'string'
        ? `[thinking] ${block.text}`
        : ''
    case 'tool-call':
      return ''
    case 'image':
      return '[image]'
    case 'file':
      return block.attachment?.name ? `[file: ${block.attachment.name}]` : '[file]'
    default:
      return `[${String(block.type)}]`
  }
}

function contentView(content, options) {
  const parts = []
  const toolCalls = []
  if (!Array.isArray(content)) return { text: '', toolCalls }
  for (const block of content) {
    if (block?.type === 'tool-call') {
      const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {})
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : null,
        name: typeof block.name === 'string' ? block.name : '',
        arguments: truncate(args, 2000),
      })
      continue
    }
    const text = blockText(block, options)
    if (text.length > 0) parts.push(text)
  }
  return { text: parts.join('\n'), toolCalls }
}

function sourceKind(source) {
  if (!source || typeof source !== 'object') return null
  if (typeof source.kind !== 'string') return null
  return source.kind
}

/**
 * Convert one current-surface session event into a transcript entry.
 * @param {object} event DSH session event.
 * @param {{includeThoughts?: boolean}} [options]
 * @returns {object | null}
 */
export function transcriptEntry(event, options = {}) {
  if (!EVENT_VIEW_TYPES.has(event?.type) || !SURFACE_EVENT_TYPES.has(event.type)) return null
  const base = { seq: event.seq, time: isoTime(event.time) }
  if (event.type === 'user/message') {
    const message = event.data
    const view = contentView(message?.content, options)
    return {
      ...base,
      role: 'user',
      source: sourceKind(message?.source),
      text: view.text,
      ...(message?.source?.rpcId ? { requestId: message.source.rpcId } : {}),
    }
  }
  if (event.type === 'developer/message') {
    const message = event.data?.message
    const view = contentView(message?.content, options)
    return { ...base, role: 'developer', text: view.text }
  }
  if (event.type === 'assistant/message') {
    const message = event.data?.message
    const view = contentView(message?.content, options)
    return {
      ...base,
      role: 'assistant',
      text: view.text,
      ...(view.toolCalls.length > 0 ? { toolCalls: view.toolCalls } : {}),
    }
  }
  if (event.type === 'tool/result') {
    const message = event.data?.message
    const view = contentView(message?.content, options)
    return {
      ...base,
      role: 'tool',
      text: view.text,
      ...(message?.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message?.isError === true ? { isError: true } : {}),
    }
  }
  return null
}

function lastSeqOf(events, fallback = -1) {
  let last = fallback
  for (const event of events) {
    if (Number.isSafeInteger(event?.seq) && event.seq > last) last = event.seq
  }
  return last
}

/**
 * Build a bounded transcript.
 * @param {Array<object>} events current-surface events.
 * @param {{sinceSeq?: number, limit?: number, maxChars?: number, includeThoughts?: boolean, logCursor?: number}} options
 */
export function buildTranscript(events, options = {}) {
  const limit = options.limit === undefined
    ? 100
    : (options.limit < 0 ? Number.POSITIVE_INFINITY : options.limit)
  const maxChars = options.maxChars === undefined
    ? 60000
    : (options.maxChars < 0 ? Number.POSITIVE_INFINITY : options.maxChars)
  const sinceSeq = options.sinceSeq
  const entries = []
  for (const event of events) {
    if (sinceSeq !== undefined && Number.isSafeInteger(sinceSeq) && event?.seq <= sinceSeq) continue
    const entry = transcriptEntry(event, options)
    if (entry !== null) entries.push(entry)
  }

  let selected = entries
  let omittedBefore = 0
  if (sinceSeq === undefined && entries.length > limit) {
    omittedBefore = entries.length - limit
    selected = entries.slice(-limit)
  } else if (entries.length > limit) {
    selected = entries.slice(0, limit)
  }

  const messages = []
  let used = 0
  let truncated = false
  for (const entry of selected) {
    const text = typeof entry.text === 'string' ? entry.text : ''
    const remaining = Math.max(0, maxChars - used)
    if (remaining <= 0) {
      truncated = true
      break
    }
    const clipped = text.length > remaining ? truncate(text, remaining) : text
    if (clipped.length < text.length) truncated = true
    used += clipped.length
    messages.push({ ...entry, text: clipped })
  }
  const lastSeq = lastSeqOf(events, options.logCursor ?? -1)
  return {
    messages,
    truncated: truncated || omittedBefore > 0,
    omittedBefore,
    cursor: {
      sinceSeq: sinceSeq ?? null,
      lastSeq,
      oldestSeq: messages[0]?.seq ?? null,
      newestSeq: messages.at(-1)?.seq ?? null,
      hasMoreBefore: omittedBefore > 0,
      hasMoreAfter: sinceSeq !== undefined && entries.length > selected.length,
    },
  }
}

function redactEvent(event) {
  const data = sanitizeValue(event.data ?? null)
  return {
    seq: event.seq,
    time: isoTime(event.time),
    type: event.type,
    data,
  }
}

/**
 * Build a bounded raw-event view restricted to documented surface and turn
 * boundaries. Request headers, system prompts, assistant attempts and inbox
 * bookkeeping are intentionally excluded.
 * @param {Array<object>} events raw session events.
 * @param {{sinceSeq?: number, limit?: number, maxChars?: number}} options
 */
export function buildEventsView(events, options = {}) {
  const limit = options.limit === undefined
    ? 100
    : (options.limit < 0 ? Number.POSITIVE_INFINITY : options.limit)
  const sinceSeq = options.sinceSeq
  let filtered = events.filter((event) => EVENT_VIEW_TYPES.has(event?.type))
  if (sinceSeq !== undefined && Number.isSafeInteger(sinceSeq)) {
    filtered = filtered.filter((event) => event.seq > sinceSeq)
  }
  const total = filtered.length
  if (sinceSeq === undefined && filtered.length > limit) filtered = filtered.slice(-limit)
  else if (filtered.length > limit) filtered = filtered.slice(0, limit)

  const maxChars = options.maxChars === undefined
    ? 60000
    : (options.maxChars < 0 ? Number.POSITIVE_INFINITY : options.maxChars)
  const records = []
  let used = 0
  let truncated = false
  for (const event of filtered) {
    const record = redactEvent(event)
    let serialized
    try {
      serialized = JSON.stringify(record)
    } catch {
      serialized = '{"error":"unserializable event"}'
    }
    if (used + serialized.length > maxChars) {
      truncated = true
      break
    }
    used += serialized.length
    records.push(record)
  }
  return {
    events: records,
    truncated: truncated || total > records.length,
    omittedBefore: Math.max(0, total - records.length),
    cursor: {
      sinceSeq: sinceSeq ?? null,
      lastSeq: lastSeqOf(events, options.logCursor ?? -1),
      oldestSeq: records[0]?.seq ?? null,
      newestSeq: records.at(-1)?.seq ?? null,
    },
  }
}

/** Extract a compact turn-end reason from a `turn/end` event. */
export function turnEndReason(event) {
  if (event?.type !== 'turn/end') return null
  const reason = event.data?.reason
  if (reason === undefined || reason === null) return null
  if (typeof reason.kind === 'string') {
    return {
      kind: reason.kind,
      ...(typeof reason.message === 'string' ? { message: truncate(reason.message, 1000) } : {}),
    }
  }
  return sanitizeValue(reason)
}

/** Normalize a session header into the MCP-visible session object. */
export function sessionHeaderView(header) {
  if (!header || typeof header !== 'object') {
    throw new GatewayError('internal', 'session header is unavailable')
  }
  return {
    sessionId: header.id,
    cwd: header.cwd ?? null,
    createdAt: isoTime(header.createdAt),
    origin: header.origin ?? null,
    parentSessionId: header.parentSession ?? null,
    agentPreset: header.agentPreset ?? null,
  }
}
