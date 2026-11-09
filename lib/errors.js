/**
 * Stable, transport-neutral error vocabulary shared by the MCP tools and the
 * management API.
 */

export class GatewayError extends Error {
  /**
   * @param {string} code stable machine-readable code.
   * @param {string} message human-readable message.
   * @param {Record<string, unknown>} [details] safe structured details.
   * @param {{ cause?: unknown }} [options] standard Error options.
   */
  constructor(code, message, details = {}, options = {}) {
    super(message, options)
    this.name = 'GatewayError'
    this.code = code
    this.details = details
  }
}

const HTTP_STATUS = Object.freeze({
  'invalid-argument': 400,
  'bad-request': 400,
  'revision-conflict': 409,
  'permission-denied': 403,
  'settings-write-denied': 403,
  'origin-denied': 403,
  'host-denied': 403,
  'unauthorized': 401,
  'not-found': 404,
  'session-not-found': 404,
  'session-busy': 409,
  'session-archived': 409,
  'session-scope-denied': 403,
  'model-unavailable': 400,
  'preset-unavailable': 400,
  'disabled': 503,
  'unsupported': 501,
})

/** HTTP status for the management API; MCP tool calls always use HTTP 200. */
export function httpStatusFor(error) {
  return HTTP_STATUS[error?.code] ?? 500
}

/** Convert any thrown value into the stable public error envelope. */
export function publicError(error, fallbackCode = 'internal') {
  if (error instanceof GatewayError) {
    return {
      code: error.code,
      message: error.message,
      ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    }
  }
  const code =
    typeof error?.code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(error.code)
      ? error.code
      : fallbackCode
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  }
}

/** Wrap unknown failures without losing the original cause for logs. */
export function asGatewayError(error, fallbackCode = 'internal', message) {
  if (error instanceof GatewayError) return error
  return new GatewayError(
    fallbackCode,
    message ?? (error instanceof Error ? error.message : String(error)),
    {},
    { cause: error },
  )
}

/** `true` for aborted waits; handlers convert this into a cancelled status. */
export function isAbortError(error) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
