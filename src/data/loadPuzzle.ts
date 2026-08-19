import type { LocationClass } from '../game/scoring'

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

export async function loadPuzzle(date: string): Promise<Puzzle> {
  const res = await fetch(`/puzzles/${date}.json`)
  if (!res.ok) throw new Error(`No puzzle for ${date} (${res.status})`)
  return decodePuzzle(await res.json())
}
