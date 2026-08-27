import { db, type Db } from './_db.js'
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

const normalise = (s: string) => s.trim().toLowerCase()

/**
 * Invented placeholder content, so `npm run dev` plays with no database.
 * Every date serves the same day, which is enough to exercise the whole loop.
 */
async function sample(params: URLSearchParams): Promise<Response> {
  const { readFile } = await import('node:fs/promises')
  const { encodeLocations } = await import('../src/data/codec.mjs')
  const day = JSON.parse(await readFile('content/sample.json', 'utf8'))
  const date = params.get('date') ?? puzzleDate()

  if (params.has('index')) return Response.json([puzzleDate()])
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response(null, { status: 400 })

  return Response.json({
    date,
    puzzleNumber: 0,
    theme: null,
    locations: encodeLocations(day.locations, date),
  })
}

/**
 * The latest date this caller may see. Today for everyone; further ahead for a
 * beta tester, by exactly the window the config allows.
 */
async function horizon(client: Db, code: string | null): Promise<string> {
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

  // Development only, and set by the Vite plugin rather than inferred from a
  // missing DATABASE_URL -- production must fail loudly on a misconfigured
  // database rather than quietly serving placeholder content.
  if (!client && process.env.DEV_SAMPLE_CONTENT) return sample(params)
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

    // Counted in the same round trip as the read, so measuring costs nothing
    // on the boot path. A separate fire-and-forget write would be cheaper to
    // write and worse to run: serverless can end the invocation before it
    // lands, which quietly undercounts exactly when traffic is highest.
    const [row] = await client<
      { date: string; puzzle_number: number; theme: string | null; locations: string }[]
    >`
      with bump as (
        insert into tallies (puzzle_date, hour, kind, n)
        values (${date}, date_trunc('hour', now()), 'load', 1)
        on conflict (puzzle_date, hour, kind) do update set n = tallies.n + 1
      )
      select date::text, puzzle_number, theme, locations from puzzles where date = ${date}`
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
