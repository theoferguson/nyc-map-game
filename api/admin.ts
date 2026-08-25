import postgres from 'postgres'
import { timingSafeEqual } from 'node:crypto'
import { DEFAULTS, validateConfig } from '../src/game/config.js'

/**
 * The panel's authenticated load: proves the token and returns the full config,
 * beta code included. Everything the admin panel shows comes through here, so
 * an unauthenticated visitor sees a token prompt and nothing else.
 *
 * POST rather than GET so it is never cached, and so the token travels in a
 * header on a request no CDN will store.
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
