/**
 * Structural, and deliberately not imported from `loadPuzzle`. This module is
 * shared with the serverless endpoint, and reaching into the client's module
 * graph would drag `fetch` and `localStorage` into a function that has neither.
 * `PuzzleLocation` is assignable to it, which is the only coupling needed.
 */
export type DayLocation = {
  id: string
  name: string
  prompt: string
  lat: number
  lng: number
  class: string
  borough: string
  difficulty: number
  tags: string[]
  factShort: string
  sourceUrl: string
  sourceAttribution: string
}

/**
 * The rules that make a day playable, checked in one place so the admin panel
 * can warn before saving and the endpoint can refuse after.
 *
 * `scripts/author.mjs` keeps its own copy of the stricter authoring checks --
 * geocoding, cross-day uniqueness of names and queries -- which are questions
 * only the whole corpus can answer. What is here is what a single day has to
 * satisfy on its own, which is exactly what an editor can break.
 */

export const BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'] as const
export const CLASSES = ['area', 'landmark', 'venue'] as const

/** The extent the map clamps to. An answer outside it cannot be reached, let alone found. */
export const BOUNDS = { west: -74.3, east: -73.68, south: 40.47, north: 40.93 }

export const inBounds = (lat: number, lng: number) =>
  lng > BOUNDS.west && lng < BOUNDS.east && lat > BOUNDS.south && lat < BOUNDS.north

export function validateDay(locations: DayLocation[]): string[] {
  const problems: string[] = []

  if (locations.length !== 5) problems.push(`${locations.length} locations, expected 5`)

  const diffs = locations.map((l) => l.difficulty)
  if (diffs.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) {
    problems.push('difficulty must be a whole number from 1 to 5')
  } else if (diffs.some((d, i) => i > 0 && d < diffs[i - 1])) {
    problems.push(`difficulty does not climb (${diffs.join(',')})`)
  }

  const outside = locations.filter((l) => l.borough !== 'manhattan').length
  if (outside < 2) problems.push(`only ${outside} location(s) outside Manhattan, need 2`)

  const ids = locations.map((l) => l.id)
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (repeated.length) problems.push(`repeated id: ${[...new Set(repeated)].join(', ')}`)

  for (const l of locations) {
    const where = l.id || '(no id)'
    if (!l.id?.trim()) problems.push('a location has no id')
    if (!l.prompt?.trim()) problems.push(`${where}: no prompt`)
    if (!l.name?.trim()) problems.push(`${where}: no name`)
    if (typeof l.lat !== 'number' || typeof l.lng !== 'number' || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) {
      problems.push(`${where}: coordinates are not numbers`)
    } else if (!inBounds(l.lat, l.lng)) {
      // The failure the Staten Island Ferry taught: a real coordinate, in the
      // right country, that no player could ever have been right about.
      problems.push(`${where}: ${l.lat}, ${l.lng} is outside New York`)
    }
    if (!BOROUGHS.includes(l.borough as (typeof BOROUGHS)[number])) {
      problems.push(`${where}: borough "${l.borough}"`)
    }
    if (!CLASSES.includes(l.class as (typeof CLASSES)[number])) {
      problems.push(`${where}: class "${l.class}"`)
    }
    if ((l.tags ?? []).length < 3) problems.push(`${where}: needs 3 or more tags`)
    if ((l.tags ?? []).some((t) => !/^[a-z0-9-]+$/.test(t))) {
      problems.push(`${where}: tags must be lowercase, digits and hyphens`)
    }
    if ((l.factShort ?? '').trim().length < 60) problems.push(`${where}: fact is too short`)
    if (!l.sourceUrl?.trim()) problems.push(`${where}: no source URL`)
    if (!l.sourceAttribution?.trim()) problems.push(`${where}: no source attribution`)
  }

  return problems
}
