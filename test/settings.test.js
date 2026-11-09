import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SettingsStore,
  generateToken,
  mergeSettingsPatch,
  migrateLegacySettings,
  resolveSettingsPath,
  settingsSchema,
  validateSettings,
} from '../lib/settings.js'
import { DEFAULT_LIMITS, defaultSettings } from '../lib/defaults.js'

async function tempStore(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-gateway-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const store = new SettingsStore({
    filePath,
    logger: { info() {}, warn() {}, error() {} },
    elevatedWriter: null,
    ...options,
  })
  return { directory, filePath, store }
}

test('first load creates a v2 settings file with basic capabilities and a token', async (t) => {
  const { filePath, store } = await tempStore(t)
  const snapshot = await store.load()
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.settings.schemaVersion, 2)
  assert.equal(snapshot.settings.approvalMode, 'only-checked')
  assert.equal(snapshot.settings.capabilities.listSessions, true)
  assert.equal(snapshot.settings.capabilities.askDsh, true)
  assert.equal(snapshot.settings.capabilities.createSessions, false)
  assert.equal(snapshot.settings.capabilities.managePlugins, false)
  assert.match(snapshot.settings.server.token, /^dshmcp_[A-Za-z0-9_-]{20,}$/)
  assert.equal(snapshot.settings.limits.approvalTimeoutMs, DEFAULT_LIMITS.approvalTimeoutMs)
  assert.equal(snapshot.settings.limits.maxReadMessages, -1)
  assert.equal(snapshot.settings.limits.defaultWaitMs, -1)
  assert.equal(snapshot.settings.limits.maxWaitMs, -1)
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
  assert.equal(parsed.schemaVersion, 2)
  assert.equal(parsed.server.token, snapshot.settings.server.token)
})

test('legacy v1 permissions and fullAccess migrate to v2', async (t) => {
  const { filePath, store } = await tempStore(t)
  const legacy = {
    schemaVersion: 1,
    revision: 7,
    updatedAt: 1,
    permissions: {
      listSessions: true,
      readSessions: true,
      sendMessages: true,
      waitForCompletion: true,
      listModels: false,
      createSessions: false,
      selectModel: false,
      setPermission: false,
      cancelTurns: false,
      forkSessions: false,
      renameSessions: false,
    },
    fullAccess: true,
    scope: defaultSettings().scope,
    limits: {
      maxReadMessages: 100,
      maxReadChars: 60000,
      maxMessageChars: 100000,
      defaultWaitMs: 45000,
      maxWaitMs: 180000,
      sendWhenBusy: 'queue',
    },
    server: { enabled: true, token: 'dshmcp_legacy_token_1234567890', allowNonLoopback: false, instructions: '' },
    onboarding: { shownAt: 1, acknowledgedAt: 2 },
  }
  await fs.writeFile(filePath, JSON.stringify(legacy), 'utf8')
  const snapshot = await store.load()
  assert.equal(snapshot.settings.schemaVersion, 2)
  assert.equal(snapshot.settings.approvalMode, 'open')
  assert.equal(snapshot.settings.capabilities.listSessions, true)
  assert.equal(snapshot.settings.capabilities.askDsh, true)
  assert.equal(snapshot.settings.capabilities.manageSettings, false)
  assert.equal(snapshot.settings.server.token, legacy.server.token)
  assert.equal(snapshot.settings.onboarding.acknowledgedAt, 2)
  assert.equal(snapshot.settings.limits.approvalTimeoutMs, DEFAULT_LIMITS.approvalTimeoutMs)
  assert.ok(snapshot.warnings.some((warning) => /migrat/i.test(warning)))
})

test('legacy v1 without fullAccess migrates to only-checked', () => {
  const migration = migrateLegacySettings({
    schemaVersion: 1,
    permissions: { listSessions: true, sendMessages: false },
    fullAccess: false,
    scope: defaultSettings().scope,
    limits: defaultSettings().limits,
    server: defaultSettings().server,
    onboarding: defaultSettings().onboarding,
  })
  assert.equal(migration.migrated, true)
  assert.equal(migration.settings.approvalMode, 'only-checked')
  assert.equal(migration.settings.capabilities.createSessions, false)
})

test('updates persist and revision conflicts are rejected', async (t) => {
  const { store } = await tempStore(t)
  await store.load()
  const next = await store.update(
    { approvalMode: 'except-checked', capabilities: { createSessions: true } },
    1,
  )
  assert.equal(next.revision, 2)
  assert.equal(next.settings.approvalMode, 'except-checked')
  assert.equal(next.settings.capabilities.createSessions, true)
  await assert.rejects(
    () => store.update({ approvalMode: 'open' }, 1),
    (error) => error.code === 'revision-conflict',
  )
})

test('invalid patches are rejected without changing the document', async (t) => {
  const { store } = await tempStore(t)
  await store.load()
  await assert.rejects(
    () => store.update({ capabilities: { listModels: 'yes' } }, 1),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => store.update({ nope: true }, 1),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => store.update({ limits: { maxReadMessages: 9999 } }, 1),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => store.update({ approvalMode: 'sometimes' }, 1),
    (error) => error.code === 'invalid-argument',
  )
  assert.equal(store.snapshot().revision, 1)
})

test('token rotation and onboarding transitions persist', async (t) => {
  const { store } = await tempStore(t)
  const first = await store.load()
  const rotated = await store.rotateToken(first.revision)
  assert.notEqual(rotated.settings.server.token, first.settings.server.token)
  const shown = await store.setOnboarding({ shown: true }, rotated.revision)
  assert.equal(typeof shown.settings.onboarding.shownAt, 'number')
  const acknowledged = await store.setOnboarding({ acknowledged: true }, shown.revision)
  assert.equal(typeof acknowledged.settings.onboarding.acknowledgedAt, 'number')
  const again = await store.setOnboarding({ shown: false }, acknowledged.revision)
  assert.equal(again.settings.onboarding.shownAt, null)
})

