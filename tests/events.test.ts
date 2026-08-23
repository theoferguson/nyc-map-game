import { test, expect } from 'vitest'
import { POST } from '../api/events.ts'

// No DATABASE_URL in the test environment, which is the point: 503 means the
// batch got all the way past validation and found nothing to write to, while
// 4xx and 204 are decided before the database is ever consulted.
delete process.env.DATABASE_URL

const post = (body: unknown) =>
  POST(
    new Request('https://x/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const valid = {
  name: 'round_complete',
  ts: 1_700_000_000_000,
  installId: 'abc',
  imagery: 'nyc-2024',
  props: { score: 80 },
}

test('a well-formed batch reaches the write', async () => {
  expect((await post({ events: [valid] })).status).toBe(503)
})

test('malformed bodies are refused outright', async () => {
  expect((await post('not json')).status).toBe(400)
  expect((await post({ events: 'nope' })).status).toBe(400)
  expect((await post({})).status).toBe(400)
})

test('an oversized batch is refused rather than truncated', async () => {
  const res = await post({ events: Array.from({ length: 101 }, () => valid) })
  expect(res.status).toBe(413)
})

// 204 rather than 503 is the assertion that matters in each of these: the
// event was dropped, so there was nothing left to write and the database was
// never reached.
test.each([
  ['an event name we do not emit', { ...valid, name: 'drop table' }],
  ['a clock outside any plausible range', { ...valid, ts: 5 }],
  ['a non-numeric timestamp', { ...valid, ts: '1700000000000' }],
  ['a missing install id', { ...valid, installId: '' }],
  ['an install id long enough to be a payload', { ...valid, installId: 'x'.repeat(65) }],
  ['props that are not an object', { ...valid, props: [1, 2, 3] }],
  ['props larger than any real event', { ...valid, props: { pad: 'x'.repeat(2001) } }],
])('drops %s', async (_label, event) => {
  expect((await post({ events: [event] })).status).toBe(204)
})

test('one bad event does not cost the good ones', async () => {
  const res = await post({ events: [{ ...valid, name: 'bogus' }, valid] })
  expect(res.status).toBe(503)
})

/**
 * Everything under api/ becomes a serverless function, which is why these
 * tests live here and not beside the code they cover. The first attempt kept
 * them in api/ and excluded them with a `.vercelignore` of `*.test.ts` -- which
 * also stripped every test in src/, so the build's own gate found no test files
 * at all and exited 1. A directory Vercel does not look at costs nothing.
 */
