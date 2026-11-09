import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings } from '../lib/defaults.js'
import {
  CAPABILITY_KEYS,
  evaluateToolAccess,
  isToolVisible,
  visibleToolNames,
} from '../lib/capabilities.js'

function withMode(mode, caps = {}) {
  const base = defaultSettings()
  base.approvalMode = mode
  Object.assign(base.capabilities, caps)
  return base
}

test('default settings grant only the basic capability level', () => {
  const settings = defaultSettings()
  assert.equal(settings.approvalMode, 'only-checked')
  const checked = CAPABILITY_KEYS.filter((key) => settings.capabilities[key] === true)
  assert.deepEqual(checked, [
    'listSessions',
    'readSessions',
    'sendMessages',
    'waitForCompletion',
    'askDsh',
  ])
  assert.deepEqual(visibleToolNames(settings), [
    'list_sessions',
    'read_session',
    'send_message',
    'wait_for_completion',
    'ask_dsh',
  ])
})

test('only-checked denies unchecked capabilities and requires approval for checked ones', () => {
  const settings = defaultSettings()
  assert.deepEqual(evaluateToolAccess(settings, 'list_sessions'), {
    allowed: true,
    approval: true,
    capability: 'listSessions',
  })
  assert.equal(evaluateToolAccess(settings, 'create_session').allowed, false)
  assert.equal(evaluateToolAccess(settings, 'create_session').reason, 'capability-not-granted')
  assert.equal(isToolVisible(settings, 'create_session'), false)
})

test('except-checked auto-allows checked capabilities and approves unchecked ones', () => {
  const settings = withMode('except-checked')
  assert.equal(evaluateToolAccess(settings, 'list_sessions').approval, false)
  const created = evaluateToolAccess(settings, 'create_session')
  assert.equal(created.allowed, true)
  assert.equal(created.approval, true)
  assert.equal(visibleToolNames(settings).length, 23)
})

test('all mode approves every call and open mode ignores list/approvals', () => {
  const all = withMode('all')
  assert.equal(evaluateToolAccess(all, 'list_sessions').approval, true)
  assert.equal(evaluateToolAccess(all, 'create_session').allowed, true)
  assert.equal(evaluateToolAccess(all, 'create_session').approval, true)

  const open = withMode('open')
  assert.deepEqual(evaluateToolAccess(open, 'plugin_install'), {
    allowed: true,
    approval: false,
    capability: 'managePlugins',
  })
  assert.equal(visibleToolNames(open).length, 23)
})

test('ask_dsh requires the ask, send and wait capabilities together', () => {
  const settings = defaultSettings()
  settings.capabilities.sendMessages = false
  assert.equal(isToolVisible(settings, 'ask_dsh'), false)
  settings.approvalMode = 'open'
  assert.equal(isToolVisible(settings, 'ask_dsh'), true)
  assert.equal(evaluateToolAccess(settings, 'ask_dsh').approval, false)
})
