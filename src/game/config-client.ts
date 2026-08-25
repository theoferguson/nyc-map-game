import { storage } from './storage'
import { DEFAULTS, validateConfig, type Config } from './config'

/**
 * Client half of the runtime config: fetch it, cache it, and never let it stop
 * the game starting.
 *
 * Kept out of `config.ts` so that file stays free of browser imports -- the
 * serverless endpoint imports the schema, and a shared module that reaches for
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

let active: Config = DEFAULTS
let activeVersion = 0

/** The config in force for this session. Resolved once at boot and then frozen. */
export const config = (): Config => active

/**
 * Which config produced a score. Stamped on `round_complete` so a retune does
 * not silently make yesterday's scores and today's incomparable -- the events
 * table exists to compare locations by average score, and that comparison is
 * only meaningful within a version.
 */
export const configVersion = (): number => activeVersion

export async function loadConfig(): Promise<Config> {
  // Last known good first, so a repeat visit boots on the right config even if
  // the network is slow or gone.
  const cached = storage.parse<{ version: number; config: unknown } | null>(CACHE_KEY, null)
  if (cached && typeof cached.version === 'number') {
    active = validateConfig(cached.config).config
    activeVersion = cached.version
  }

  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const body = (await res.json()) as { version?: number; config?: unknown }
      active = validateConfig(body.config).config
      activeVersion = typeof body.version === 'number' ? body.version : 0
      storage.set(CACHE_KEY, JSON.stringify({ version: activeVersion, config: active }))
    }
  } catch {
    // Timeout, offline, malformed, or no endpoint at all. Whatever we already
    // have -- cache or defaults -- is what the session plays on.
  }
  return active
}
