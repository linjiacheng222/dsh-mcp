/**
 * Scope, cwd, model, preset and limit policy for the MCP gateway.
 *
 * Capability/approval policy lives in `capabilities.js`; this module keeps the
 * resource boundaries that do not depend on the approval mode.
 */

import path from 'node:path'
import { isUnlimited } from './defaults.js'
import { GatewayError } from './errors.js'

const CASE_INSENSITIVE_PATHS = process.platform === 'win32'

/** Validate a session id supplied by an MCP client. */
export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || sessionId.length > 256) {
    throw new GatewayError('invalid-argument', 'sessionId must be a non-empty string', {
      field: 'sessionId',
    })
  }
  return sessionId
}

/**
 * Enforce the configured session scope for a session header or list summary.
 */
export function assertSessionAllowed(settings, header) {
  const id = typeof header?.id === 'string' ? header.id : header?.sessionId
  assertSessionId(id)
  const isChild =
    header?.origin === 'subagent' ||
    (typeof header?.parentSession === 'string' && header.parentSession.length > 0) ||
    (typeof header?.parentSessionId === 'string' && header.parentSessionId.length > 0)
  if (isChild && settings.scope.includeSubagents !== true) {
    throw new GatewayError(
      'session-scope-denied',
      `Session "${id}" is a subagent session and subagent access is disabled`,
      { sessionId: id, reason: 'subagent' },
    )
  }
  const mode = settings.scope.sessionMode
  if (mode === 'none') {
    throw new GatewayError('session-scope-denied', 'session access is disabled by the session scope', {
      sessionId: id,
      reason: 'session-scope-none',
    })
  }
  if (mode === 'allowlist' && !settings.scope.sessionIds.includes(id)) {
    throw new GatewayError(
      'session-scope-denied',
      `Session "${id}" is not in the configured session allowlist`,
      { sessionId: id, reason: 'allowlist' },
    )
  }
  if (mode === 'except' && settings.scope.sessionIds.includes(id)) {
    throw new GatewayError(
      'session-scope-denied',
      `Session "${id}" is excluded by the configured session scope`,
      { sessionId: id, reason: 'except-list' },
    )
  }
  return id
}

/** Whether a session passes the non-throwing scope predicate (list filtering). */
export function sessionInScope(settings, header) {
  try {
    assertSessionAllowed(settings, header)
    return true
  } catch {
    return false
  }
}

/** `provider/model` key used by the model allowlist and settings. */
export function selectionKey(selection) {
  if (
    selection === null ||
    selection === undefined ||
    typeof selection.provider !== 'string' ||
    typeof selection.model !== 'string'
  ) {
    return null
  }
  return `${selection.provider}/${selection.model}`
}

/** Split a `provider/model` key; model ids themselves may contain `/`. */
export function parseModelKey(key) {
  if (typeof key !== 'string') return null
  const slash = key.indexOf('/')
  if (slash <= 0 || slash === key.length - 1) return null
  return { provider: key.slice(0, slash), model: key.slice(slash + 1) }
}

/** Enforce the model allowlist for a `provider/model` key. */
export function assertModelAllowed(settings, key) {
  const parsed = parseModelKey(key)
  if (parsed === null) {
    throw new GatewayError('invalid-argument', 'model must use the "provider/model" form', {
      field: 'model',
    })
  }
  const mode = settings.scope.modelMode
  if (mode === 'none') {
    throw new GatewayError('permission-denied', 'model access is disabled by the model scope', {
      model: key,
      reason: 'model-scope-none',
    })
  }
  if (mode === 'allowlist' && !settings.scope.allowedModels.includes(key)) {
    throw new GatewayError('permission-denied', `Model "${key}" is not in the model allowlist`, {
      model: key,
      reason: 'model-allowlist',
    })
  }
  if (mode === 'except' && settings.scope.allowedModels.includes(key)) {
    throw new GatewayError('permission-denied', `Model "${key}" is excluded by the model scope`, {
      model: key,
      reason: 'model-except-list',
    })
  }
  return parsed
}

/** Enforce a permission preset choice for an existing or new session. */
export function assertPresetAllowed(settings, preset, availablePresets) {
  if (typeof preset !== 'string' || preset.length === 0) {
    throw new GatewayError('invalid-argument', 'preset must be a non-empty string', {
      field: 'preset',
    })
  }
  if (preset === 'auto') {
    throw new GatewayError('preset-unavailable', 'The "auto" preset cannot be selected by MCP', {
      preset,
    })
  }
  if (Array.isArray(availablePresets) && !availablePresets.includes(preset)) {
    throw new GatewayError(
      'preset-unavailable',
      `Preset "${preset}" is not configured in this DSH profile`,
      { preset, available: availablePresets },
    )
  }
  if (preset === 'danger-full-access' && settings.approvalMode !== 'open') {
    throw new GatewayError(
      'permission-denied',
      'The "danger-full-access" preset requires the "open" approval mode',
      { preset, reason: 'open-mode-required' },
    )
  }
  return preset
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(value)
  return CASE_INSENSITIVE_PATHS ? resolved.toLowerCase() : resolved
}

