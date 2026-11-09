import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings } from '../lib/defaults.js'
import {
  assertMessageLength,
  assertModelAllowed,
  assertPresetAllowed,
  assertSessionAllowed,
  isPathInside,
  parseModelKey,
  readLimit,
  resolveCreateCwd,
  selectionKey,
  sessionInScope,
  waitTimeout,
} from '../lib/permissions.js'

function settingsWith(patch = {}) {
  const base = defaultSettings()
  return {
    ...base,
    ...patch,
    capabilities: { ...base.capabilities, ...(patch.capabilities ?? {}) },
    scope: { ...base.scope, ...(patch.scope ?? {}) },
    limits: { ...base.limits, ...(patch.limits ?? {}) },
  }
}

test('session scope supports all/allowlist/except/none', () => {
  const allowlist = settingsWith({
    scope: { sessionMode: 'allowlist', sessionIds: ['session-a'] },
  })
  assert.doesNotThrow(() => assertSessionAllowed(allowlist, { id: 'session-a' }))
  assert.throws(
    () => assertSessionAllowed(allowlist, { id: 'session-b' }),
    (error) => error.code === 'session-scope-denied',
  )
  const except = settingsWith({
    scope: { sessionMode: 'except', sessionIds: ['session-a'] },
  })
  assert.throws(
    () => assertSessionAllowed(except, { id: 'session-a' }),
    (error) => error.code === 'session-scope-denied',
  )
  assert.doesNotThrow(() => assertSessionAllowed(except, { id: 'session-b' }))
  const none = settingsWith({ scope: { sessionMode: 'none' } })
  assert.equal(sessionInScope(none, { id: 'session-a' }), false)
  assert.throws(
    () => assertSessionAllowed(none, { id: 'session-a' }),
    (error) => error.code === 'session-scope-denied',
  )
  const subs = settingsWith({ scope: { includeSubagents: true } })
  assert.doesNotThrow(() =>
    assertSessionAllowed(subs, { id: 'child', origin: 'subagent', parentSession: 'parent' }),
  )
  const noSubs = defaultSettings()
  assert.throws(
    () => assertSessionAllowed(noSubs, { id: 'child', origin: 'subagent' }),
    (error) => error.code === 'session-scope-denied',
  )
})

test('model scope supports all/allowlist/except/none', () => {
  assert.deepEqual(parseModelKey('deepseek-account/deepseek-flash'), {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
  })
  assert.equal(parseModelKey('nope'), null)
  assert.equal(selectionKey({ provider: 'p', model: 'm' }), 'p/m')
  const allowlist = settingsWith({
    scope: { modelMode: 'allowlist', allowedModels: ['p/m'] },
  })
  assert.doesNotThrow(() => assertModelAllowed(allowlist, 'p/m'))
  assert.throws(
    () => assertModelAllowed(allowlist, 'p/other'),
    (error) => error.code === 'permission-denied',
  )
  const except = settingsWith({
    scope: { modelMode: 'except', allowedModels: ['p/m'] },
  })
  assert.throws(
    () => assertModelAllowed(except, 'p/m'),
    (error) => error.code === 'permission-denied',
  )
  assert.doesNotThrow(() => assertModelAllowed(except, 'p/other'))
  const none = settingsWith({ scope: { modelMode: 'none' } })
  assert.throws(
    () => assertModelAllowed(none, 'p/m'),
    (error) => error.code === 'permission-denied',
  )
})

test('danger-full-access requires open mode and auto is never selectable', () => {
  const normal = defaultSettings()
  assert.throws(
    () => assertPresetAllowed(normal, 'danger-full-access', ['workspace-write', 'danger-full-access']),
    (error) => error.code === 'permission-denied',
  )
  assert.doesNotThrow(() =>
    assertPresetAllowed(
      settingsWith({ approvalMode: 'open' }),
      'danger-full-access',
      ['workspace-write', 'danger-full-access'],
    ),
  )
  assert.throws(
    () => assertPresetAllowed(normal, 'auto', ['auto', 'workspace-write']),
    (error) => error.code === 'preset-unavailable',
  )
  assert.throws(
    () => assertPresetAllowed(normal, 'missing', ['workspace-write']),
    (error) => error.code === 'preset-unavailable',
  )
})

test('create cwd is restricted unless open mode', () => {
  const normal = defaultSettings()
  assert.throws(
    () => resolveCreateCwd(normal, 'C:\\outside'),
    (error) => error.code === 'session-scope-denied',
  )
  const allowed = settingsWith({ scope: { allowedRoots: ['C:\\work'] } })
  assert.equal(resolveCreateCwd(allowed, 'C:\\work\\project'), 'C:\\work\\project')
  assert.throws(
    () => resolveCreateCwd(allowed, 'C:\\work2\\project'),
    (error) => error.code === 'session-scope-denied',
  )
  assert.equal(
    resolveCreateCwd(settingsWith({ approvalMode: 'open' }), 'C:\\anything'),
    'C:\\anything',
  )
  assert.equal(isPathInside('C:\\work', 'C:\\work\\a'), true)
  assert.equal(isPathInside('C:\\work', 'C:\\workshop'), false)
  assert.equal(resolveCreateCwd(defaultSettings(), undefined, 'C:\\default'), 'C:\\default')
  assert.equal(resolveCreateCwd(defaultSettings(), 'C:\\default\\a', 'C:\\default'), 'C:\\default\\a')
  assert.equal(
    resolveCreateCwd(defaultSettings(), undefined, 'C:\\default', ['C:\\existing']),
    'C:\\existing',
  )
  assert.equal(
    resolveCreateCwd(defaultSettings(), 'C:\\existing\\a', 'C:\\default', ['C:\\existing']),
    'C:\\existing\\a',
  )
  assert.throws(
    () => resolveCreateCwd(defaultSettings(), 'C:\\outside', 'C:\\default', ['C:\\existing']),
    (error) => error.code === 'session-scope-denied' && error.details.allowedRoots.includes('C:\\existing'),
  )
})

test('limits are clamped for positive values and ignored for negative values', () => {
  const unlimited = defaultSettings()
  assert.equal(readLimit(unlimited), Number.POSITIVE_INFINITY)
  assert.equal(readLimit(unlimited, 1000), 1000)
  assert.equal(waitTimeout(unlimited), Number.POSITIVE_INFINITY)
  assert.equal(waitTimeout(unlimited, 1_000_000), 1_000_000)
  assert.doesNotThrow(() => assertMessageLength(unlimited, 'x'.repeat(200_000)))

  const bounded = defaultSettings()
  bounded.limits.maxReadMessages = 100
  bounded.limits.maxWaitMs = 180000
  bounded.limits.defaultWaitMs = 45000
  bounded.limits.maxMessageChars = 100000
  assert.equal(readLimit(bounded, 1000), 100)
  assert.throws(() => readLimit(bounded, 0), (error) => error.code === 'invalid-argument')
  assert.equal(waitTimeout(bounded, 1), 1)
  assert.equal(waitTimeout(bounded, 1_000_000), 180000)
  assert.throws(() => assertMessageLength(bounded, 'x'.repeat(100001)), (error) => {
    return error.code === 'invalid-argument' && error.details.max === 100000
  })
})
