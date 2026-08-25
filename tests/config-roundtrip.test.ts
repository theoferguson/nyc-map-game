import { test, expect } from 'vitest'
import postgres from 'postgres'
import { GET, POST } from '../api/config.ts'
import { DEFAULTS } from '../src/game/config.ts'

/**
 * Opt-in, needs a real database:
 *
 *   DATABASE_URL=... ADMIN_TOKEN=... npm run check:db
 *
 * The same jsonb mistake that hit `events.props` hit this table too: handed a
 * JS string for a jsonb parameter, the driver stores a JSON *string*. Nothing
 * errored, the write reported success and echoed back the config it was given
 * -- because it echoes memory, not storage -- and every client silently got the
 * shipped defaults instead of the saved config.
 *
 * So this reads a specific value back out of a specific field. Asserting the
 * write returned 200 would have passed throughout.
 */
test.skipIf(!process.env.CHECK_EVENTS_DB)('a saved config survives a read', async () => {
  const url = process.env.DATABASE_URL
  const token = process.env.ADMIN_TOKEN
  expect(url, 'DATABASE_URL is not set').toBeTruthy()
  expect(token, 'ADMIN_TOKEN is not set').toBeTruthy()

  const sql = postgres(url!, { max: 1 })
  const [before] = await sql<{ data: unknown }[]>`select data from config where id = 1`

  try {
    const probe = {
      ...DEFAULTS,
      beta: { code: 'roundtrip-probe', daysAhead: 9 },
      locations: { 'probe-location': { factShort: 'A corrected fact.', hidden: true } },
    }
    const write = await POST(
      new Request('https://x/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': token! },
        body: JSON.stringify(probe),
      }),
    )
    expect(write.status).toBe(200)

    // Stored as an object, not an escaped string.
    const [row] = await sql<{ kind: string }[]>`
      select jsonb_typeof(data) as kind from config where id = 1`
    expect(row.kind).toBe('object')

    const body = (await (await GET()).json()) as { version: number; config: typeof DEFAULTS }
    expect(body.version).toBeGreaterThan(0)
    expect(body.config.beta).toEqual({ code: 'roundtrip-probe', daysAhead: 9 })
    expect(body.config.locations['probe-location']).toEqual({
      factShort: 'A corrected fact.',
      hidden: true,
    })
  } finally {
    // Put back whatever was there, so running this does not change the game.
    if (before) {
      await sql`update config set data = ${JSON.stringify(before.data)}::text::jsonb where id = 1`
    } else {
      await sql`delete from config where id = 1`
    }
    await sql.end()
  }
})
