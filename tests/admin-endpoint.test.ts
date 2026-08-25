import { test, expect, beforeEach } from 'vitest'
import { POST as ADMIN } from '../api/admin.ts'
import { POST as BETA } from '../api/beta.ts'
import { DEFAULTS } from '../src/game/config.ts'

beforeEach(() => {
  delete process.env.DATABASE_URL
  process.env.ADMIN_TOKEN = 'test-token'
})

const admin = (token?: string) =>
  ADMIN(
    new Request('https://x/api/admin', {
      method: 'POST',
      headers: token ? { 'x-admin-token': token } : {},
    }),
  )

const beta = (body: unknown) =>
  BETA(
    new Request('https://x/api/beta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

test('the panel load is refused without the token', async () => {
  expect((await admin()).status).toBe(401)
  expect((await admin('wrong')).status).toBe(401)
  expect((await admin('x')).status).toBe(401)
})

test('a valid token returns the full config, beta code included', async () => {
  const res = await admin('test-token')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { config: typeof DEFAULTS }
  expect(body.config.beta.code).toBe(DEFAULTS.beta.code)
})

test('the beta check answers yes or no, never with the code', async () => {
  const right = await beta({ code: ` ${DEFAULTS.beta.code.toUpperCase()} ` })
  expect(right.status).toBe(200)
  expect(await right.json()).toEqual({ ok: true })

  const wrong = await beta({ code: 'not-it' })
  // 200, not 401: the status code must not confirm a guess on its own.
  expect(wrong.status).toBe(200)
  expect(await wrong.json()).toEqual({ ok: false })

  const text = await (await beta({ code: 'not-it' })).text()
  expect(text).not.toContain(DEFAULTS.beta.code)
})

test('the beta check survives junk', async () => {
  expect((await beta('not json')).status).toBe(400)
  expect(await (await beta({})).json()).toEqual({ ok: false })
  expect((await beta({ code: 'x'.repeat(2000) })).status).toBe(413)
})
