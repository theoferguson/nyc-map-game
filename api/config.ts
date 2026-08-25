import postgres from 'postgres'
import { timingSafeEqual } from 'node:crypto'
// `.js`, not `.ts`. The extension is required under nodenext, and the compiler
// emits whatever specifier is written -- so a `.ts` import survives typecheck
// and `vercel build`, then fails at runtime with FUNCTION_INVOCATION_FAILED
// because the file next to it is `config.js`. `vercel dev` runs the TypeScript
// directly and never sees it.
import { DEFAULTS, validateConfig, type Config } from '../src/game/config.js'

/**
 * Read is public: every client needs it at boot. Write is guarded by a single
 * shared token in ADMIN_TOKEN, which is the right weight for a surface with one
 * operator -- an account system here would be more moving parts protecting the
 * same one secret.
 */

const MAX_BODY_BYTES = 64 * 1024

let sql: postgres.Sql | null = null
function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  return sql
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

export async function GET(): Promise<Response> {
  const client = db()
  // Defaults, not an error. The client would fall back to these anyway, and a
  // 500 on the boot path is a worse thing to explain than a stale config.
  if (!client) return json({ version: 0, config: DEFAULTS })

  try {
    const [row] = await client<{ version: number; data: Config }[]>`
      select version, data from config where id = 1`
    if (!row) return json({ version: 0, config: DEFAULTS })
    // Repaired rather than trusted: the row could predate a schema change.
    const { config } = validateConfig(row.data)
    return json(
      { version: row.version, config },
      200,
      // Short, because the point of the panel is that a change lands quickly.
      // Stale-while-revalidate keeps the boot path off the origin regardless.
      { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' },
    )
  } catch {
    return json({ version: 0, config: DEFAULTS })
  }
}

/** Constant-time, so a wrong token cannot be narrowed down by how fast it fails. */
function tokenMatches(supplied: string | null): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request): Promise<Response> {
  if (!tokenMatches(req.headers.get('x-admin-token'))) {
    return json({ error: 'unauthorised' }, 401)
  }

  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'too large' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'malformed json' }, 400)
  }

  // A write refuses on any problem, where the client repairs and continues.
  // The asymmetry is deliberate: silently storing a corrected version of what
  // the operator typed is how a panel starts lying about its own state.
  const { config, problems } = validateConfig(body)
  if (problems.length > 0) return json({ error: 'invalid config', problems }, 400)

  const client = db()
  if (!client) return json({ error: 'no database configured' }, 503)

  try {
    const [row] = await client<{ version: number }[]>`
      insert into config (id, version, data, updated_at)
      -- ::text::jsonb, not ::jsonb. Handed a JS string for a jsonb parameter the
      -- driver stores it as a JSON *string*, so the row reads back as one long
      -- escaped blob, validateConfig sees nothing it recognises, and every
      -- client silently gets the defaults. Nothing errors; the write reports
      -- success and echoes the config it was given. Casting through text parses.
      values (1, 1, ${JSON.stringify(config)}::text::jsonb, now())
      on conflict (id) do update
        set version = config.version + 1,
            data = excluded.data,
            updated_at = now()
      returning version`
    return json({ version: row.version, config })
  } catch {
    return json({ error: 'write failed' }, 503)
  }
}
