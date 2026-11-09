/**
 * Durable plugin settings (schema v2).
 *
 * v2 replaces the boolean permission list + `fullAccess` with a 4-mode approval
 * policy and three-level capability grants. v1 files are migrated once and
 * backed up by the atomic writer; tokens, scope, limits and onboarding survive.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { CAPABILITY_KEYS, APPROVAL_MODE_VALUES, CAPABILITIES } from './capabilities.js'
import { GatewayError } from './errors.js'
import { writeSettingsElevated } from './settings-elevation.js'
import {
  DATA_DIR_NAME,
  DEFAULT_APPROVAL_MODE,
  DEFAULT_LIMITS,
  SETTINGS_FILE_NAME,
  SETTINGS_SCHEMA_VERSION,
  TOKEN_PREFIX,
  defaultSettings,
  resettableDefaults,
} from './defaults.js'
import { parseModelKey } from './permissions.js'

const modelKeySchema = z.string().regex(/^[^/]+\/.+$/, 'expected "provider/model"')

const capabilitiesShape = {}
for (const key of CAPABILITY_KEYS) capabilitiesShape[key] = z.boolean()
const capabilitiesSchema = z.object(capabilitiesShape).strict()

const scopeSchema = z
  .object({
    sessionMode: z.enum(['all', 'allowlist', 'except', 'none']),
    sessionIds: z.array(z.string().min(1).max(256)).max(500),
    includeSubagents: z.boolean(),
    modelMode: z.enum(['all', 'allowlist', 'except', 'none']),
    allowedModels: z.array(modelKeySchema).max(1000),
    allowedRoots: z.array(z.string().min(1).max(4096)).max(100),
    defaultCwd: z.string().max(4096),
    defaultModel: z.union([z.literal(''), modelKeySchema]),
    newSessionPreset: z.string().min(1).max(80),
  })
  .strict()

/** Positive bounded integer, or any negative value meaning "unlimited". */
function limitSchema(min, max, label) {
  return z
    .number()
    .int()
    .refine((value) => value < 0 || (value >= min && value <= max), {
      message: `${label} must be negative (unlimited) or between ${min} and ${max}`,
    })
}

const limitsSchema = z
  .object({
    maxReadMessages: limitSchema(1, 500, 'limits.maxReadMessages'),
    maxReadChars: limitSchema(1000, 500000, 'limits.maxReadChars'),
    maxMessageChars: limitSchema(1000, 1000000, 'limits.maxMessageChars'),
    defaultWaitMs: limitSchema(1000, 600000, 'limits.defaultWaitMs'),
    maxWaitMs: limitSchema(1000, 600000, 'limits.maxWaitMs'),
    approvalTimeoutMs: limitSchema(5000, 600000, 'limits.approvalTimeoutMs'),
    sendWhenBusy: z.enum(['queue', 'reject']),
  })
  .strict()

const serverSchema = z
  .object({
    enabled: z.boolean(),
    token: z
      .string()
      .min(16)
      .max(256)
      .refine((value) => !/\s/.test(value), 'token must not contain whitespace'),
    allowNonLoopback: z.boolean(),
    systemApprovalPopup: z.boolean().default(true),
    instructions: z.string().max(8000),
  })
  .strict()

const onboardingSchema = z
  .object({
    shownAt: z.number().int().nonnegative().nullable(),
    acknowledgedAt: z.number().int().nonnegative().nullable(),
  })
  .strict()

export const settingsSchema = z
  .object({
    schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
    approvalMode: z.enum(APPROVAL_MODE_VALUES),
    capabilities: capabilitiesSchema,
    scope: scopeSchema,
    limits: limitsSchema,
    server: serverSchema,
    onboarding: onboardingSchema,
  })
  .strict()

