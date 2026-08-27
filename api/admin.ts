import { db } from './_db.js'
import { adminTokenMatches } from './_auth.js'
import { DEFAULTS, validateConfig } from '../src/game/config.js'
import { validateDay, type DayLocation } from '../src/data/validateDay.js'
import { decodeLocations, encodeLocations } from '../src/data/codec.mjs'

/**
 * Everything the admin panel does that needs the token, behind one auth check.
 *
 * Reads here are deliberately ungated by date. `/api/puzzle` refuses future
 * days because it answers the public; the panel has to audit content that has
 * not been published yet -- which is the only time a wrong pin can still be
 * fixed before anyone plays it.
 *
 *   { action: 'config' }                   the full config, beta code included
 *   { action: 'dates' }                    every authored day
 *   { action: 'day',  date }               one day, decoded, any date
 *   { action: 'save', date, locations }    replace that day's locations
 */

const MAX_BODY_BYTES = 256 * 1024

export async function POST(req: Request): Promise<Response> {
  if (!adminTokenMatches(req.headers.get('x-admin-token'))) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }

  let body: { action?: string; date?: string; locations?: DayLocation[] } = {}
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'too large' }, { status: 413 })
    if (text) body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'malformed json' }, { status: 400 })
  }

  const client = db()
  const action = body.action ?? 'config'

  if (action === 'config') {
    if (!client) return Response.json({ version: 0, config: DEFAULTS })
    try {
      const [row] = await client<{ version: number; data: unknown }[]>`
        select version, data from config where id = 1`
      if (!row) return Response.json({ version: 0, config: DEFAULTS })
      return Response.json({ version: row.version, config: validateConfig(row.data).config })
    } catch {
      return Response.json({ error: 'read failed' }, { status: 503 })
    }
  }

  if (!client) return Response.json({ error: 'no database configured' }, { status: 503 })

  if (action === 'dates') {
    const rows = await client<{ date: string; puzzle_number: number }[]>`
      select date::text, puzzle_number from puzzles order by date`
    return Response.json({ dates: rows.map((r) => ({ date: r.date, number: r.puzzle_number })) })
  }

  const date = body.date ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'bad date' }, { status: 400 })

  if (action === 'day') {
    const [row] = await client<{ puzzle_number: number; theme: string | null; locations: string }[]>`
      select puzzle_number, theme, locations from puzzles where date = ${date}`
    if (!row) return Response.json({ error: 'no such day' }, { status: 404 })
    return Response.json({
      date,
      puzzleNumber: row.puzzle_number,
      theme: row.theme,
      locations: decodeLocations<DayLocation>(row.locations, date),
    })
  }

  if (action === 'save') {
    const locations = body.locations
    if (!Array.isArray(locations)) return Response.json({ error: 'no locations' }, { status: 400 })

    // Refused rather than repaired. An editor that silently corrects what was
    // typed is worse than one that will not save: the operator walks away
    // believing something that is not true.
    const problems = validateDay(locations)
    if (problems.length) return Response.json({ error: 'invalid day', problems }, { status: 400 })

    const { count } = await client`
      update puzzles set locations = ${encodeLocations(locations, date)} where date = ${date}`
    if (count === 0) return Response.json({ error: 'no such day' }, { status: 404 })
    return Response.json({ ok: true, date })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
