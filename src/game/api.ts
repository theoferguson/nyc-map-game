import { storage } from './storage'
import { DEFAULTS, validateConfig, toPublic, type PublicConfig } from './config'

/**
 * Everything the client asks of our own API, and the config those answers
 * resolve to.
 *
 * Named for what it is rather than what it started as: it was `config-client`
 * until it also held the beta check and the completion tally, at which point
 * the name described a third of the file.
 *
 * Kept out of `config.ts` so that file stays free of browser imports -- the
 * serverless endpoints import the schema, and a shared module that reaches for
 * localStorage is one refactor away from breaking the function that validates
 * writes to it.
 */

const CACHE_KEY = 'nycmap:config'

/**
 * Short. This sits in front of the first round, so the cost of a slow endpoint
 * is paid by every player before they can play -- and the fallback (last known
 * config, then the shipped defaults) is good enough that waiting longer buys
 * very little.
 */
const TIMEOUT_MS = 2000

let active: PublicConfig = toPublic(DEFAULTS)
let activeVersion = 0

/** The config in force for this session. Resolved once at boot and then frozen. */
export const config = (): PublicConfig => active

/**
 * Which config produced a score. Stamped on `round_complete` so a retune does
 * not silently make yesterday's scores and today's incomparable -- the events
 * table exists to compare locations by average score, and that comparison is
 * only meaningful within a version.
 */
export const configVersion = (): number => activeVersion

export async function loadConfig(): Promise<PublicConfig> {
  // Last known good first, so a repeat visit boots on the right config even if
  // the network is slow or gone.
  const cached = storage.parse<{ version: number; config: unknown } | null>(CACHE_KEY, null)
  if (cached && typeof cached.version === 'number') {
    active = toPublic(validateConfig(cached.config).config)
    activeVersion = cached.version
  }

  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const body = (await res.json()) as { version?: number; config?: unknown }
      active = toPublic(validateConfig(body.config).config)
      activeVersion = typeof body.version === 'number' ? body.version : 0
      storage.set(CACHE_KEY, JSON.stringify({ version: activeVersion, config: active }))
    }
  } catch {
    // Timeout, offline, malformed, or no endpoint at all. Whatever we already
    // have -- cache or defaults -- is what the session plays on.
  }
  return active
}

/**
 * Ask the server whether a beta code is right. The client never holds the
 * answer, which is the entire point -- the previous version compared against a
 * code delivered in the public config, so reading the network tab was enough to
 * join the beta.
 *
 * Returns null when the question could not be asked at all. Callers use that to
 * leave an existing tester alone rather than revoking them over a dropped
 * connection.
 */
export async function verifyBetaCode(code: string): Promise<boolean | null> {
  try {
    const res = await fetch('/api/beta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) return null
    return (await res.json()).ok === true
  } catch {
    return null
  }
}

/**
 * Records that a game was finished. No identifier, no properties -- see
 * api/tally.ts. Not gated on consent, because there is nothing here to consent
 * to, and because a completion rate that only counts players who opted in is
 * not a completion rate.
 */
export function tallyComplete(date: string): void {
  try {
    void fetch('/api/tally', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'complete', date }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Never let counting break the end of a game.
  }
}
