import type { LocationClass } from '../game/scoring'
import type { LocationOverride } from '../game/config'
import { storage } from '../game/storage'

export type PuzzleLocation = {
  id: string
  name: string
  prompt: string
  lat: number
  lng: number
  class: LocationClass
  borough: string
  difficulty: number
  /**
   * Neighbourhood, type, era, theme. Finer than `class` and `borough`, which
   * cannot distinguish a deli from a nightclub or SoHo from Inwood. Feeds
   * themed days, difficulty tiering, and the category-level affinity model --
   * a daily game only ever yields one observation per player per location, so
   * affinity has to be learned across tags rather than per place.
   */
  tags: string[]
  factShort: string
  sourceUrl: string
  sourceAttribution: string
}

export type Puzzle = {
  date: string
  puzzleNumber: number
  theme: string | null
  locations: PuzzleLocation[]
}

/** Mirror of the encoder in scripts/build-puzzles.mjs. */
function xor(bytes: Uint8Array, key: string): Uint8Array {
  const k = new TextEncoder().encode(key)
  return bytes.map((b, i) => b ^ k[i % k.length])
}

export type EncodedPuzzle = Omit<Puzzle, 'locations'> & { locations: string }

export function decodePuzzle(raw: EncodedPuzzle): Puzzle {
  const bytes = Uint8Array.from(atob(raw.locations), (c) => c.charCodeAt(0))
  const locations = JSON.parse(new TextDecoder().decode(xor(bytes, raw.date)))
  return { ...raw, locations }
}

/**
 * Authored days, earliest first -- and only the ones this caller may see. The
 * server decides that from the beta code, so an unlocked queue cannot be
 * obtained by asking differently.
 */
export async function puzzleQueue(code: string | null): Promise<string[]> {
  const res = await fetch(`/api/puzzle?index=1${code ? `&code=${encodeURIComponent(code)}` : ''}`)
  return res.ok ? ((await res.json()) as string[]) : []
}

/**
 * Admin corrections, applied after decoding.
 *
 * Two emergencies, one mechanism: a fact that is wrong can be replaced, and a
 * location that is wrong can be dropped. Hiding never empties a day -- a board
 * with no rounds is a worse failure than the bad round it was meant to fix, and
 * a typo in the panel should not be able to cause it.
 */
export function applyOverrides(
  puzzle: Puzzle,
  overrides: Record<string, LocationOverride>,
): Puzzle {
  if (Object.keys(overrides).length === 0) return puzzle

  const kept = puzzle.locations.filter((l) => !overrides[l.id]?.hidden)
  const locations = (kept.length > 0 ? kept : puzzle.locations).map((l) => {
    const fact = overrides[l.id]?.factShort
    return fact ? { ...l, factShort: fact } : l
  })
  return { ...puzzle, locations }
}

/** The day's shape, for spotting a board that changed under a saved game. */
export const layoutOf = (puzzle: Puzzle) => puzzle.locations.map((l) => l.id).join(',')

const CACHE_PREFIX = 'nycmap:puzzle:'

/**
 * Keeps the day you are playing, and only that day.
 *
 * Moving content into the database bought secrecy at the cost of availability:
 * static files came off a CDN and effectively never failed, whereas a Neon
 * outage or a cold start now means nobody can play at all. One cached day turns
 * that from an outage into a shrug for anyone who has already loaded it.
 *
 * Beta days are never cached. They are fetched with a code that can be revoked,
 * and a copy on disk would keep serving a future puzzle after the code that
 * unlocked it stopped working -- quietly undoing the gate. They are also
 * ephemeral by design, so there is nothing to preserve.
 */
export async function loadPuzzle(
  date: string,
  overrides: Record<string, LocationOverride> = {},
  code: string | null = null,
  cache = false,
): Promise<Puzzle> {
  const key = CACHE_PREFIX + date
  const missing = new Error(`No puzzle for ${date} yet — check back soon.`)

  try {
    const res = await fetch(
      `/api/puzzle?date=${date}${code ? `&code=${encodeURIComponent(code)}` : ''}`,
    )
    if (res.ok) {
      const raw = (await res.json()) as EncodedPuzzle
      if (cache) {
        storage.set(key, JSON.stringify(raw))
        // One day at a time. Yesterday's is unplayable and would accumulate for
        // as long as somebody keeps playing.
        for (const k of storage.keys()) {
          if (k.startsWith(CACHE_PREFIX) && k !== key) storage.remove(k)
        }
      }
      return applyOverrides(decodePuzzle(raw), overrides)
    }
    // A 4xx is an answer, not an outage. The day is genuinely not available --
    // past the last authored one, or asked for before it is allowed -- and
    // serving a cached copy over a refusal is exactly how a gate stops working.
    if (res.status < 500) throw missing
  } catch (e) {
    if (e === missing) throw e
    // Network failure. Falls through to whatever is on disk.
  }

  const cached = storage.parse<EncodedPuzzle | null>(key, null)
  if (cached) return applyOverrides(decodePuzzle(cached), overrides)
  throw missing
}
