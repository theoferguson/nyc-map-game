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

/** Authored days, earliest first. */
export async function puzzleQueue(): Promise<string[]> {
  const res = await fetch('/puzzles/index.json')
  return res.ok ? ((await res.json()) as string[]) : []
}

/**
 * In development the calendar is not the constraint, the queue is: serve the
 * head of the queue so the app opens on any date instead of showing "no puzzle
 * yet" the day after the last authored one. Production always uses the real
 * New York date -- `import.meta.env.DEV` is replaced at build time, so this
 * branch is not present in the shipped bundle at all.
 *
 * Every caller should key storage off the returned puzzle's own `date`, not the
 * date it asked for, or a development session writes progress under a day it is
 * not actually playing.
 */
export async function loadTodaysPuzzle(realDate: string): Promise<Puzzle> {
  if (import.meta.env.DEV) {
    const queue = await puzzleQueue()
    if (queue.length) return loadPuzzle(queue[0])
  }
  return loadPuzzle(realDate)
}

export async function loadPuzzle(date: string): Promise<Puzzle> {
  const res = await fetch(`/puzzles/${date}.json`)
  // Reachable in normal use the moment the calendar passes the last authored
  // day, so it says something a player can act on rather than a status code.
  if (!res.ok) throw new Error(`No puzzle for ${date} yet — check back soon.`)
  return decodePuzzle(await res.json())
}
