import { test, expect } from 'vitest'
import postgres from 'postgres'
import { POST } from '../api/events.ts'

/**
 * The only check that touches a real database, so it is opt-in:
 *
 *   DATABASE_URL=... npm run check:events
 *
 * Run it after provisioning, and after any change to the insert. It exists
 * because of a bug nothing else could see: sent as a `jsonb[]` element, the
 * driver handed Postgres the props as a JSON *string*, so every row stored
 * "{\"score\":88}" instead of an object. Nothing errored, the insert reported
 * success, and every `props ->> 'score'` came back null. The table would have
 * filled for weeks before anyone tried to group by anything.
 *
 * Which is why this asserts the aggregate the table exists to answer, rather
 * than that a row was written. Deliberately outside `npm run build`: a
 * database blip must not block deploying a static game.
 */
test.skipIf(!process.env.CHECK_EVENTS_DB)('an event round-trips and its props stay queryable', async () => {
  const url = process.env.DATABASE_URL
  expect(url, 'DATABASE_URL is not set').toBeTruthy()

  const probe = `probe-${Date.now()}`
  const res = await POST(
    new Request('https://x/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-ip-city': 'Brooklyn' },
      body: JSON.stringify({
        events: [
          {
            name: 'round_complete',
            ts: Date.now(),
            installId: probe,
            imagery: 'nyc-2024',
            props: { locationId: 'probe', score: 88, tags: ['a', 'b'] },
          },
        ],
      }),
    }),
  )
  expect(res.status).toBe(204)

  const sql = postgres(url!, { max: 1 })
  try {
    const [row] = await sql`
      select avg((props ->> 'score')::numeric) as score,
             props -> 'tags' as tags,
             city
      from events where install_id = ${probe} group by tags, city`

    expect(Number(row?.score)).toBe(88)
    expect(row?.tags).toEqual(['a', 'b'])
    expect(row?.city).toBe('Brooklyn')
  } finally {
    await sql`delete from events where install_id = ${probe}`
    await sql.end()
  }
})
