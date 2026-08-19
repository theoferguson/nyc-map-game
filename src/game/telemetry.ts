import { imageryVariant } from '../map/tiles'

/**
 * Local event capture. Nothing is transmitted -- there is no backend yet -- so
 * events buffer in localStorage until something exists to flush them to. That
 * keeps the instrumentation honest: the schema gets exercised by real play from
 * day one, and no data leaves the device before there is a consent story.
 *
 * Nothing here is personal. An anonymous install id, which survey the browser
 * was assigned, how the player did, and where they arrived from. No account, no
 * contact details, no device location -- the only coordinates recorded are the
 * ones the player deliberately tapped inside the game.
 */

const ID_KEY = 'nycmap:id'
const ATTRIBUTION_KEY = 'nycmap:attribution'
const QUEUE_KEY = 'nycmap:events'

/** Roughly a month of daily play. Oldest go first; this is not a ledger. */
const QUEUE_CAP = 400

/**
 * Coarse region, with no third party and no IP leaving the device.
 *
 * True IP geolocation belongs on the server, which sees the request IP anyway
 * and can resolve it to a city without shipping anything to a lookup vendor.
 * Doing it from the browser instead means handing every player's IP to a third
 * party, on a call ad blockers routinely block. So this captures what the
 * platform already knows, and the real thing lands with the backend.
 *
 * Read it for what it is: timezone answers "which part of the world", not
 * "which neighbourhood" -- America/New_York covers Maine to Florida, so it
 * cannot tell a local from a visitor, which is the question that actually
 * explains scores.
 */
function coarseRegion(): Record<string, string> {
  try {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    }
  } catch {
    return {}
  }
}

/** Safari in private mode throws on write. Telemetry must never break a game. */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // no-op
    }
  },
}

/**
 * Storage is attacker-adjacent: anything in it can be corrupted, truncated by a
 * quota error, or hand-edited in devtools. An unguarded JSON.parse on that would
 * throw on every load and leave the player with a permanently broken game they
 * could only fix by clearing site data.
 */
function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export type TrackedEvent = {
  name: string
  ts: number
  installId: string
  imagery: string
  props: Record<string, unknown>
}

function installId(): string {
  const existing = storage.get(ID_KEY)
  if (existing) return existing
  // randomUUID needs a secure context; on plain http, and on Safari before
  // 15.4, it is simply absent. This id is a bucket label, not a credential.
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  storage.set(ID_KEY, id)
  return id
}

/**
 * First-touch only. Where someone came from the day they discovered the game is
 * the marketing question; the referrer on their fortieth visit is not.
 */
function attribution(): Record<string, string> {
  const stored = parse<Record<string, string> | null>(storage.get(ATTRIBUTION_KEY), null)
  if (stored) return stored

  const params = new URLSearchParams(window.location.search)
  const first: Record<string, string> = {
    referrer: referrerHost(),
    landedAt: new Date().toISOString().slice(0, 10),
  }
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = params.get(key)
    if (value) first[key] = value.slice(0, 64)
  }
  storage.set(ATTRIBUTION_KEY, JSON.stringify(first))
  return first
}

/** Hostname only -- a full referrer URL can carry search terms and session ids. */
function referrerHost(): string {
  try {
    return document.referrer ? new URL(document.referrer).hostname : 'direct'
  } catch {
    return 'unknown'
  }
}

export function track(name: string, props: Record<string, unknown> = {}): void {
  const event: TrackedEvent = {
    name,
    ts: Date.now(),
    installId: installId(),
    imagery: imageryVariant().id,
    props:
      name === 'game_start'
        ? { ...props, ...attribution(), ...coarseRegion() }
        : props,
  }

  const queue = parse<TrackedEvent[]>(storage.get(QUEUE_KEY), [])
  queue.push(event)
  storage.set(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_CAP)))
}

/** Returns buffered events and clears them. For whenever there is somewhere to send them. */
export function drain(): TrackedEvent[] {
  const queue = parse<TrackedEvent[]>(storage.get(QUEUE_KEY), [])
  storage.set(QUEUE_KEY, '[]')
  return queue
}
