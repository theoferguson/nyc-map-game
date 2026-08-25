import { test, expect, beforeEach } from 'vitest'
import { GET } from '../api/puzzle.ts'

beforeEach(() => {
  delete process.env.DATABASE_URL
})

const get = (query: string) => GET(new Request(`https://x/api/puzzle?${query}`))

test('no database is a 503, never an open door', async () => {
  expect((await get('date=2026-09-01')).status).toBe(503)
})

test('a malformed date is refused before anything is looked up', async () => {
  process.env.DATABASE_URL = 'postgres://unused'
  for (const bad of ['date=tomorrow', 'date=2026-9-1', "date=2026-09-01'--", 'date=']) {
    expect((await get(bad)).status).toBe(400)
  }
})
