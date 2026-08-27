import { db } from './_db.js'
/**
 * A counter, not an event.
 *
 * `/api/events` is gated on consent because it carries a persistent install id.
 * This carries nothing: no id, no properties, no IP, no session -- only that a
 * thing happened, on a given day, in a given hour. That is aggregate statistics
 * rather than tracking, so it is not gated, and it is the only measurement that
 * survives a player who never answers the consent card.
 *
 * Deliberately impoverished. If it ever needs a field to be useful, that field
 * belongs in `events` behind consent, not here.
 */

const KINDS = new Set(['complete'])

export async function POST(req: Request): Promise<Response> {
  let kind = ''
  let date = ''
  try {
    const text = await req.text()
    if (text.length > 256) return new Response(null, { status: 413 })
    const body = JSON.parse(text) as { kind?: unknown; date?: unknown }
    kind = String(body.kind ?? '')
    date = String(body.date ?? '')
  } catch {
    return new Response(null, { status: 400 })
  }

  if (!KINDS.has(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(null, { status: 400 })
  }

  const client = db()
  if (!client) return new Response(null, { status: 204 })

  try {
    await client`
      insert into tallies (puzzle_date, hour, kind, n)
      values (${date}, date_trunc('hour', now()), ${kind}, 1)
      on conflict (puzzle_date, hour, kind) do update set n = tallies.n + 1`
  } catch {
    // A miscount is not worth a failed request to a client that cannot act on it.
  }
  return new Response(null, { status: 204 })
}
