import { test, expect, beforeEach } from 'vitest'
import { POST } from '../api/tally.ts'

beforeEach(() => {
  delete process.env.DATABASE_URL
})

const post = (body: unknown) =>
  POST(
    new Request('https://x/api/tally', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

test('a well-formed count is accepted', async () => {
  expect((await post({ kind: 'complete', date: '2026-08-26' })).status).toBe(204)
})

test('only the counters we defined exist', async () => {
  // An open `kind` would turn a counter into a free-text table written by the
  // internet, which is the thing this endpoint is small enough to avoid.
  for (const kind of ['load', 'anything', '', 'complete; drop table']) {
    expect((await post({ kind, date: '2026-08-26' })).status).toBe(400)
  }
})

test('the date is validated before it reaches SQL', async () => {
  for (const date of ['today', '2026-8-1', "2026-08-26'--", '']) {
    expect((await post({ kind: 'complete', date })).status).toBe(400)
  }
})

test('junk is refused', async () => {
  expect((await post('not json')).status).toBe(400)
  expect((await post({ kind: 'complete', date: '2026-08-26', pad: 'x'.repeat(400) })).status).toBe(413)
})