test('restore defaults keeps token and onboarding', async (t) => {
  const { store } = await tempStore(t)
  const first = await store.load()
  const changed = await store.update(
    {
      approvalMode: 'open',
      capabilities: { createSessions: true, managePlugins: true },
      scope: { defaultCwd: 'C:\\' },
    },
    first.revision,
  )
  const reset = await store.resetSettings(changed.revision)
  assert.equal(reset.settings.approvalMode, 'only-checked')
  assert.equal(reset.settings.capabilities.createSessions, false)
  assert.equal(reset.settings.capabilities.managePlugins, false)
  assert.equal(reset.settings.server.token, first.settings.server.token)
  assert.equal(reset.settings.onboarding.shownAt, first.settings.onboarding.shownAt)
})

test('a corrupt settings file is backed up and replaced', async (t) => {
  const { directory, filePath, store } = await tempStore(t)
  await fs.writeFile(filePath, '{not json', 'utf8')
  const snapshot = await store.load()
  assert.equal(snapshot.revision, 1)
  assert.match(snapshot.warnings[0], /backed up/)
  const files = await fs.readdir(directory)
  assert.ok(files.some((name) => name.includes('.corrupt-')))
})

test('validateSettings rejects relative roots and invalid model keys', () => {
  const base = defaultSettings()
  base.server.token = generateToken()
  assert.throws(
    () => validateSettings({ ...base, scope: { ...base.scope, allowedRoots: ['relative'] } }),
    (error) => error.code === 'invalid-argument',
  )
  assert.throws(
    () => validateSettings({ ...base, scope: { ...base.scope, defaultModel: 'no-slash' } }),
    (error) => error.code === 'invalid-argument',
  )
  assert.doesNotThrow(() => settingsSchema.parse(base))
  assert.doesNotThrow(() => validateSettings(base))

  const unlimited = defaultSettings()
  unlimited.server.token = generateToken()
  unlimited.limits.maxReadMessages = -5
  unlimited.limits.maxReadChars = -1
  unlimited.limits.maxMessageChars = -1
  unlimited.limits.defaultWaitMs = -2
  unlimited.limits.maxWaitMs = -1
  unlimited.limits.approvalTimeoutMs = -1
  assert.doesNotThrow(() => validateSettings(unlimited))

  const zero = defaultSettings()
  zero.server.token = generateToken()
  zero.limits.maxReadMessages = 0
  assert.throws(() => validateSettings(zero), (error) => error.code === 'invalid-argument')
})

test('a directory ACL that denies writes becomes settings-write-denied', { skip: process.platform !== 'win32' }, async (t) => {
  const { directory, store } = await tempStore(t)
  await store.load()
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME}`
  execFileSync('icacls', [
    directory,
    '/inheritance:r',
    '/grant:r',
    '*S-1-5-32-544:(F)',
    '*S-1-5-18:(F)',
    `${user}:(RX)`,
  ])
  try {
    await assert.rejects(
      store.update({ limits: { maxReadMessages: 42 } }, 1),
      (error) => error.code === 'settings-write-denied' && error.details.cause !== undefined,
    )
    assert.equal(store.snapshot().revision, 1)
    assert.equal(store.current().limits.maxReadMessages, DEFAULT_LIMITS.maxReadMessages)
  } finally {
    execFileSync('icacls', [directory, '/reset'])
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

test('a directory ACL invokes the injected elevated writer', { skip: process.platform !== 'win32' }, async (t) => {
  const { directory, filePath } = await tempStore(t)
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME}`
  const store = new SettingsStore({
    filePath,
    logger: { info() {}, warn() {}, error() {} },
    elevatedWriter: async ({ body }) => {
      // Simulate the elevated helper by restoring write access and writing the
      // exact candidate body. The real helper does this under UAC.
      execFileSync('icacls', [directory, '/reset'])
      await fs.writeFile(filePath, body, 'utf8')
    },
  })
  await store.load()
  execFileSync('icacls', [
    directory,
    '/inheritance:r',
    '/grant:r',
    '*S-1-5-32-544:(F)',
    '*S-1-5-18:(F)',
    `${user}:(RX)`,
  ])
  try {
    const snapshot = await store.update({ limits: { maxReadMessages: 42 } }, 1)
    assert.equal(snapshot.revision, 2)
    assert.equal(snapshot.settings.limits.maxReadMessages, 42)
    const written = JSON.parse(await fs.readFile(filePath, 'utf8'))
    assert.equal(written.revision, 2)
    assert.equal(written.limits.maxReadMessages, 42)
  } finally {
    execFileSync('icacls', [directory, '/reset'])
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

test('mergeSettingsPatch merges capabilities and keeps unrelated values', () => {
  const base = defaultSettings()
  base.server.token = generateToken()
  const merged = mergeSettingsPatch(base, {
    capabilities: { listModels: true, managePlugins: true },
    approvalMode: 'except-checked',
  })
  assert.equal(merged.capabilities.listModels, true)
  assert.equal(merged.capabilities.listSessions, true)
  assert.equal(merged.approvalMode, 'except-checked')
  assert.equal(merged.server.enabled, true)
})

test('settings path follows DSH_HOME', () => {
  assert.equal(
    resolveSettingsPath({ DSH_HOME: 'D:\\.dsh-home' }),
    path.join('D:\\.dsh-home', 'dsh-mcp-gateway', 'settings.json'),
  )
  assert.match(generateToken(), /^dshmcp_/)
})
