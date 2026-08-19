import { test, expect } from 'vitest'
import { MAX_TOTAL, MULTIPLIERS, totalScore, shareString } from './share'

const perfect = MULTIPLIERS.map(() => ({ score: 100, distanceM: 0 }))

test('multipliers top out at exactly 1000', () => {
  expect(MAX_TOTAL).toBe(1000)
  expect(totalScore(perfect)).toBe(1000)
  expect(totalScore(MULTIPLIERS.map(() => ({ score: 0, distanceM: 9e3 })))).toBe(0)
})

test('later rounds are worth more than earlier ones', () => {
  const one = (i: number) =>
    MULTIPLIERS.map((_, j) => ({ score: j === i ? 100 : 0, distanceM: 0 }))
  expect(totalScore(one(4))).toBeGreaterThan(totalScore(one(0)))
})

test('share string matches the published format', () => {
  expect(shareString(47, perfect)).toBe(
    'NYC Daily #47 — 1000/1000\n🟩🟩🟩🟩🟩\nmedian 0.0 blocks off',
  )

  const mixed = [
    { score: 95, distanceM: 30 },   // green
    { score: 80, distanceM: 120 },  // green, on the boundary
    { score: 62, distanceM: 300 },  // yellow
    { score: 12, distanceM: 2000 }, // white
    { score: 35, distanceM: 800 },  // orange
  ]
  const [header, squares, avg] = shareString(1, mixed).split('\n')
  expect(header).toBe('NYC Daily #1 — 440/1000')
  expect(squares).toBe('🟩🟩🟨⬜🟧')
  expect(avg).toBe('median 4 blocks off')
})

test('one disastrous round does not define the line', () => {
  // Four good guesses and one in the wrong borough. The mean read "9.9 blocks"
  // beside a strong score; the median reports the game the player actually had.
  const oneBadRound = [
    { score: 96, distanceM: 150 },
    { score: 94, distanceM: 220 },
    { score: 91, distanceM: 300 },
    { score: 88, distanceM: 400 },
    { score: 2, distanceM: 12_000 },
  ]
  expect(shareString(1, oneBadRound).split('\n')[2]).toBe('median 4 blocks off')
})

test('share string is plain text that pastes anywhere', () => {
  const s = shareString(1, perfect)
  expect(s.split('\n')).toHaveLength(3)
  expect(s).not.toMatch(/<|>|&\w+;/)
})

test('colourblind squares change encoding, not just hue', () => {
  const mixed = [
    { score: 95, distanceM: 30 },
    { score: 62, distanceM: 300 },
    { score: 35, distanceM: 800 },
    { score: 12, distanceM: 2000 },
    { score: 88, distanceM: 120 },
  ]
  expect(shareString(1, mixed, false).split('\n')[1]).toBe('🟩🟨🟧⬜🟩')

  // Fill level, not colour. Green/yellow/orange is the axis red-green
  // colourblindness collapses, so a recoloured palette would still leave most
  // of these bands indistinguishable.
  const shapes = shareString(1, mixed, true).split('\n')[1]
  expect(shapes).toBe('●◕◔○●')
  expect(new Set([...shapes]).size).toBe(4)
})
