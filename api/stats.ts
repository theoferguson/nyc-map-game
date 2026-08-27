import { db } from './_db.js'
import { adminTokenMatches } from './_auth.js'
/**
 * Read side of the consent-free counters, for the admin panel.
 *
 * Token-guarded not because the numbers are sensitive but because they are
 * business figures, and there is no reason to publish how many people play.
 */

export async function POST(req: Request): Promise<Response> {
  if (!adminTokenMatches(req.headers.get('x-admin-token'))) {
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
