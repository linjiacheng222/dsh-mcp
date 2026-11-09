/**
 * Adapter between the MCP tool surface and the live DeepSeek Harness services.
 *
 * The bridge owns session scope checks, cursor bookkeeping, wait semantics and
 * error translation. It deliberately uses the documented Host Session
 * Controller / Session Query / Permission Preset services rather than poking at
 * session logs directly.
 */

import { randomUUID } from 'node:crypto'
import {
  GatewayError,
  asGatewayError,
  isAbortError,
  publicError,
} from './errors.js'
import {
  assertMessageLength,
  assertModelAllowed,
  assertPresetAllowed,
  assertSessionAllowed,
  assertSessionId,
  parseModelKey,
  readLimit,
  resolveCreateCwd,
  selectionKey,
  sessionInScope,
  waitTimeout,
} from './permissions.js'
import {
  approvalModeCatalog,
  capabilityCatalog,
  visibleToolNames,
  TOOL_CAPABILITIES,
} from './capabilities.js'
import {
  buildEventsView,
  buildTranscript,
  sessionHeaderView,
  turnEndReason,
} from './format.js'

const DEFAULT_SESSION_LIST_LIMIT = 50
const MAX_SESSION_LIST_LIMIT = 200

function nowMs() {
  return Date.now()
}

function pendingCount(agent) {
  if (!agent) return 0
  const nextTurn = Array.isArray(agent.inbox?.nextTurn) ? agent.inbox.nextTurn.length : 0
  const nextStep = Array.isArray(agent.inbox?.nextStep) ? agent.inbox.nextStep.length : 0
  return nextTurn + nextStep
}

function lastSeq(events, fallback = -1) {
  let value = fallback
  for (const event of events) {
    if (Number.isSafeInteger(event?.seq) && event.seq > value) value = event.seq
  }
  return value
}

function detachedSelection(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value.provider !== 'string' ||
    typeof value.model !== 'string'
  ) {
    return null
  }
  return {
    provider: value.provider,
    model: value.model,
    ...(typeof value.reasoningEffort === 'string'
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
  }
}

function mapRemoteFailure(error) {
  if (error instanceof GatewayError) return error
  const code = typeof error?.code === 'string' ? error.code : undefined
  switch (code) {
    case 'session/not-found':
      return new GatewayError('session-not-found', error.message ?? 'session not found', {
        ...(error.details ?? {}),
      })
    case 'session/writer-held':
    case 'session/agent-busy':
    case 'session/conflict':
      return new GatewayError('session-busy', error.message ?? 'session is busy', {
        ...(error.details ?? {}),
      })
    case 'session/model-unavailable':
    case 'session/provider-models-unavailable':
      return new GatewayError('model-unavailable', error.message ?? 'model unavailable', {
        ...(error.details ?? {}),
      })
    case 'session/attachment-invalid':
    case 'session/title-invalid':
    case 'gateway/bad-request':
    case 'session/steer-unavailable':
      return new GatewayError('invalid-argument', error.message ?? 'invalid request', {
        ...(error.details ?? {}),
      })
    case 'session/migration-required':
    case 'session/fork-unavailable':
      return new GatewayError('session-archived', error.message ?? 'session cannot be used', {
        ...(error.details ?? {}),
      })
    case 'remote-access/denied':
      return new GatewayError('permission-denied', error.message ?? 'remote access denied', {
        ...(error.details ?? {}),
      })
    default:
      return new GatewayError(
        'internal',
        error instanceof Error ? error.message : String(error),
        {},
        { cause: error },
      )
  }
}

export class GatewayBridge {
  /**
   * @param {{ctx: object, store: import('./settings.js').SettingsStore, logger?: object}} options
   */
  constructor({ ctx, store, logger = console, approvals = null }) {
    this.ctx = ctx
    this.store = store
    this.logger = logger
    this.approvals = approvals
    this.activeWaits = new Set()
    this.createdSessions = new Set()
  }

