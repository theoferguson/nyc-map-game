import postgres from 'postgres'

/**
 * The flush endpoint. Public, unauthenticated and write-only, which is the
 * whole threat model: anyone can POST anything, so nothing here trusts the
 * body. Every field is checked against a shape before it reaches SQL, and
 * anything unrecognised is dropped rather than stored for later triage --
 * an events table that accepts arbitrary JSON from the internet is a
 * storage bill and a liability, not a dataset.
 */

/** Names the client actually emits. Anything else is not ours. */
const EVENT_NAMES = new Set([
  'game_start',
  'game_resumed',
  'round_complete',
  'game_complete',
  'share',
  'settings_changed',
])

const MAX_BODY_BYTES = 64 * 1024
const MAX_EVENTS = 100
const MAX_PROPS_BYTES = 2000
/** Roughly 2001-09-09 to 2033. A ts outside this is a broken clock or a probe. */
const TS_MIN = 1_000_000_000_000
const TS_MAX = 2_000_000_000_000

type Row = {
  name: string
  ts: number
  installId: string
  imagery: string
  props: string
}

/**
 * Module scope so warm invocations reuse the connection. `max: 1` because a
 * serverless instance handles one request at a time -- a larger pool here
 * multiplies connections by instance count and exhausts the server's limit
 * long before it helps.
 */
let sql: postgres.Sql | null = null
function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  return sql
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/** Returns a row, or null if the event is malformed in any way. */
function validate(raw: unknown): Row | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>

  const name = clean(e.name, 40)
  if (!name || !EVENT_NAMES.has(name)) return null

  const ts = e.ts
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < TS_MIN || ts > TS_MAX) return null

  const installId = clean(e.installId, 64)
  const imagery = clean(e.imagery, 32)
  if (!installId || !imagery) return null

  if (!e.props || typeof e.props !== 'object' || Array.isArray(e.props)) return null
  const props = JSON.stringify(e.props)
  if (props.length > MAX_PROPS_BYTES) return null

  return { name, ts, installId, imagery, props }
}

/**
 * Exported by method name, not as a default. That is what selects Vercel's web
 * handler -- a default export is handed the old (req, res) pair instead and
 * never responds to anything returned. Other methods get a 405 from the
 * platform without a branch here.
 */
export async function POST(req: Request): Promise<Response> {
  // Cheap rejection before reading the stream. Content-Length can lie, so the
  // parsed length is what actually decides -- this only saves the read.
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 })

  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }

  const incoming = (body as { events?: unknown })?.events
  if (!Array.isArray(incoming)) return new Response(null, { status: 400 })
  if (incoming.length > MAX_EVENTS) return new Response(null, { status: 413 })

  // Drop bad events rather than rejecting the batch: one malformed event
  // must not cost a player the other nineteen, and a 400 would have the
  // client discard the lot as permanently unacceptable.
  const rows = incoming.map(validate).filter((r): r is Row => r !== null)
  if (rows.length === 0) return new Response(null, { status: 204 })

  const client = db()
  // No database yet. 503 is deliberate: the client requeues on 5xx, so events
  // keep buffering on the device until there is somewhere to put them.
  if (!client) return new Response(null, { status: 503 })

  // Set by Vercel's edge from the request IP, which never enters this process.
  const h = req.headers
  const country = clean(h.get('x-vercel-ip-country'), 8)
  const region = clean(h.get('x-vercel-ip-country-region'), 16)
  const city = clean(h.get('x-vercel-ip-city'), 64)

  try {
    await client`
      insert into events (name, ts, install_id, imagery, props, country, region, city)
      -- props arrives as text and is cast here, not declared jsonb[] above.
      -- Sent as jsonb[], the driver hands Postgres each element as a JSON
      -- *string* -- so props lands as "{\"score\":88}" rather than an object,
      -- every ->> returns null, and nothing errors. Casting after unnest parses.
      select e.name, e.ts, e.install_id, e.imagery, e.props::jsonb, ${country}, ${region}, ${city}
      from unnest(
        ${rows.map((r) => r.name)}::text[],
        ${rows.map((r) => r.ts)}::bigint[],
        ${rows.map((r) => r.installId)}::text[],
        ${rows.map((r) => r.imagery)}::text[],
        ${rows.map((r) => r.props)}::text[]
      ) as e(name, ts, install_id, imagery, props)
    `
  } catch {
    // ponytail: no retry and no dead-letter. The client still holds these
    // events and will send them again, which is the retry.
    return new Response(null, { status: 503 })
  }

  return new Response(null, { status: 204 })
}
