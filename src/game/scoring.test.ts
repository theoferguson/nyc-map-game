import { test, expect } from 'vitest'
import { haversine, roundScore, describeMiss } from './scoring'

const ESB = { lat: 40.748442, lng: -73.985659 }
// One long block west of the ESB, on Sixth Avenue.
const SIXTH_AVE = { lat: 40.748442, lng: -73.98895 }
// Roughly four short blocks north, on the same avenue.
const FOUR_NORTH = { lat: 40.751320, lng: -73.985659 }

test('haversine matches known NYC distances', () => {
  expect(haversine(ESB, ESB)).toBe(0)
  // ESB to Yankee Stadium is a little under 10km.
  const yankee = { lat: 40.829583, lng: -73.926521 }
  expect(haversine(ESB, yankee)).toBeGreaterThan(9_000)
  expect(haversine(ESB, yankee)).toBeLessThan(10_500)
  // Symmetric.
  expect(haversine(ESB, yankee)).toBeCloseTo(haversine(yankee, ESB), 6)
})

test('scoring is bullseye inside 40m and decays per class', () => {
  expect(roundScore(0, 'venue')).toBe(100)
  expect(roundScore(40, 'venue')).toBe(100)
  expect(roundScore(41, 'venue')).toBeLessThan(100)

  // A venue is more forgiving than a landmark at the same miss, because a deli
  // roof gives you nothing to aim at. If this inverts, the lambdas got swapped.
  expect(roundScore(300, 'venue')).toBeGreaterThan(roundScore(300, 'landmark'))
  expect(roundScore(300, 'area')).toBeGreaterThan(roundScore(300, 'venue'))

  // Monotonic: further is never better.
  for (let d = 50; d < 5_000; d += 137) {
    expect(roundScore(d + 50, 'area')).toBeLessThanOrEqual(roundScore(d, 'area'))
  }
  expect(roundScore(20_000, 'area')).toBe(0)
})

test('miss copy follows the dominant axis and names it correctly', () => {
  expect(describeMiss(ESB, ESB)).toBe('Dead on.')

  // Due west: crossing an avenue, so it must say avenue, not block.
  expect(describeMiss(SIXTH_AVE, ESB)).toMatch(/avenue/)
  expect(describeMiss(SIXTH_AVE, ESB)).not.toMatch(/block/)

  // Due north: crossing streets, so it must say blocks.
  expect(describeMiss(FOUR_NORTH, ESB)).toMatch(/blocks/)
  expect(describeMiss(FOUR_NORTH, ESB)).not.toMatch(/avenue/)

  // The Jersey line only fires west of the Hudson, not for a bad Brooklyn guess.
  expect(describeMiss({ lat: 40.72, lng: -74.05 }, ESB)).toBe('You were in Jersey.')
  expect(describeMiss({ lat: 40.574, lng: -73.979 }, ESB)).not.toMatch(/Jersey/)
})

test('every distance produces copy, with no NaN or undefined leaking through', () => {
  for (let m = 0; m < 40_000; m += 17) {
    const guess = { lat: ESB.lat + m / 111_320, lng: ESB.lng }
    const copy = describeMiss(guess, ESB)
    expect(copy).toBeTruthy()
    expect(copy).not.toMatch(/NaN|undefined|Infinity/)
    expect(copy).toMatch(/[.!]$/)
  }
})
