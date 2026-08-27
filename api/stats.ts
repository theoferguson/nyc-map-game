import postgres from 'postgres'
import { timingSafeEqual } from 'node:crypto'

/**
 * Read side of the consent-free counters, for the admin panel.
 *
 * Token-guarded not because the numbers are sensitive but because they are
 * business figures, and there is no reason to publish how many people play.
 */

let sql: postgres.Sql | null = null
function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  return sql
}

function tokenMatches(supplied: string | null): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request): Promise<Response> {
  if (!tokenMatches(req.headers.get('x-admin-token'))) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }
  const client = db()
  if (!client) return Response.json({ days: [] })

  try {
    const days = await client<
      { date: string; loads: number; completes: number; consented: number }[]
    >`
      select puzzle_date::text as date,
             sum(n) filter (where kind = 'load')::int     as loads,
             sum(n) filter (where kind = 'complete')::int as completes,
             (select count(distinct install_id)::int
                from events e
               where e.name = 'game_complete'
                 and (e.props ->> 'puzzleNumber') is not null
                 and e.received_at::date = t.puzzle_date) as consented
      from tallies t
      group by puzzle_date
      order by puzzle_date desc
      limit 14`
    return Response.json({ days })
  } catch {
    return Response.json({ error: 'read failed' }, { status: 503 })
  }
}
