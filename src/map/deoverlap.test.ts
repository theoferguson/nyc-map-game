import { test, expect } from 'vitest'
import { deoverlap, CARD_W, type Card } from './deoverlap'

const card = (id: string, x: number, y: number, h = 220): Card => ({ id, x, y, h })

const collides = (a: { x: number; y: number; h: number }, b: typeof a) =>
  Math.abs(a.x - b.x) < CARD_W && a.y - a.h < b.y && b.y - b.h < a.y

test('five clustered answers all end up readable', () => {
  // Worst realistic case: every answer within a few pixels, at the tall end of
  // the height range a real fact card reaches.
  const stacked = Array.from({ length: 5 }, (_, i) =>
    card(`l${i}`, 200 + i * 3, 300 + i * 2),
  )

  const out = deoverlap(stacked, 4000)
  expect(out).toHaveLength(5)

  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      expect(collides(out[i], out[j])).toBe(false)
})

test('cards of differing heights still clear each other', () => {
  // The bug this guards: a fixed height estimate cleared short cards and let
  // tall ones overlap. Heights here span the real 120-260px range.
  const mixed = [
    card('a', 300, 500, 130),
    card('b', 306, 505, 260),
    card('c', 298, 495, 180),
    card('d', 310, 520, 240),
  ]
  const out = deoverlap(mixed, 4000)
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      expect(collides(out[i], out[j])).toBe(false)
})

test('no card hangs off the top of the viewport', () => {
  // A pin near the top of the screen has no room above it for its card.
  for (const p of deoverlap([card('a', 300, 40, 220)], 900)) {
    expect(p.y - p.h).toBeGreaterThanOrEqual(0)
  }
})

test('every card keeps the pin it was displaced from', () => {
  const pins = [card('a', 100, 400), card('b', 104, 402)]
  for (const pin of pins) {
    const c = deoverlap(pins, 4000).find((x) => x.id === pin.id)!
    // The leader has to land on the pin, not where the card drifted to.
    expect([c.anchorX, c.anchorY]).toEqual([pin.x, pin.y])
  }
})

test('answers that are already far apart are not displaced', () => {
  const spread = [card('a', 100, 500), card('b', 100, 900), card('c', 600, 500)]
  for (const c of deoverlap(spread, 4000)) {
    expect(c.x).toBe(c.anchorX)
    expect(c.anchorY - c.y).toBe(36)
  }
})

test('fractional coordinates terminate', () => {
  // Regression: these are the real values that froze the browser. Pushing a card
  // to `other.y + GAP + h` only clears `other` if subtracting h recovers the
  // original exactly, which floating point does not do -- so the card tested as
  // still overlapping and was re-assigned the same y forever.
  const pins = [
    card('a', 300.2481, 226.4857, 180),
    card('b', 300.7735, 252.1119, 206),
    card('c', 299.9312, 253.4857, 180),
    card('d', 300.5001, 253.9913, 208),
  ]
  const out = deoverlap(pins, 900)
  expect(out).toHaveLength(4)
  for (const p of out) expect(Number.isFinite(p.y)).toBe(true)
})

test('a viewport too short to stack them all still yields no overlaps', () => {
  // Five ~210px cards need ~1100px of column; a phone gives ~800. Folding the
  // overflow back to the top of the same column re-creates the exact overlap
  // this function exists to prevent, so it has to break into a new column.
  const pins = Array.from({ length: 5 }, (_, i) =>
    card(`l${i}`, 300 + i * 4, 320 + i * 3, 210),
  )
  const out = deoverlap(pins, 800)
  expect(out).toHaveLength(5)
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      expect(collides(out[i], out[j])).toBe(false)
  // And nothing is left hanging off the top.
  for (const p of out) expect(p.y - p.h).toBeGreaterThanOrEqual(0)
})
