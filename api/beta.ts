import { db } from './_db.js'
import { DEFAULTS, validateConfig, type Config } from '../src/game/config.js'

/**
 * Checks a beta code without ever telling the client what it is.
 *
 * This used to be a client-side string comparison against a code delivered in
 * the public config, which meant the code was readable by anyone who opened the
 * network tab -- the gate was decorative.
 *
 * It is still not a security control, and should not be mistaken for one:
 * `/puzzles/<date>.json` is a public static file, so anyone determined to read
 * next week's puzzle can fetch it directly. What this protects is the
 * *intentionality* of the tester group, not the secrecy of the content.
 */

const normalise = (s: string) => s.trim().toLowerCase()

export async function POST(req: Request): Promise<Response> {
  let code = ''
  try {
    const text = await req.text()
    if (text.length > 1024) return new Response(null, { status: 413 })
    code = normalise(String((JSON.parse(text) as { code?: unknown }).code ?? ''))
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!code) return Response.json({ ok: false }, { status: 200 })

  let expected: Config['beta']['code'] = DEFAULTS.beta.code
  const client = db()
  if (client) {
    try {
      const [row] = await client<{ data: unknown }[]>`select data from config where id = 1`
      if (row) expected = validateConfig(row.data).config.beta.code
    } catch {
      // Fall through on the shipped default rather than locking testers out
      // over a database blip. The gate is a convenience, not a control.
    }
  }

  // Always 200. A 401 here would let the response code itself confirm a guess
  // to something that is not even reading the body.
  return Response.json({ ok: code === normalise(expected) }, { status: 200 })
}
