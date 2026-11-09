import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEventsView, buildTranscript, turnEndReason } from '../lib/format.js'

const base = { time: 1_700_000_000_000 }

const events = [
  {
    ...base,
    seq: 0,
    type: 'system/message',
    data: { message: { role: 'system', content: [{ type: 'text', text: 'SECRET SYSTEM PROMPT' }] } },
  },
  {
    ...base,
    seq: 1,
    type: 'user/message',
    data: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    },
  },
  {
    ...base,
    seq: 2,
    type: 'assistant/message',
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'internal thought' },
          { type: 'text', text: 'answer' },
          { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' },
          { type: 'image', attachment: { attachmentId: 'sha256:abc', name: 'x.png', mediaType: 'image/png' } },
        ],
      },
      stream: { huge: 'not returned' },
    },
  },
  {
    ...base,
    seq: 3,
    type: 'tool/result',
    data: {
      message: {
        role: 'tool',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'file body' }],
        isError: false,
      },
    },
  },
  {
    ...base,
    seq: 4,
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  },
  {
    ...base,
    seq: 5,
    type: 'request/header',
    data: { header: { config: { provider: 'p', model: 'm' }, tools: [] } },
  },
]

test('transcript exposes messages but not system prompt or internal headers', () => {
  const result = buildTranscript(events, { limit: 10, maxChars: 60000 })
  assert.equal(result.messages.length, 3)
  assert.equal(result.messages[0].role, 'user')
  assert.equal(result.messages[1].role, 'assistant')
  assert.match(result.messages[1].text, /answer/)
  assert.doesNotMatch(result.messages[1].text, /internal thought/)
  assert.equal(result.messages[1].toolCalls[0].name, 'read')
  assert.equal(result.messages[2].role, 'tool')
  assert.equal(result.messages[2].isError, undefined)
  assert.equal(JSON.stringify(result).includes('SECRET SYSTEM PROMPT'), false)
  assert.equal(JSON.stringify(result).includes('not returned'), false)
})

test('transcript supports thoughts, sinceSeq, tail limits and truncation', () => {
  const withThoughts = buildTranscript(events, { includeThoughts: true })
  assert.match(withThoughts.messages[1].text, /internal thought/)
  const incremental = buildTranscript(events, { sinceSeq: 1 })
  assert.deepEqual(
    incremental.messages.map((entry) => entry.seq),
    [2, 3],
  )
  const tail = buildTranscript(events, { limit: 1 })
  assert.equal(tail.messages[0].seq, 3)
  assert.equal(tail.omittedBefore, 2)
  const clipped = buildTranscript(events, { maxChars: 5 })
  assert.equal(clipped.truncated, true)
})

test('event view only returns allowed types and redacts large values', () => {
  const result = buildEventsView(events, { limit: 20, maxChars: 60000 })
  const types = result.events.map((event) => event.type)
  assert.deepEqual(types, ['user/message', 'assistant/message', 'tool/result', 'turn/end'])
  assert.equal(JSON.stringify(result).includes('SECRET SYSTEM PROMPT'), false)
  assert.equal(JSON.stringify(result).includes('request/header'), false)
  assert.equal(result.cursor.lastSeq, 5)
})

test('turn end reason is compacted', () => {
  assert.deepEqual(turnEndReason(events[4]), { kind: 'completed' })
  assert.equal(turnEndReason(events[0]), null)
})
