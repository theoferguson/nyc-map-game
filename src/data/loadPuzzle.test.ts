import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePuzzle } from './loadPuzzle'

/**
 * Round-trips the real built artifact through the real client decoder. If the
 * encoder and decoder ever drift, every coordinate silently becomes garbage and
 * the game marks correct answers wrong -- so this checks the shipped file, not
 * a synthetic fixture.
 */
test('built puzzle decodes back to its plain source', () => {
  const date = '2026-08-20'
  const plain = JSON.parse(readFileSync(`puzzles/${date}.json`, 'utf8'))
  const built = JSON.parse(readFileSync(`public/puzzles/${date}.json`, 'utf8'))

  expect(typeof built.locations).toBe('string')
  expect(built.locations).not.toContain('Empire')

  const decoded = decodePuzzle(built)
  expect(decoded.locations).toEqual(plain.locations)
})

test('puzzle content obeys the rules that make a day playable', () => {
  const p = JSON.parse(readFileSync('puzzles/2026-08-20.json', 'utf8'))
  expect(p.locations).toHaveLength(5)

  // Difficulty must climb: round 1 near-unmissable, round 5 genuinely hard.
  const diffs = p.locations.map((l: { difficulty: number }) => l.difficulty)
  expect(diffs).toEqual([...diffs].sort((a, b) => a - b))

  // Hard rule from the content spec.
  const outside = p.locations.filter(
    (l: { borough: string }) => l.borough !== 'manhattan',
  )
  expect(outside.length).toBeGreaterThanOrEqual(2)

  for (const l of p.locations) {
    // Inside the NYC bounds the map clamps to -- an out-of-bounds answer is
    // unreachable and the round becomes unwinnable.
    expect(l.lng).toBeGreaterThan(-74.3)
    expect(l.lng).toBeLessThan(-73.68)
    expect(l.lat).toBeGreaterThan(40.47)
    expect(l.lat).toBeLessThan(40.93)
    expect(['area', 'landmark', 'venue']).toContain(l.class)
    expect(l.factShort.length).toBeGreaterThan(40)
    // Retrofitting tags across accumulated days is the expensive version, so
    // every location carries them from the first day onward.
    expect(l.tags.length).toBeGreaterThanOrEqual(3)
    for (const tag of l.tags) expect(tag).toMatch(/^[a-z0-9-]+$/)
    expect(l.sourceAttribution).toBeTruthy()
  }
})
