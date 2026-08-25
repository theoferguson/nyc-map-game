import postgres from 'postgres'
import { DEFAULTS, validateConfig } from '../src/game/config.js'
import { puzzleDate, shiftDate } from '../src/game/date.js'

/**
 * Serves one day, and refuses anything the caller is not entitled to yet.
 *
 * This is the only protection future content has. The XOR blob is a speed bump
 * against devtools; the date comparison here is the thing that means tomorrow's
 * puzzle cannot be read today, and it has to happen on the server because a
 * client-side check is a client-side suggestion.
 *
 *   GET /api/puzzle?date=2026-09-01[&code=<beta code>]
 *   GET /api/puzzle?index=1              -- the dates on offer
 *
 * Today is New York's today, for everyone, matching the game's own rollover.
 */

let sql: postgres.Sql | null = null
function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  return sql
}

const normalise = (s: string) => s.trim().toLowerCase()

/**
 * The latest date this caller may see. Today for everyone; further ahead for a
 * beta tester, by exactly the window the config allows.
 */
async function horizon(client: postgres.Sql, code: string | null): Promise<string> {
  const today = puzzleDate()
  if (!code) return today

  let config = DEFAULTS
  try {
    const [row] = await client<{ data: unknown }[]>`select data from config where id = 1`
    if (row) config = validateConfig(row.data).config
  } catch {
    // Shipped defaults. A database blip should not quietly widen the window.
  }
  if (normalise(code) !== normalise(config.beta.code)) return today
  return shiftDate(today, config.beta.daysAhead)
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const client = db()
  if (!client) return new Response(null, { status: 503 })

  const code = params.get('code')

  try {
    const limit = await horizon(client, code)

    if (params.has('index')) {
      const rows = await client<{ date: string }[]>`
        select date::text from puzzles where date <= ${limit} order by date`
      return Response.json(rows.map((r) => r.date), {
        headers: { 'cache-control': 'private, max-age=60' },
      })
    }

    const date = params.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response(null, { status: 400 })

    // 404 rather than 403 for a day that exists but is not yet allowed. A
    // distinguishable refusal would confirm which future dates are authored,
    // which is a slower version of the leak this endpoint exists to close.
    if (date > limit) return new Response(null, { status: 404 })

    const [row] = await client<
      { date: string; puzzle_number: number; theme: string | null; locations: string }[]
    >`select date::text, puzzle_number, theme, locations from puzzles where date = ${date}`
    if (!row) return new Response(null, { status: 404 })

    return Response.json(
      {
        date: row.date,
        puzzleNumber: row.puzzle_number,
        theme: row.theme,
        locations: row.locations,
      },
      {
        // Private: the response depends on the beta code, so a shared cache
        // holding one caller's answer would hand a future day to everyone.
        headers: { 'cache-control': 'private, max-age=300' },
      },
    )
  } catch {
    return new Response(null, { status: 503 })
  }
}