  #rememberCreatedSession(sessionId) {
    this.createdSessions.add(sessionId)
    while (this.createdSessions.size > 200) {
      this.createdSessions.delete(this.createdSessions.values().next().value)
    }
  }

  #isChildSession(header) {
    return (
      header?.origin === 'subagent' ||
      (typeof header?.parentSession === 'string' && header.parentSession.length > 0) ||
      (typeof header?.parentSessionId === 'string' && header.parentSessionId.length > 0)
    )
  }

  /**
   * Session scope with one extension: a session this gateway created in the
   * current process remains usable while an allowlist is active. The allowlist
   * is otherwise authoritative and survives restarts.
   */
  #assertSession(settings, header) {
    const id = typeof header?.id === 'string' ? header.id : header?.sessionId
    if (
      typeof id === 'string' &&
      this.createdSessions.has(id) &&
      settings.scope.sessionMode === 'allowlist'
    ) {
      if (this.#isChildSession(header) && settings.scope.includeSubagents !== true) {
        throw new GatewayError(
          'session-scope-denied',
          `Session "${id}" is a subagent session and subagent access is disabled`,
          { sessionId: id, reason: 'subagent' },
        )
      }
      return id
    }
    return assertSessionAllowed(settings, header)
  }

  #sessionInScope(settings, header) {
    const id = typeof header?.id === 'string' ? header.id : header?.sessionId
    if (
      typeof id === 'string' &&
      this.createdSessions.has(id) &&
      settings.scope.sessionMode === 'allowlist'
    ) {
      return !(this.#isChildSession(header) && settings.scope.includeSubagents !== true)
    }
    return sessionInScope(settings, header)
  }

  settings() {
    return this.store.current()
  }

  #service(name) {
    const value = this.ctx.get(name)
    if (value === undefined || value === null) {
      throw new GatewayError(
        'unsupported',
        `The DSH service "${name}" is not mounted in this profile`,
        { service: name },
      )
    }
    return value
  }

  sessionController() {
    return this.#service('sessionController')
  }

  sessionQuery() {
    return this.#service('sessionQuery')
  }

  agents() {
    return this.#service('agents')
  }

  permissionPresets() {
    return this.#service('permissionPresets')
  }

  #signal(signal) {
    if (signal !== undefined) return signal
    return new AbortController().signal
  }

  async #inspect(sessionId, signal) {
    try {
      // DSH 0.2.2 moved the old SessionController.inspect seam to
      // SessionQuery.readSurface. Use the query-first path and retain the old
      // controller fallback for 0.2.1 deployments.
      const query = this.sessionQuery()
      if (typeof query.readSurface === 'function') {
        const result = await query.readSurface(sessionId)
        const header = result?.session ?? result?.header
        if (header) {
          return {
            header,
            events: result.events ?? [],
            inheritedEventCount: result.inheritedEventCount ?? 0,
          }
        }
      }
      const controller = this.sessionController()
      if (typeof controller.inspect !== 'function') {
        throw new GatewayError('unsupported', 'this DSH build exposes no session inspection API')
      }
      const result = await controller.inspect(sessionId, signal)
      if (!result || !result.meta) {
        throw new GatewayError('session-not-found', `session "${sessionId}" not found`, {
          sessionId,
        })
      }
      return {
        header: result.meta,
        events: result.events ?? [],
        inheritedEventCount: result.inheritedEventCount ?? 0,
      }
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async #cursorOf(sessionId, signal) {
    const inspected = await this.#inspect(sessionId, signal)
    return lastSeq(inspected.events, -1)
  }

  async #sessionProjection(sessionId, signal) {
    const sessions = this.ctx.get('sessions')
    const live = sessions?.get(sessionId)
    if (live !== undefined) {
      try {
        return this.ctx.sessionProjections.snapshot(live).values
      } catch {
        // fall through to the query service
      }
    }
    try {
      const observation = await this.sessionQuery().observeSession(sessionId, {
        signal,
        projectionMode: 'all',
      })
      try {
        return observation.projections?.values ?? null
      } finally {
        observation[Symbol.dispose]?.()
      }
    } catch {
      return null
    }
  }

  async #sessionDetails(header, live, projections) {
    const model = detachedSelection(projections?.modelSelection?.next ?? projections?.modelSelection?.lastUsed)
    return {
      ...sessionHeaderView(header),
      title: typeof projections?.title === 'string' ? projections.title : null,
      model,
      modelKey: selectionKey(model),
      permission: projections?.permissions?.currentValue ?? null,
      running: live?.status === 'running',
      agentAvailable: live !== undefined && live?.session?.id === header.id,
    }
  }

  /** Provider/model catalog, sanitized for the settings UI and validation. */
  async modelCatalog(options = {}) {
    const applyScope = options.applyScope !== false
    let raw
    try {
      raw = await this.sessionController().modelCatalog()
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const providers = (raw.groups ?? [])
      .map((group) => ({
        provider: group.id,
        providerName: group.name ?? group.id,
        models: (group.models ?? [])
          .filter((model) => {
            if (!applyScope) return true
            const mode = this.settings().scope.modelMode
            if (mode === 'all') return true
            if (mode === 'none') return false
            const included = this.settings().scope.allowedModels.includes(`${group.id}/${model.id}`)
            return mode === 'allowlist' ? included : !included
          })
          .map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            ...(model.description ? { description: model.description } : {}),
            reasoningEfforts: Array.isArray(model.reasoning?.efforts)
              ? model.reasoning.efforts.map((effort) => ({
                  id: effort.id,
                  name: effort.name ?? effort.id,
                  ...(effort.description ? { description: effort.description } : {}),
                }))
              : [],
            defaultEffort: model.reasoning?.defaultEffort ?? null,
          })),
      }))
      .filter((group) => group.models.length > 0)
    return {
      providers,
      default: detachedSelection(raw.default),
      defaultKey: selectionKey(raw.default),
      failures: Array.isArray(raw.failures) ? raw.failures : [],
    }
  }

  /** Configured permission presets in process order. */
  permissionCatalog() {
    const service = this.ctx.get('permissionPresets')
    if (service === undefined || service === null) {
      return { options: [], defaultPreset: null }
    }
    try {
      const catalog = service.catalog()
      return {
        options: (catalog.options ?? []).map((option) => ({
          value: option.value,
          name: option.name ?? option.value,
          ...(option.description ? { description: option.description } : {}),
        })),
        defaultPreset: catalog.defaultPreset ?? null,
      }
    } catch (error) {
      this.logger.warn?.(`[dsh-mcp-gateway] permission catalog unavailable: ${String(error)}`)
      return { options: [], defaultPreset: null }
    }
  }

  async #resolveModelSelection(modelKey, reasoningEffort) {
    assertModelAllowed(this.settings(), modelKey)
    const parsed = parseModelKey(modelKey)
    const catalog = await this.modelCatalog()
    const provider = catalog.providers.find((entry) => entry.provider === parsed.provider)
    const model = provider?.models.find((entry) => entry.id === parsed.model)
    if (provider === undefined || model === undefined) {
      throw new GatewayError(
        'model-unavailable',
        `Model "${modelKey}" is not present in the configured model catalog`,
        { model: modelKey },
      )
    }
    let effort = reasoningEffort
    if (effort !== undefined) {
      if (typeof effort !== 'string' || effort.length === 0) {
        throw new GatewayError('invalid-argument', 'reasoningEffort must be a non-empty string', {
          field: 'reasoningEffort',
        })
      }
      if (!model.reasoningEfforts.some((entry) => entry.id === effort)) {
        throw new GatewayError(
          'model-unavailable',
          `Model "${modelKey}" does not advertise reasoning effort "${effort}"`,
          {
            model: modelKey,
            reasoningEffort: effort,
            available: model.reasoningEfforts.map((entry) => entry.id),
          },
        )
      }
    }
    return {
      provider: provider.provider,
      model: model.id,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    }
  }

  /** List existing root sessions after scope and query filters. */
  async listSessions(params = {}, signal) {
    const settings = this.settings()
    let list
    try {
      list = await this.sessionController().list({}, signal)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : ''
    const cwdFilter = typeof params.cwd === 'string' && params.cwd.length > 0
      ? params.cwd.toLowerCase()
      : null
    const includeBlank = params.includeBlank !== false
    const limit = Math.min(
      Math.max(Number.isSafeInteger(params.limit) && params.limit > 0 ? params.limit : DEFAULT_SESSION_LIST_LIMIT, 1),
      MAX_SESSION_LIST_LIMIT,
    )
    const archived = this.#archivedIds()
    const rows = []
    for (const item of list.items ?? []) {
      if (!this.#sessionInScope(settings, item)) continue
      if (item.sessionId !== undefined && archived.has(item.sessionId)) continue
      if (!includeBlank && item.blank === true) continue
      const projections = item.projections?.values ?? {}
      const title = typeof projections.title === 'string' ? projections.title : null
      const cwd = typeof item.cwd === 'string' ? item.cwd : null
      if (cwdFilter !== null && (cwd ?? '').toLowerCase() !== cwdFilter) continue
      if (query.length > 0) {
        const haystack = `${item.sessionId ?? ''}\n${title ?? ''}\n${cwd ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) continue
      }
      const model = detachedSelection(projections.modelSelection?.next ?? projections.modelSelection?.lastUsed)
      rows.push({
        sessionId: item.sessionId,
        title,
        cwd,
        model,
        modelKey: selectionKey(model),
        permission: projections.permissions?.currentValue ?? null,
        running: item.running === true,
        agentAvailable: item.agentAvailable === true,
        blank: item.blank === true,
        updatedAt: item.updatedAt ?? null,
        origin: item.origin ?? null,
        parentSessionId: item.parentSessionId ?? null,
        formatStatus: item.formatStatus ?? null,
      })
    }
    rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    return {
      sessions: rows.slice(0, limit),
      total: rows.length,
      hasMore: rows.length > limit,
      scope: {
        sessionMode: settings.scope.sessionMode,
        includeSubagents: settings.scope.includeSubagents,
      },
    }
  }

  #archivedIds() {
    try {
      const registry = this.ctx.get('workspaceRegistry')
      const ids = registry?.archivedSessionIds
      return new Set(Array.isArray(ids) ? ids : [])
    } catch {
      return new Set()
    }
  }

  /** Read a transcript or bounded event page from one session. */
  async readSession(params, signal) {
    const settings = this.settings()
    const sessionId = assertSessionId(params.sessionId)
    const inspected = await this.#inspect(sessionId, signal)
    this.#assertSession(settings, inspected.header)
    const live = this.agents().get(sessionId)
    const projections = await this.#sessionProjection(sessionId, signal)
    const metadata = await this.#sessionDetails(inspected.header, live, projections)
    const sinceSeq = Number.isSafeInteger(params.sinceSeq) && params.sinceSeq >= 0
      ? params.sinceSeq
      : undefined
    const limit = readLimit(settings, params.limit)
    const view = params.view === 'events' ? 'events' : 'transcript'

    if (view === 'events') {
      let raw
      try {
        raw = await this.sessionQuery().readSession(sessionId)
      } catch (error) {
        throw mapRemoteFailure(error)
      }
      const result = buildEventsView(raw.events ?? [], {
        sinceSeq,
        limit,
        maxChars: settings.limits.maxReadChars,
        logCursor: lastSeq(raw.events ?? [], -1),
      })
      return {
        session: metadata,
        view,
        ...result,
        limits: {
          maxReadMessages: settings.limits.maxReadMessages,
          maxReadChars: settings.limits.maxReadChars,
        },
      }
    }

    let surface
    try {
      surface = await this.sessionQuery().readSurface(sessionId)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const result = buildTranscript(surface.events ?? [], {
      sinceSeq,
      limit,
      maxChars: settings.limits.maxReadChars,
      includeThoughts: params.includeThoughts === true,
      logCursor: surface.capturedThroughSeq ?? lastSeq(surface.events ?? [], -1),
    })
    return {
      session: metadata,
      view,
      ...result,
      limits: {
        maxReadMessages: settings.limits.maxReadMessages,
        maxReadChars: settings.limits.maxReadChars,
      },
    }
  }

  /** Send one user message into an existing session. */
  async sendMessage(params, signal) {
    const settings = this.settings()
    const sessionId = assertSessionId(params.sessionId)
    const text = assertMessageLength(settings, params.message)
    const inspected = await this.#inspect(sessionId, signal)
    this.#assertSession(settings, inspected.header)
    if (this.#archivedIds().has(sessionId)) {
      throw new GatewayError('session-archived', `session "${sessionId}" is archived`, {
        sessionId,
      })
    }
    const live = this.agents().get(sessionId)
    if (
      settings.limits.sendWhenBusy === 'reject' &&
      live !== undefined &&
      (live.status === 'running' || pendingCount(live) > 0)
    ) {
      throw new GatewayError('session-busy', `session "${sessionId}" is busy`, { sessionId })
    }
    if (params.delivery === 'steer' && (live === undefined || live.status !== 'running')) {
      throw new GatewayError(
        'invalid-argument',
        'delivery "steer" requires a running session; use "followup" instead',
        { field: 'delivery' },
      )
    }
    if (params.model !== undefined) {
      await this.applyModel(sessionId, params.model, params.reasoningEffort, signal)
    }
    const baseline = lastSeq(inspected.events, -1)
    const requestId = randomUUID()
    const wait = params.wait !== false
    // A blocking send is expected to behave like wait_agent; use the maximum
    // configured budget unless the caller asked for a shorter explicit wait.
    const timeoutMs = waitTimeout(
      settings,
      Number.isSafeInteger(params.timeoutMs)
        ? params.timeoutMs
        : (wait && settings.limits.maxWaitMs >= 0 ? settings.limits.maxWaitMs : undefined),
    )
    const request = {
      sessionId,
      content: [{ type: 'text', text }],
      requestId,
      ...(params.delivery === 'steer' ? { mode: 'steer' } : {}),
    }
    try {
      await this.sessionController().prompt(request, this.#signal(signal))
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const accepted = {
      sessionId,
      accepted: true,
      requestId,
      baseline,
      delivery: params.delivery === 'steer' ? 'steer' : 'followup',
      wait,
    }
    this.logger.info?.(
      `[dsh-mcp-gateway] send_message session=${sessionId} delivery=${accepted.delivery} chars=${text.length}`,
    )
    if (!wait) return accepted
    const waited = await this.waitForCompletion(
      { sessionId, sinceSeq: baseline, timeoutMs },
      signal,
      { internal: true, expectTurn: true },
    )
    return { ...accepted, wait: waited }
  }

  /** Wait for the session to finish its current/next turn and return new messages. */
  async waitForCompletion(params, signal, options = {}) {
    const settings = this.settings()
    const sessionId = assertSessionId(params.sessionId)
    const inspected = await this.#inspect(sessionId, signal)
    this.#assertSession(settings, inspected.header)
    const sinceSeq = Number.isSafeInteger(params.sinceSeq) && params.sinceSeq >= 0
      ? params.sinceSeq
      : lastSeq(inspected.events, -1)
    const timeoutMs = waitTimeout(settings, params.timeoutMs)
    const expectTurn = options.expectTurn === true
    if (!expectTurn && Number.isSafeInteger(params.sinceSeq)) {
      // A caller immediately after send_message(wait:false) can arrive before
      // the prompt has flipped the agent to running. Give the turn a short
      // grace period instead of returning idle in the same event-loop turn.
      const live = this.agents().get(sessionId)
      const hasActivity = (inspected.events ?? []).some(
        (event) => Number.isSafeInteger(event?.seq) && event.seq > sinceSeq,
      )
      if (!hasActivity && (live === undefined || (live.status !== 'running' && pendingCount(live) === 0))) {
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
    }
    let initialTurnEndSeq = null
    let initialTurnEndReason = null
    let initialCompletedTurns = 0
    if (expectTurn) {
      for (const event of inspected.events ?? []) {
        if (!Number.isSafeInteger(event?.seq) || event.seq <= sinceSeq) continue
        if (event.type !== 'turn/end') continue
        initialTurnEndSeq = event.seq
        initialTurnEndReason = turnEndReason(event)
        initialCompletedTurns += 1
      }
    }
    if (this.activeWaits.size >= 8) {
      throw new GatewayError('session-busy', 'too many concurrent waiters; retry later', {
        active: this.activeWaits.size,
      })
    }
    const waiter = Symbol(sessionId)
    this.activeWaits.add(waiter)
    let status
    try {
      status = await this.#waitForSession(sessionId, sinceSeq, timeoutMs, signal, {
        expectTurn,
        initialTurnEndSeq,
        initialTurnEndReason,
        initialCompletedTurns,
      })
    } finally {
      this.activeWaits.delete(waiter)
    }
    const surface = await this.sessionQuery().readSurface(sessionId)
    const transcript = buildTranscript(surface.events ?? [], {
      sinceSeq,
      limit: settings.limits.maxReadMessages,
      maxChars: settings.limits.maxReadChars,
      logCursor: surface.capturedThroughSeq ?? lastSeq(surface.events ?? [], -1),
    })
    return {
      sessionId,
      status: status.status,
      running: status.running,
      pendingMessages: status.pendingMessages,
      sinceSeq,
      cursor: transcript.cursor,
      completedTurns: status.completedTurns,
      turnEndReason: status.turnEndReason,
      ...(status.error ? { error: status.error } : {}),
      messages: transcript.messages,
      truncated: transcript.truncated,
    }
  }

  #waitForSession(sessionId, sinceSeq, timeoutMs, signal, options = {}) {
    const expectTurn = options.expectTurn === true
    const agents = this.agents()
    const ctx = this.ctx
    const deadline = nowMs() + timeoutMs
    let agent = agents.get(sessionId)
    const initiallyRunning = agent?.status === 'running'
    const initiallyPending = pendingCount(agent)
    if (!expectTurn && (agent === undefined || (!initiallyRunning && initiallyPending === 0))) {
      return Promise.resolve({
        status: 'idle',
        running: false,
        pendingMessages: 0,
        completedTurns: 0,
        turnEndReason: null,
        error: null,
      })
    }

    return new Promise((resolve) => {
      let settled = false
      let settling = false
      let completedTurns = Number.isSafeInteger(options.initialCompletedTurns)
        ? options.initialCompletedTurns
        : 0
      let turnEndSeq = Number.isSafeInteger(options.initialTurnEndSeq) ? options.initialTurnEndSeq : null
      let reason = options.initialTurnEndReason ?? null
      let lastError = null
      let statusOverride = null

      const disposers = []
      const cleanup = () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            // listener cleanup is best-effort
          }
        }
        clearInterval(timer)
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      }
      const finish = (status) => {
        if (settled) return
        settled = true
        cleanup()
        const live = agents.get(sessionId)
        resolve({
          status: statusOverride ?? status,
          running: live?.status === 'running',
          pendingMessages: pendingCount(live),
          completedTurns,
          turnEndReason: reason,
          error: lastError,
        })
      }
      const check = () => {
        if (settled) return
        if (signal?.aborted === true) {
          statusOverride = 'cancelled'
          finish('cancelled')
          return
        }
        const live = agents.get(sessionId)
        const pending = pendingCount(live)
        if (live !== undefined && turnEndSeq === null && pending === 0 && live.status !== 'running' && !settling) {
          if (!expectTurn) {
            finish('idle')
            return
          }
          // expectTurn: the prompt may not have flipped the agent to running
          // yet. Keep waiting for turn/end instead of returning an empty reply.
        }
        if (pending > 0 && turnEndSeq !== null) turnEndSeq = null
        if (turnEndSeq !== null && pending === 0) {
          if (settling) return
          settling = true
          const remaining = Number.isFinite(deadline)
            ? Math.max(1, deadline - nowMs())
            : 2147483647
          const timerId = setTimeout(() => {
            if (!settled) finish('timeout')
          }, remaining)
          Promise.resolve(live?.whenIdle?.()).then(
            () => {
              clearTimeout(timerId)
              if (settled) return
              const after = agents.get(sessionId)
              if (pendingCount(after) > 0) {
                settling = false
                turnEndSeq = null
                return
              }
              finish('idle')
            },
            (error) => {
              clearTimeout(timerId)
              if (settled) return
              lastError = publicError(error)
              finish('idle')
            },
          )
          return
        }
        if (live === undefined) {
          if (!expectTurn) {
            finish('idle')
            return
          }
          if (nowMs() >= deadline) finish('timeout')
          return
        }
        if (nowMs() >= deadline) {
          if (expectTurn && turnEndSeq === null) {
            finish('timeout')
            return
          }
          finish(live?.status === 'running' ? 'running' : pending > 0 ? 'queued' : 'idle')
        }
      }
      const onEvent = (session, event) => {
        if (session?.id !== sessionId || settled) return
        if (!Number.isSafeInteger(event?.seq) || event.seq <= sinceSeq) return
        if (event.type === 'turn/end') {
          completedTurns += 1
          turnEndSeq = event.seq
          reason = turnEndReason(event)
          check()
          return
        }
        if (
          event.type === 'turn/start' ||
          event.type === 'user/message' ||
          event.type === 'assistant/message' ||
          event.type === 'tool/result'
        ) {
          check()
        }
      }
      const onStatus = (payload) => {
        if (payload?.agent?.id !== sessionId || settled) return
        check()
      }
      const onError = (payload) => {
        if (payload?.agent?.id !== sessionId || settled) return
        lastError = publicError(payload.error, 'agent-error')
        check()
      }
      const onAbort = () => {
        statusOverride = 'cancelled'
        finish('cancelled')
      }
      disposers.push(
        ctx.on('session/event', onEvent, { global: true }),
        ctx.on('agent/status', onStatus),
        ctx.on('agent/error', onError),
      )
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      const timer = setInterval(check, 300)
      check()
    })
  }

  /** Validate and install a model selection for the next request. */
  async applyModel(sessionId, modelKey, reasoningEffort, signal) {
    const settings = this.settings()
    assertSessionId(sessionId)
    const inspected = await this.#inspect(sessionId, signal)
    this.#assertSession(settings, inspected.header)
    const selection = await this.#resolveModelSelection(modelKey, reasoningEffort)
    const controller = this.sessionController()
    if (typeof controller.selectModel === 'function') {
      try {
        const result = await controller.selectModel({
          sessionId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selection.reasoningEffort }),
        })
        return result?.selected ?? selection
      } catch (error) {
        throw mapRemoteFailure(error)
      }
    }
    let agent
    try {
      const found = await controller.resolveAgent(sessionId)
      if (found?.error !== undefined) throw found.error
      agent = found?.agent ?? found
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const helper = controller.agents
    if (helper === undefined || typeof helper.selectForNextRequest !== 'function') {
      throw new GatewayError(
        'unsupported',
        'this DSH build does not support per-session model selection outside the GUI',
        { sessionId },
      )
    }
    try {
      helper.selectForNextRequest(agent, selection)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    return selection
  }

  /** Validate and switch a session permission preset. */
  async setPermission(sessionId, preset, signal) {
    const settings = this.settings()
    assertSessionId(sessionId)
    const inspected = await this.#inspect(sessionId, signal)
    this.#assertSession(settings, inspected.header)
    const available = this.permissionCatalog().options.map((entry) => entry.value)
    assertPresetAllowed(settings, preset, available)
    let agent
    try {
      const found = await this.sessionController().resolveAgent(sessionId)
      if (found?.error !== undefined) throw found.error
      agent = found?.agent ?? found
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    try {
      this.permissionPresets().set(agent.session, preset)
    } catch (error) {
      throw new GatewayError(
        'preset-unavailable',
        error instanceof Error ? error.message : String(error),
        { preset },
        { cause: error },
      )
    }
    return { sessionId, preset }
  }

  /** Validate the optional model and permission preset, then create a session. */
  async createSession(params = {}, signal) {
    const settings = this.settings()
    if (settings.scope.sessionMode === 'none') {
      throw new GatewayError(
        'session-scope-denied',
        'new sessions are disabled by the session scope',
        { reason: 'session-scope-none' },
      )
    }
    if (settings.scope.modelMode === 'none') {
      throw new GatewayError(
        'permission-denied',
        'new sessions are disabled by the model scope',
        { reason: 'model-scope-none' },
      )
    }
    const workingDirectory = this.ctx.get('workingDirectory')
    let fallbackRoots = []
    let fallbackCwd =
      typeof workingDirectory?.defaultDirectory === 'string'
        ? workingDirectory.defaultDirectory
        : undefined
    if (settings.scope.defaultCwd === '' && settings.scope.allowedRoots.length === 0) {
      try {
        const list = await this.sessionController().list({}, signal)
        fallbackRoots = [...new Set(
          (list.items ?? [])
            .map((item) => item.cwd)
            .filter((cwd) => typeof cwd === 'string' && cwd.length > 0),
        )]
        if (fallbackRoots.length > 0) fallbackCwd = fallbackRoots[0]
      } catch {
        // A cold-session catalog must not prevent a create with a default workspace.
      }
    }
    const cwd = resolveCreateCwd(settings, params.cwd, fallbackCwd, fallbackRoots)
    const availablePresets = this.permissionCatalog().options.map((entry) => entry.value)
    const preset = assertPresetAllowed(
      settings,
      params.permissionPreset ?? settings.scope.newSessionPreset,
      availablePresets,
    )
    let selection = null
    if (params.model !== undefined) {
      selection = await this.#resolveModelSelection(params.model, params.reasoningEffort)
    } else if (settings.scope.defaultModel !== '') {
      selection = await this.#resolveModelSelection(settings.scope.defaultModel)
    }
    let created
    try {
      created = await this.sessionController().create({ cwd }, this.#signal(signal))
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const sessionId = created.sessionId
    this.#rememberCreatedSession(sessionId)
    try {
      const session = this.ctx.get('sessions')?.get(sessionId)
      if (session === undefined) {
        throw new GatewayError('internal', 'created session is not published', { sessionId })
      }
      this.permissionPresets().set(session, preset)
      if (selection !== null) {
        await this.applyModel(sessionId, selectionKey(selection), selection.reasoningEffort, signal)
      }
    } catch (error) {
      throw asGatewayError(
        error,
        'internal',
        `session "${sessionId}" was created but could not be configured`,
      )
    }
    this.logger.info?.(
      `[dsh-mcp-gateway] create_session session=${sessionId} cwd=${cwd} preset=${preset} model=${selection === null ? 'default' : selectionKey(selection)}`,
    )
    return {
      sessionId,
      cwd,
      permissionPreset: preset,
      model: selection,
      modelKey: selectionKey(selection),
    }
  }

  /** Create a session, send one prompt and wait for its answer. */
  async runTask(params = {}, signal) {
    const settings = this.settings()
    const created = await this.createSession(
      {
        cwd: params.cwd,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        permissionPreset: params.permissionPreset,
      },
      signal,
    )
    let sent
    try {
      sent = await this.sendMessage(
        {
          sessionId: created.sessionId,
          message: params.prompt,
          wait: true,
          timeoutMs: params.timeoutMs,
        },
        signal,
      )
    } catch (error) {
      const wrapped = asGatewayError(error)
      wrapped.details = { ...wrapped.details, sessionId: created.sessionId }
      throw wrapped
    }
    return {
      ...created,
      requestId: sent.requestId,
      baseline: sent.baseline,
      wait: sent.wait,
    }
  }

  async cancelTurn(sessionId) {
    const settings = this.settings()
    assertSessionId(sessionId)
    const inspected = await this.#inspect(sessionId)
    this.#assertSession(settings, inspected.header)
    try {
      const result = await this.sessionController().cancel({ sessionId })
      return { sessionId, ...result }
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async forkSession(sessionId, atSeq) {
    const settings = this.settings()
    assertSessionId(sessionId)
    const inspected = await this.#inspect(sessionId)
    this.#assertSession(settings, inspected.header)
    if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || atSeq < 0)) {
      throw new GatewayError('invalid-argument', 'atSeq must be a non-negative integer', {
        field: 'atSeq',
      })
    }
    try {
      return await this.sessionController().fork({
        sessionId,
        ...(atSeq === undefined ? {} : { atSeq }),
      })
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async renameSession(sessionId, title) {
    const settings = this.settings()
    assertSessionId(sessionId)
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
      throw new GatewayError('invalid-argument', 'title must be a non-empty string (max 200)', {
        field: 'title',
      })
    }
    const inspected = await this.#inspect(sessionId)
    this.#assertSession(settings, inspected.header)
    try {
      return await this.sessionController().rename({ sessionId, title: title.trim() })
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  /** Full state view consumed by the management API. */
  /**
   * One-call "send a message and return the answer" interface, mirroring how a
   * parent agent talks to a subagent.
   */
  async askDsh(params, signal) {
    const settings = this.settings()
    const sessionId = assertSessionId(params.sessionId)
    const message = assertMessageLength(settings, params.message)
    if (params.model !== undefined) {
      if (settings.capabilities.selectModel !== true && settings.approvalMode !== 'open') {
        throw new GatewayError(
          'permission-denied',
          'model overrides require the "selectModel" capability or open mode',
          { capability: 'selectModel' },
        )
      }
    }
    const sent = await this.sendMessage(
      {
        sessionId,
        message,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        wait: true,
        // A one-call answer should block like wait_agent. Use the configured
        // maximum wait budget unless the caller explicitly asks for less.
        timeoutMs: Number.isSafeInteger(params.timeoutMs)
          ? params.timeoutMs
          : (settings.limits.maxWaitMs >= 0 ? settings.limits.maxWaitMs : undefined),
      },
      signal,
    )
    const wait = sent.wait
    const assistants = Array.isArray(wait?.messages)
      ? wait.messages.filter((entry) => entry.role === 'assistant' && typeof entry.text === 'string')
      : []
    const reply = assistants.length > 0 ? assistants.at(-1).text : null
    return {
      sessionId,
      requestId: sent.requestId,
      reply,
      status: wait?.status ?? 'unknown',
      cursor: wait?.cursor ?? null,
      turnEndReason: wait?.turnEndReason ?? null,
      messages: wait?.messages ?? [],
      truncated: wait?.truncated === true,
    }
  }

  /** Live DSH settings descriptors (secrets redacted). */
  async settingsDescribe(namespace, signal) {
    const service = this.#service('settings')
    let descriptors
    try {
      descriptors = service.describe({ redactSecrets: true })
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    if (!Array.isArray(descriptors)) return { namespaces: [] }
    const filtered =
      typeof namespace === 'string' && namespace.length > 0
        ? descriptors.filter((entry) => entry?.ns === namespace)
        : descriptors
    return {
      namespaces: filtered.map((entry) => ({
        ns: entry.ns,
        revision: entry.revision,
        applies: entry.applies,
        autoGenerate: entry.autoGenerate,
        value: entry.value,
        user: entry.user,
        ...(Array.isArray(entry.secrets) ? { secrets: entry.secrets } : {}),
      })),
    }
  }

  /** Update one live DSH settings namespace. */
  async settingsUpdate(params, signal) {
    const service = this.#service('settings')
    if (typeof params.namespace !== 'string' || params.namespace.length === 0) {
      throw new GatewayError('invalid-argument', 'namespace must be a non-empty string', {
        field: 'namespace',
      })
    }
    if (params.patch === null || typeof params.patch !== 'object' || Array.isArray(params.patch)) {
      throw new GatewayError('invalid-argument', 'patch must be an object', { field: 'patch' })
    }
    try {
      await service.update(
        params.namespace,
        params.patch,
        Number.isSafeInteger(params.expectedRevision) ? params.expectedRevision : undefined,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('No configurable plugin entry')) {
        throw new GatewayError(
          'invalid-argument',
          `unknown settings namespace "${params.namespace}"; call settings_describe without a namespace to list configurable namespaces`,
          { field: 'namespace', namespace: params.namespace },
        )
      }
      throw mapRemoteFailure(error)
    }
    return this.settingsDescribe(params.namespace, signal)
  }

  /** Installed plugin rows and profile bundles. */
  async pluginsList() {
    const manager = this.#service('pluginManager')
    let plugins = []
    let bundles = []
    try {
      plugins = await manager.listPlugins()
      bundles = await manager.listBundles()
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    return {
      plugins: Array.isArray(plugins)
        ? plugins.map((entry) => ({
            entryId: entry.entryId,
            moduleName: entry.moduleName,
            bundleName: entry.bundleName ?? null,
            enabled: entry.enabled === true,
            ...(entry.readOnlyReason ? { readOnlyReason: entry.readOnlyReason } : {}),
            ...(entry.patchId ? { patchId: entry.patchId } : {}),
          }))
        : [],
      bundles: Array.isArray(bundles)
        ? bundles.map((entry) => ({
            name: entry.name,
            version: entry.version ?? null,
            enabled: entry.enabled === true,
            installed: entry.installed === true,
            availability: entry.availability ?? null,
            removable: entry.removable === true,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.readOnlyReason ? { readOnlyReason: entry.readOnlyReason } : {}),
          }))
        : [],
    }
  }

  async pluginSetEnabled(params) {
    const manager = this.#service('pluginManager')
    if (typeof params.entryId !== 'string' || params.entryId.length === 0) {
      throw new GatewayError('invalid-argument', 'entryId must be a non-empty string', {
        field: 'entryId',
      })
    }
    try {
      return await manager.setPluginEnabled(params.entryId, params.enabled === true)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async bundleSetEnabled(params) {
    const manager = this.#service('pluginManager')
    if (typeof params.name !== 'string' || params.name.length === 0) {
      throw new GatewayError('invalid-argument', 'name must be a non-empty string', {
        field: 'name',
      })
    }
    try {
      return await manager.setBundleEnabled(params.name, params.enabled === true)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async pluginInstall(params) {
    const manager = this.#service('pluginManager')
    if (typeof params.spec !== 'string' || params.spec.trim().length === 0) {
      throw new GatewayError('invalid-argument', 'spec must be a non-empty string', {
        field: 'spec',
      })
    }
    try {
      const result = await manager.installBundle(params.spec, {
        enabled: params.enabled !== false,
      })
      return result ?? { ok: true }
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async pluginRemove(params) {
    const manager = this.#service('pluginManager')
    if (typeof params.name !== 'string' || params.name.length === 0) {
      throw new GatewayError('invalid-argument', 'name must be a non-empty string', {
        field: 'name',
      })
    }
    try {
      return (await manager.removeBundle(params.name)) ?? { ok: true }
    } catch (error) {
      throw mapRemoteFailure(error)
    }
  }

  async credentialsDescribe(params) {
    const service = this.#service('credentials')
    const refs = Array.isArray(params.refs) ? params.refs : []
    if (refs.length === 0) {
      throw new GatewayError('invalid-argument', 'refs must be a non-empty string array', {
        field: 'refs',
      })
    }
    const result = {}
    for (const ref of refs) {
      if (typeof ref !== 'string' || ref.length === 0) continue
      try {
        result[ref] = await service.describe(ref)
      } catch (error) {
        result[ref] = { error: publicError(error).message }
      }
    }
    return { credentials: result }
  }

  async credentialSet(params) {
    const service = this.#service('credentials')
    if (typeof params.ref !== 'string' || params.ref.length === 0) {
      throw new GatewayError('invalid-argument', 'ref must be a non-empty string', { field: 'ref' })
    }
    if (typeof params.value !== 'string' || params.value.length === 0) {
      throw new GatewayError('invalid-argument', 'value must be a non-empty string', {
        field: 'value',
      })
    }
    try {
      await service.set(params.ref, params.value)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    return { ref: params.ref, configured: true }
  }

  async credentialUnset(params) {
    const service = this.#service('credentials')
    if (typeof params.ref !== 'string' || params.ref.length === 0) {
      throw new GatewayError('invalid-argument', 'ref must be a non-empty string', { field: 'ref' })
    }
    try {
      await service.unset(params.ref)
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    return { ref: params.ref, configured: false }
  }

  async state() {
    const snapshot = this.store.snapshot()
    const settings = snapshot.settings
    let modelCatalog = { providers: [], default: null, defaultKey: null, failures: [] }
    const warnings = [...snapshot.warnings]
    try {
      modelCatalog = await this.modelCatalog({ applyScope: false })
    } catch (error) {
      warnings.push(`model catalog unavailable: ${publicError(error).message}`)
    }
    if (modelCatalog.failures.length > 0) {
      warnings.push(
        ...modelCatalog.failures.map(
          (failure) => `provider ${failure.id ?? failure.provider ?? 'unknown'} unavailable: ${failure.message ?? ''}`,
        ),
      )
    }
    const permissions = this.permissionCatalog()
    let sessions = []
    try {
      sessions = await this.sessionCatalog()
    } catch (error) {
      warnings.push(`session catalog unavailable: ${publicError(error).message}`)
    }
    const visible = visibleToolNames(settings)
    return {
      ok: true,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      settings,
      endpoint: this.endpointInfo(),
      settingsPath: this.store.filePath,
      onboarding: {
        firstRun: settings.onboarding.shownAt === null,
        acknowledged: settings.onboarding.acknowledgedAt !== null,
        shownAt: settings.onboarding.shownAt,
        acknowledgedAt: settings.onboarding.acknowledgedAt,
      },
      catalog: {
        capabilities: capabilityCatalog(settings),
        approvalModes: approvalModeCatalog(),
        tools: visible.map((name) => ({ name, visible: true })),
        hiddenTools: Object.keys(TOOL_CAPABILITIES).filter((name) => !visible.includes(name)),
        models: modelCatalog.providers,
        defaultModel: modelCatalog.defaultKey,
        permissionPresets: permissions.options,
        defaultPreset: permissions.defaultPreset,
        sessions,
      },
      status: {
        enabled: settings.server.enabled,
        running: true,
        capabilityCount: Object.values(settings.capabilities).filter(Boolean).length,
        visibleToolCount: visible.length,
        pendingApprovals: this.approvals?.pendingCount?.() ?? 0,
        systemApprovalPopup: settings.server.systemApprovalPopup !== false,
        serviceWarnings: warnings,
      },
      warnings,
    }
  }

  /** Root sessions for the visual scope picker (owner UI only; ignores MCP scope). */
  async sessionCatalog() {
    let list
    try {
      list = await this.sessionController().list({})
    } catch (error) {
      throw mapRemoteFailure(error)
    }
    const archived = this.#archivedIds()
    return (list.items ?? [])
      .filter((item) => item.origin !== 'subagent' && item.parentSessionId === undefined)
      .filter((item) => !archived.has(item.sessionId))
      .slice(0, 300)
      .map((item) => {
        const projections = item.projections?.values ?? {}
        const model = detachedSelection(
          projections.modelSelection?.next ?? projections.modelSelection?.lastUsed,
        )
        return {
          sessionId: item.sessionId,
          title: typeof projections.title === 'string' ? projections.title : null,
          cwd: typeof item.cwd === 'string' ? item.cwd : null,
          modelKey: selectionKey(model),
          permission: projections.permissions?.currentValue ?? null,
          running: item.running === true,
          blank: item.blank === true,
          updatedAt: item.updatedAt ?? null,
        }
      })
  }

  /** Origin and endpoint facts for the browser management UI. */
  endpointInfo() {
    let origin = null
    try {
      origin = this.ctx.webServer?.getOrigin?.() ?? null
    } catch {
      origin = null
    }
    if (origin === null) {
      const port = this.ctx.webServer?.port
      if (typeof port === 'number') origin = `http://127.0.0.1:${port}`
    }
    const base = origin ?? ''
    return {
      origin,
      path: '/dsh-mcp',
      mcpUrl: base.length > 0 ? `${base}/dsh-mcp/mcp` : null,
    }
  }

  /** Capability/tool snapshot for the activation log and management status. */
  toolCatalog(settings = this.settings()) {
    return visibleToolNames(settings).map((name) => ({
      name,
      capability: TOOL_CAPABILITIES[name]?.[0] ?? null,
      visible: true,
    }))
  }

  /** Whether a tool is currently listed (used by the HTTP layer/tests). */
  toolEnabled(name) {
    return visibleToolNames(this.settings()).includes(name)
  }
}


export { mapRemoteFailure }