/** Whether `child` is `parent` or inside it, after path normalization. */
export function isPathInside(parent, child) {
  if (typeof parent !== 'string' || typeof child !== 'string') return false
  let rel
  try {
    rel = path.relative(normalizePathForCompare(parent), normalizePathForCompare(child))
  } catch {
    return false
  }
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Resolve and authorize the working directory for a new MCP-created session.
 * Open mode allows any absolute path; every other mode requires defaultCwd or
 * an allowed root.
 */
export function resolveCreateCwd(settings, requested, fallbackCwd, fallbackRoots = []) {
  const configuredRoots = [
    ...(settings.scope.defaultCwd ? [settings.scope.defaultCwd] : []),
    ...settings.scope.allowedRoots,
  ].filter((entry) => typeof entry === 'string' && entry.length > 0)
  const inheritedRoots = configuredRoots.length === 0
    ? (Array.isArray(fallbackRoots) ? fallbackRoots : []).filter(
        (entry) => typeof entry === 'string' && entry.length > 0,
      )
    : []
  const raw = requested ?? configuredRoots[0] ?? inheritedRoots[0] ?? fallbackCwd
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new GatewayError(
      'invalid-argument',
      'cwd is required: pass an absolute cwd or configure scope.defaultCwd',
      {
        field: 'cwd',
        ...(configuredRoots.length > 0 ? { allowedRoots: configuredRoots } : {}),
      },
    )
  }
  if (raw.includes('\0')) {
    throw new GatewayError('invalid-argument', 'cwd contains an invalid character', { field: 'cwd' })
  }
  if (!path.isAbsolute(raw)) {
    throw new GatewayError('invalid-argument', 'cwd must be an absolute path', { field: 'cwd' })
  }
  const resolved = path.resolve(raw)
  if (settings.approvalMode === 'open') return resolved
  const candidates = [...configuredRoots]
  if (candidates.length === 0) {
    candidates.push(...inheritedRoots)
    if (typeof fallbackCwd === 'string' && fallbackCwd.length > 0) candidates.push(fallbackCwd)
  }
  if (candidates.some((root) => isPathInside(root, resolved))) return resolved
  throw new GatewayError(
    'session-scope-denied',
    'cwd is outside the configured allowed roots; use an allowed root, configure defaultCwd, or switch to open mode',
    {
      cwd: resolved,
      reason: 'cwd-allowlist',
      ...(candidates.length > 0 ? { allowedRoots: [...new Set(candidates)] } : {}),
    },
  )
}

/** Validate a requested read limit against the configured maximum. */
export function readLimit(settings, requested, fallback = settings.limits.maxReadMessages) {
  if (requested === undefined && isUnlimited(fallback)) return Number.POSITIVE_INFINITY
  const value = requested ?? fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GatewayError('invalid-argument', 'limit must be a positive integer', {
      field: 'limit',
    })
  }
  if (isUnlimited(settings.limits.maxReadMessages)) return value
  return Math.min(value, settings.limits.maxReadMessages)
}

/** Validate/clamp a wait timeout; negative configured limits mean no timeout. */
export function waitTimeout(settings, requested, fallback = settings.limits.defaultWaitMs) {
  if (requested === undefined && isUnlimited(fallback)) return Number.POSITIVE_INFINITY
  const value = requested ?? fallback
  if (!Number.isFinite(value) || value < 0) {
    throw new GatewayError('invalid-argument', 'timeoutMs must be a non-negative number', {
      field: 'timeoutMs',
    })
  }
  const floor = Math.floor(value)
  if (isUnlimited(settings.limits.maxWaitMs)) return floor
  return Math.max(0, Math.min(floor, settings.limits.maxWaitMs))
}

/** Validate outgoing message size; a negative max disables the length check. */
export function assertMessageLength(settings, message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new GatewayError('invalid-argument', 'message must contain non-whitespace text', {
      field: 'message',
    })
  }
  const max = settings.limits.maxMessageChars
  if (!isUnlimited(max) && message.length > max) {
    throw new GatewayError(
      'invalid-argument',
      `message exceeds the configured limit of ${max} characters`,
      { field: 'message', max },
    )
  }
  return message
}
