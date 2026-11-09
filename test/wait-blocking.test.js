import assert from 'node:assert/strict'
import test from 'node:test'
import { GatewayBridge } from '../lib/bridge.js'
import { defaultSettings } from '../lib/defaults.js'

function makeBridge() {
  const settings = defaultSettings()
  settings.scope.sessionMode = 'all'
  settings.scope.modelMode = 'all'
  const handlers = new Map()
  const events = []
  const agent = {
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
    whenIdle: async () => {},
  }
  const agents = new Map([['session-1', agent]])
  const ctx = {
    get(name) {
      if (name === 'agents') return agents
      if (name === 'sessionQuery') {
        return {
          readSurface: async () => ({
            events,
            capturedThroughSeq: events.length ? events[events.length - 1].seq : 0,
          }),
        }
      }
      if (name === 'sessionController') {
        return {
          inspect: async () => ({
            meta: { id: 'session-1', sessionId: 'session-1', origin: null, cwd: 'E:\\work' },
            events: [],
          }),
        }
      }
      return undefined
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler)
      return () => {
        const list = handlers.get(event) ?? []
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
  }
  const bridge = new GatewayBridge({
    ctx,
    store: { current: () => settings },
    logger: { info() {}, warn() {} },
  })
  return { bridge, handlers, events, agent }
}

test('expectTurn waits for a turn/end instead of returning idle immediately', async () => {
  const { bridge, handlers, events, agent } = makeBridge()
  let settled = false
  const pending = bridge
    .waitForCompletion({ sessionId: 'session-1', sinceSeq: 0, timeoutMs: 2000 }, undefined, {
      expectTurn: true,
    })
    .then((result) => {
      settled = true
      return result
    })

  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(settled, false, 'wait must not return while the turn has not completed')

  const emit = (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }
  agent.status = 'running'
  emit('agent/status', { agent: { id: 'session-1', status: 'running' } })
  const addEvent = (event) => {
    events.push(event)
    emit('session/event', { id: 'session-1' }, event)
  }
  addEvent({ type: 'turn/start', seq: 1 })
  addEvent({ type: 'assistant/message', seq: 2, text: 'blocked-reply' })
  addEvent({ type: 'turn/end', seq: 3, reason: 'completed' })
  agent.status = 'idle'
  emit('agent/status', { agent: { id: 'session-1', status: 'idle' } })

  const result = await pending
  assert.equal(result.status, 'idle')
  assert.equal(result.completedTurns, 1)
})
