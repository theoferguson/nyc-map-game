import type { LocationClass } from '../game/scoring'
import type { LocationOverride } from '../game/config'

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

export async function loadPuzzle(
  date: string,
  overrides: Record<string, LocationOverride> = {},
  code: string | null = null,
): Promise<Puzzle> {
  const res = await fetch(
    `/api/puzzle?date=${date}${code ? `&code=${encodeURIComponent(code)}` : ''}`,
  )
  // Reachable in normal use the moment the calendar passes the last authored
  // day, and also whenever a day is asked for before it is allowed -- the
  // server answers 404 to both, deliberately, so this copy covers both.
  if (!res.ok) throw new Error(`No puzzle for ${date} yet — check back soon.`)
  return applyOverrides(decodePuzzle(await res.json()), overrides)
}
