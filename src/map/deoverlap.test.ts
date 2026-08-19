import { test, expect } from 'vitest'
import { deoverlap, CARD_W, CARD_H } from './deoverlap'

const collides = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H

test('five clustered answers all end up readable', () => {
  // Worst realistic case: every answer within a few pixels, as when Manhattan
  // locations cluster at the recap framing.
  const stacked = Array.from({ length: 5 }, (_, i) => ({
    id: `l${i}`,
    x: 200 + i * 3,
    y: 300 + i * 2,
  }))

  const out = deoverlap(stacked)
  expect(out).toHaveLength(5)
  expect(new Set(out.map((p) => p.id)).size).toBe(5)

  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      expect(collides(out[i], out[j])).toBe(false)
})

test('every card keeps the pin it was displaced from', () => {
  const pins = [
    { id: 'a', x: 100, y: 400 },
    { id: 'b', x: 104, y: 402 },
  ]
  const out = deoverlap(pins)

  for (const pin of pins) {
    const card = out.find((c) => c.id === pin.id)!
    // The leader line has to land on the pin, not on where the card drifted to.
    expect(card.anchorX).toBe(pin.x)
    expect(card.anchorY).toBe(pin.y)
  }
})

test('answers that are already far apart are not displaced', () => {
  const spread = [
    { id: 'a', x: 100, y: 400 },
    { id: 'b', x: 100, y: 400 + CARD_H * 2 },
    { id: 'c', x: 100 + CARD_W * 2, y: 400 },
  ]
  // Each card sits directly above its own pin: same x, no vertical drift.
  for (const card of deoverlap(spread)) {
    expect(card.x).toBe(card.anchorX)
    expect(card.anchorY - card.y).toBe(36)
  }
})
