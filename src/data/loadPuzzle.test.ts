import { test, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { decodePuzzle } from './loadPuzzle'
import { encodeLocations } from '../../scripts/encode.mjs'

/**
 * Drives the real encoder against the real decoder. Content no longer ships
 * with the build -- it lives in the database and is served through the date
 * gate -- so this uses a synthetic day rather than a file. What it protects is
 * unchanged: if the two halves drift, every coordinate decodes to garbage and
 * the game marks correct answers wrong without anything looking broken.
 */
test('the encoder and decoder are still inverses', () => {
  const date = '2026-08-20'
  const locations = [
    { id: 'empire-state-building', prompt: 'The Empire State Building', lat: 40.7484, lng: -73.9857 },
    { id: 'wonder-wheel', prompt: 'The Wonder Wheel', lat: 40.5745, lng: -73.9776 },
  ]

  const encoded = encodeLocations(locations, date)
  expect(typeof encoded).toBe('string')
  // Not merely reordered: the plain text must not survive into the payload.
  expect(encoded).not.toContain('Empire')
  expect(atob(encoded)).not.toContain('Empire')

  expect(decodePuzzle({ date, puzzleNumber: 1, theme: null, locations: encoded }).locations)
    .toEqual(locations)
})

test('the key is the date, so one day cannot be decoded as another', () => {
  const locations = [{ id: 'katzs', lat: 40.7223, lng: -73.9874 }]
  const encoded = encodeLocations(locations, '2026-08-20')
  expect(() =>
    decodePuzzle({ date: '2026-09-01', puzzleNumber: 1, theme: null, locations: encoded }),
  ).toThrow()
})

/**
 * Local only. `content/` and `puzzles/` are no longer in the repo, so this is
 * skipped in CI and runs whenever an author has the files in front of them --
 * which is the moment the rules matter.
 */
const authored = existsSync('puzzles/2026-08-20.json')

test.skipIf(!authored)('puzzle content obeys the rules that make a day playable', () => {
  const p = JSON.parse(readFileSync('puzzles/2026-08-20.json', 'utf8'))
  expect(p.locations).toHaveLength(5)

  const diffs = p.locations.map((l: { difficulty: number }) => l.difficulty)
  expect(diffs).toEqual([...diffs].sort((a, b) => a - b))

  const outside = p.locations.filter((l: { borough: string }) => l.borough !== 'manhattan')
  expect(outside.length).toBeGreaterThanOrEqual(2)

  for (const l of p.locations) {
    expect(l.lng).toBeGreaterThan(-74.3)
    expect(l.lng).toBeLessThan(-73.68)
    expect(l.lat).toBeGreaterThan(40.47)
    expect(l.lat).toBeLessThan(40.93)
    expect(['area', 'landmark', 'venue']).toContain(l.class)
    expect(l.factShort.length).toBeGreaterThan(40)
    expect(l.tags.length).toBeGreaterThanOrEqual(3)
    for (const tag of l.tags) expect(tag).toMatch(/^[a-z0-9-]+$/)
    expect(l.sourceAttribution).toBeTruthy()
  }
})
