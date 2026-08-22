import { imageryVariant } from '../map/tiles'
import { storage } from './storage'

/**
 * Event capture. Events buffer in localStorage and are flushed to /api/events
 * only once the player has said yes -- see `consent` below. Until then, and
 * forever if they say no, nothing leaves the device.
 *
 * Nothing here is personal. An anonymous install id, which survey the browser
 * was assigned, how the player did, and where they arrived from. No account, no
 * contact details, no device location -- the only coordinates recorded are the
 * ones the player deliberately tapped inside the game.
 */

const ID_KEY = 'nycmap:id'
const CONSENT_KEY = 'nycmap:consent'
const ATTRIBUTION_KEY = 'nycmap:attribution'
const QUEUE_KEY = 'nycmap:events'

/** Roughly a month of daily play. Oldest go first; this is not a ledger. */
const QUEUE_CAP = 400

/**
 * Matches the cap the endpoint enforces. Over it the server answers 413, which
 * is a 4xx -- so an unbatched flush of a long-offline queue would not be
 * retried, it would be thrown away.
 */
const BATCH = 100
const KEEPALIVE_LIMIT = 60_000

/**
 * Three states, and the difference between two of them matters: `unset` is a
 * player who has not been asked yet, `denied` is one who has. The first still
 * buffers locally so the session in progress is not lost if they say yes at
 * the end of it; the second records nothing at all.
 *
 * Why ask rather than assume. These events are anonymous and are only used to
 * make the game better, which is a defensible interest -- but the install id
 * is a persistent identifier kept for analytics, and under ePrivacy that needs
 * opt-in regardless of how harmless the payload is. Asking once is cheaper
 * than being right about the exemption.
 */
export type Consent = 'granted' | 'denied' | 'unset'

export function consent(): Consent {
  const value = storage.get(CONSENT_KEY)
  return value === 'granted' || value === 'denied' ? value : 'unset'
}

/** Saying no clears what was buffered. Answering the question is not a way to be recorded. */
export function setConsent(granted: boolean): void {
  storage.set(CONSENT_KEY, granted ? 'granted' : 'denied')
  if (granted) return
  storage.set(QUEUE_KEY, '[]')
  storage.remove(ID_KEY)
}

/**
 * Coarse region, with no third party and no IP leaving the device.
 *
 * True IP geolocation belongs on the server, which sees the request IP anyway
 * and can resolve it to a city without shipping anything to a lookup vendor.
 * That is where it now happens -- /api/events reads country, region and city
 * off the edge headers and stores those, never the address. This stays because
 * it is the only signal available on a device that never flushes.
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
  const stored = storage.parse<Record<string, string> | null>(ATTRIBUTION_KEY, null)
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
  if (consent() === 'denied') return

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

  const queue = storage.parse<TrackedEvent[]>(QUEUE_KEY, [])
  queue.push(event)
  storage.set(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_CAP)))
}

/** Returns buffered events and clears them. */
export function drain(): TrackedEvent[] {
  const queue = storage.parse<TrackedEvent[]>(QUEUE_KEY, [])
  storage.set(QUEUE_KEY, '[]')
  return queue
}

/**
 * Put a failed batch back in front of whatever was tracked while it was in
 * flight, so order survives a retry. Capped like any other write -- a device
 * that has been offline for a month does not get to grow without bound.
 */
function requeue(events: TrackedEvent[]): void {
  const queue = storage.parse<TrackedEvent[]>(QUEUE_KEY, [])
  storage.set(QUEUE_KEY, JSON.stringify([...events, ...queue].slice(-QUEUE_CAP)))
}

/**
 * Send the buffer. Safe to call whenever; it is a no-op without consent or
 * without anything to send.
 *
 * The failure split is the part worth reading. A network error or a 5xx means
 * "not now" -- including the 503 the endpoint returns when no database is
 * configured yet -- so the events go back and try again later. A 4xx means the
 * server has looked at them and will never take them, so retrying forever
 * would just be a stuck queue that blocks everything behind it.
 */
export async function flush(): Promise<void> {
  if (consent() !== 'granted') return
  const events = drain()
  if (events.length === 0) return

  for (let i = 0; i < events.length; i += BATCH) {
    if (!(await send(events.slice(i, i + BATCH)))) {
      // This batch and everything queued behind it. Sending the rest anyway
      // would reorder the queue for no gain -- whatever stopped this batch is
      // going to stop the next one too.
      requeue(events.slice(i))
      return
    }
  }
}

/** True if the batch is settled -- delivered, or refused in a way retrying cannot fix. */
async function send(events: TrackedEvent[]): Promise<boolean> {
  const body = JSON.stringify({ events })
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // Lets the last flush of a session outlive the tab, but only up to 64KB
      // across all in-flight keepalive requests -- past that the browser
      // rejects the call outright, which would strand the queue forever.
      keepalive: body.length < KEEPALIVE_LIMIT,
    })
    return res.status < 500
  } catch {
    return false
  }
}
