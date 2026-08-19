import { test, expect } from 'vitest'
import { deoverlap, CARD_W, CARD_H } from './deoverlap'

const collides = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H

test('five clustered answers all end up readable', () => {
  // Worst realistic case: every answer within a few pixels, as when Manhattan
  // locations cluster at a citywide framing.
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

test('answers that are already far apart are left where they are', () => {
  const spread = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 100, y: 100 + CARD_H * 2 },
    { id: 'c', x: 100 + CARD_W * 2, y: 100 },
  ]
  expect(deoverlap(spread).sort((p, q) => p.id.localeCompare(q.id))).toEqual(spread)
})