const settingsFileSchema = settingsSchema
  .extend({
    revision: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

/** Generate one fresh bearer token. */
export function generateToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Resolve the settings file path from DSH_HOME (or the conventional fallback). */
export function resolveSettingsPath(env = process.env) {
  const home =
    typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? env.DSH_HOME
      : path.join(os.homedir(), '.dsh')
  return path.join(path.resolve(home), DATA_DIR_NAME, SETTINGS_FILE_NAME)
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function customValidation(settings) {
  const problems = []
  const absolute = (value, field) => {
    if (value !== '' && !path.isAbsolute(value)) problems.push(`${field} must be an absolute path`)
  }
  absolute(settings.scope.defaultCwd, 'scope.defaultCwd')
  settings.scope.allowedRoots.forEach((root, index) => absolute(root, `scope.allowedRoots[${index}]`))
  if (settings.scope.defaultModel !== '' && parseModelKey(settings.scope.defaultModel) === null) {
    problems.push('scope.defaultModel must use the "provider/model" form')
  }
  if (settings.scope.allowedModels.some((key) => parseModelKey(key) === null)) {
    problems.push('scope.allowedModels entries must use the "provider/model" form')
  }
  if (settings.scope.newSessionPreset === 'auto') {
    problems.push('scope.newSessionPreset cannot be "auto"')
  }
  if (
    settings.limits.defaultWaitMs >= 0 &&
    settings.limits.maxWaitMs >= 0 &&
    settings.limits.defaultWaitMs > settings.limits.maxWaitMs
  ) {
    problems.push('limits.defaultWaitMs must not exceed limits.maxWaitMs')
  }
  if (problems.length > 0) {
    throw new GatewayError('invalid-argument', problems.join('; '), { problems })
  }
  return settings
}

/** Validate a complete settings object and return the parsed value. */
export function validateSettings(value) {
  const parsed = settingsSchema.safeParse(value)
  if (!parsed.success) {
    throw new GatewayError(
      'invalid-argument',
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    )
  }
  return customValidation(parsed.data)
}

/**
 * Migrate a v1 document (permissions + fullAccess) to v2.
 * @returns {{settings: object, migrated: boolean}}
 */
export function migrateLegacySettings(document) {
  if (!plainObject(document)) throw new GatewayError('invalid-argument', 'settings must be an object')
  if (document.schemaVersion === SETTINGS_SCHEMA_VERSION && plainObject(document.capabilities)) {
    return { settings: document, migrated: false }
  }
  const legacyPermissions = plainObject(document.permissions) ? document.permissions : {}
  const capabilities = {}
  for (const key of CAPABILITY_KEYS) {
    if (typeof legacyPermissions[key] === 'boolean') {
      capabilities[key] = legacyPermissions[key]
    } else {
      capabilities[key] = CAPABILITIES[key].level === 'basic'
    }
  }
  // The old "ask a session a question" ability maps onto the new ask interface.
  if (legacyPermissions.sendMessages === true) capabilities.askDsh = true
  if (document.fullAccess === true) capabilities.askDsh = true
  const limits = { ...DEFAULT_LIMITS, ...(plainObject(document.limits) ? document.limits : {}) }
  delete limits.fullAccess
  return {
    migrated: true,
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      approvalMode: document.fullAccess === true ? 'open' : DEFAULT_APPROVAL_MODE,
      capabilities,
      scope: plainObject(document.scope) ? document.scope : defaultSettings().scope,
      limits,
      server: plainObject(document.server) ? document.server : defaultSettings().server,
      onboarding: plainObject(document.onboarding)
        ? document.onboarding
        : defaultSettings().onboarding,
    },
  }
}

/**
 * Merge an API patch into current settings. Unknown fields are rejected by the
 * full strict schema after the merge.
 */
export function mergeSettingsPatch(current, patch) {
  if (!plainObject(patch)) {
    throw new GatewayError('invalid-argument', 'patch must be an object', { field: 'patch' })
  }
  const allowed = new Set(['approvalMode', 'capabilities', 'scope', 'limits', 'server', 'onboarding'])
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new GatewayError('invalid-argument', `unknown settings field(s): ${unknown.join(', ')}`, {
      fields: unknown,
    })
  }
  const next = structuredClone(current)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'approvalMode') {
      if (typeof value !== 'string') {
        throw new GatewayError('invalid-argument', 'approvalMode must be a string', {
          field: 'approvalMode',
        })
      }
      next.approvalMode = value
      continue
    }
    if (!plainObject(value)) {
      throw new GatewayError('invalid-argument', `${key} must be an object`, { field: key })
    }
    if (Object.keys(value).some((nested) => nested === '__proto__' || nested === 'constructor')) {
      throw new GatewayError('invalid-argument', `${key} contains an invalid field`, { field: key })
    }
    next[key] = { ...next[key], ...value }
  }
  return validateSettings(next)
}

