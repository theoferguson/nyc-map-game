import { test, expect, beforeEach } from 'vitest'
import { GET, POST } from '../api/config.ts'
import { DEFAULTS, toPublic } from '../src/game/config.ts'

beforeEach(() => {
  delete process.env.DATABASE_URL
  process.env.ADMIN_TOKEN = 'test-token'
})

const post = (body: unknown, token?: string) =>
  POST(
    new Request('https://x/api/config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-admin-token': token } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

test('reads fall back to defaults rather than failing the boot path', async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ version: 0, config: toPublic(DEFAULTS) })
})

test('the public config never carries the beta code', async () => {
  // The gate is worthless if the answer ships with the question. This is the
  // assertion, not a comment: any future field added under beta has to be
  // deliberately let through toPublic.
  const body = (await (await GET()).json()) as { config: { beta: Record<string, unknown> } }
  expect(Object.keys(body.config.beta)).toEqual(['daysAhead'])
  expect(JSON.stringify(body)).not.toContain(DEFAULTS.beta.code)
})

test('a write without the token is refused', async () => {
  expect((await post(DEFAULTS)).status).toBe(401)
  expect((await post(DEFAULTS, 'wrong')).status).toBe(401)
  // A token of a different length must fail like any other wrong one, not throw.
  expect((await post(DEFAULTS, 'x')).status).toBe(401)
})

test('no token configured means no write is possible', async () => {
  delete process.env.ADMIN_TOKEN
  expect((await post(DEFAULTS, 'test-token')).status).toBe(401)
})

test('a write refuses invalid values instead of quietly correcting them', async () => {
  const res = await post({ scoring: { falloff: 99 } }, 'test-token')
  expect(res.status).toBe(400)
  const body = (await res.json()) as { problems: string[] }
  expect(body.problems).toHaveLength(1)
})

test('a valid write gets as far as the database', async () => {
  // 503, not 400: the document was accepted and there was nowhere to put it.
  expect((await post(DEFAULTS, 'test-token')).status).toBe(503)
})