function detached(value) {
  return structuredClone(value)
}

function detachedSnapshot(state) {
  return {
    revision: state.revision,
    updatedAt: state.updatedAt,
    settings: detached(state.settings),
    warnings: [...state.warnings],
  }
}

/**
 * Serialized, revisioned settings store.
 */
export class SettingsStore {
  constructor(options = {}) {
    this.filePath = options.filePath ?? resolveSettingsPath()
    this.now = options.now ?? Date.now
    this.logger = options.logger ?? console
    this.elevatedWriter = options.elevatedWriter === undefined
      ? writeSettingsElevated
      : options.elevatedWriter
    this.state = undefined
    this.queue = Promise.resolve()
  }

  get directory() {
    return path.dirname(this.filePath)
  }

  async load() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }).catch(() => {})
    const warnings = []
    let raw = null
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    if (raw === null) {
      const settings = defaultSettings()
      settings.server.token = generateToken()
      this.state = {
        revision: 1,
        updatedAt: this.now(),
        settings: validateSettings(settings),
        warnings,
      }
      await this.#persist()
      this.logger.info?.(`[dsh-mcp-gateway] created settings at ${this.filePath}`)
      return detachedSnapshot(this.state)
    }

    let parsed
    let migrated = false
    let shouldPersist = false
    try {
      const document = JSON.parse(raw)
      const migration = migrateLegacySettings(document)
      migrated = migration.migrated
      shouldPersist = migrated
      const file = settingsFileSchema.parse({
        ...migration.settings,
        revision: Number.isSafeInteger(document.revision) ? document.revision : 0,
        updatedAt: Number.isSafeInteger(document.updatedAt) ? document.updatedAt : this.now(),
      })
      parsed = {
        revision: file.revision,
        updatedAt: file.updatedAt,
        settings: customValidation({
          schemaVersion: file.schemaVersion,
          approvalMode: file.approvalMode,
          capabilities: file.capabilities,
          scope: file.scope,
          limits: file.limits,
          server: file.server,
          onboarding: file.onboarding,
        }),
        warnings,
      }
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${this.now()}`
      await fs.copyFile(this.filePath, backup).catch(() => {})
      warnings.push(
        `settings file was invalid and has been backed up to ${backup}; defaults were restored (${error instanceof Error ? error.message : String(error)})`,
      )
      this.logger.warn?.(`[dsh-mcp-gateway] ${warnings.at(-1)}`)
      const settings = defaultSettings()
      settings.server.token = generateToken()
      parsed = {
        revision: 1,
        updatedAt: this.now(),
        settings: validateSettings(settings),
        warnings,
      }
      migrated = false
      shouldPersist = true
    }

    if (!parsed.settings.server.token) {
      parsed.settings.server.token = generateToken()
      parsed.revision += 1
      parsed.updatedAt = this.now()
      warnings.push('settings token was missing and has been regenerated')
      shouldPersist = true
    }
    if (migrated) {
      parsed.revision += 1
      parsed.updatedAt = this.now()
      warnings.push(
        'settings migrated from the legacy permission/fullAccess model to approvalMode + three-level capabilities',
      )
    }
    if (shouldPersist) await this.#persistValue(parsed)

    this.state = parsed
    return detachedSnapshot(this.state)
  }

  snapshot() {
    if (this.state === undefined) throw new GatewayError('internal', 'settings are not loaded')
    return detachedSnapshot(this.state)
  }

  current() {
    if (this.state === undefined) throw new GatewayError('internal', 'settings are not loaded')
    return this.state.settings
  }

  update(patch, expectedRevision) {
    return this.#enqueue(async () => {
      this.#expectRevision(expectedRevision)
      const previous = this.state
      const settings = mergeSettingsPatch(this.current(), patch)
      this.state = {
        revision: this.state.revision + 1,
        updatedAt: this.now(),
        settings,
        warnings: [...this.state.warnings],
      }
      try {
        await this.#persist()
      } catch (error) {
        // The OS denied the file write: keep the in-memory revision and
        // settings aligned with the file that is still on disk.
        this.state = previous
        throw error
      }
      return this.snapshot()
    })
  }

  setOnboarding(input, expectedRevision) {
    if (!plainObject(input)) {
      throw new GatewayError('invalid-argument', 'onboarding body must be an object')
    }
    const patch = {}
    for (const [field, key] of [
      ['shown', 'shownAt'],
      ['acknowledged', 'acknowledgedAt'],
    ]) {
      if (input[field] === undefined) continue
      if (typeof input[field] !== 'boolean') {
        throw new GatewayError('invalid-argument', `${field} must be a boolean`, { field })
      }
      patch[key] = input[field] ? this.now() : null
    }
    if (Object.keys(patch).length === 0) {
      throw new GatewayError('invalid-argument', 'onboarding requires shown or acknowledged')
    }
    return this.update({ onboarding: patch }, expectedRevision)
  }

  rotateToken(expectedRevision) {
    return this.update({ server: { token: generateToken() } }, expectedRevision)
  }

  resetSettings(expectedRevision) {
    const defaults = resettableDefaults()
    return this.update(
      {
        approvalMode: defaults.approvalMode,
        capabilities: defaults.capabilities,
        scope: defaults.scope,
        limits: defaults.limits,
      },
      expectedRevision,
    )
  }

  #expectRevision(expectedRevision) {
    if (expectedRevision === undefined) return
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new GatewayError('invalid-argument', 'revision must be a non-negative integer', {
        field: 'revision',
      })
    }
    if (expectedRevision !== this.state.revision) {
      throw new GatewayError('revision-conflict', 'settings changed elsewhere; reload and retry', {
        expected: expectedRevision,
        actual: this.state.revision,
      })
    }
  }

  #enqueue(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async #persist() {
    await this.#persistValue(this.state)
  }

  async #persistValue(state) {
    const document = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      revision: state.revision,
      updatedAt: state.updatedAt,
      approvalMode: state.settings.approvalMode,
      capabilities: state.settings.capabilities,
      scope: state.settings.scope,
      limits: state.settings.limits,
      server: state.settings.server,
      onboarding: state.settings.onboarding,
    }
    const body = `${JSON.stringify(document, null, 2)}\n`
    const temporary = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`
    try {
      await fs.writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
      try {
        await fs.rename(temporary, this.filePath)
      } catch (error) {
        try {
          await fs.rm(this.filePath, { force: true })
          await fs.rename(temporary, this.filePath)
        } catch (retryError) {
          throw retryError ?? error
        }
      }
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) {
        if (typeof this.elevatedWriter === 'function') {
          try {
            await this.elevatedWriter({ filePath: this.filePath, body, logger: this.logger })
            return
          } catch (elevationError) {
            if (elevationError instanceof GatewayError) throw elevationError
            throw new GatewayError(
              'settings-write-denied',
              `cannot write settings file "${this.filePath}": ${elevationError instanceof Error ? elevationError.message : String(elevationError)}`,
              { path: this.filePath, cause: 'elevation-failed' },
              { cause: elevationError },
            )
          }
        }
        throw new GatewayError(
          'settings-write-denied',
          `cannot write settings file "${this.filePath}": the operating system denied access; run DSH as administrator or fix the file ACL`,
          { path: this.filePath, cause: error.code },
          { cause: error },
        )
      }
      throw error
    }
    await fs.chmod(this.filePath, 0o600).catch(() => {})
  }
}

export const settingsDocumentSchema = settingsFileSchema
