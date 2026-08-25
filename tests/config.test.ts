import { test, expect } from 'vitest'
import { DEFAULTS, validateConfig } from '../src/game/config.ts'

test('an empty document is the shipped defaults', () => {
  const { config, problems } = validateConfig({})
  expect(problems).toEqual([])
  expect(config).toEqual(DEFAULTS)
})

test('garbage does not take the game down with it', () => {
  for (const input of [null, undefined, 'nope', 42, []]) {
    expect(validateConfig(input).config).toEqual(DEFAULTS)
  }
})

test('a bad field falls back without discarding the good ones', () => {
  const { config, problems } = validateConfig({
    scoring: { lambda: { venue: 5000, area: -1 }, falloff: 99 },
    beta: { code: 'newcode', daysAhead: 3 },
  })
  expect(config.scoring.lambda.venue).toBe(5000)
  // Rejected, so the default stands -- a lambda of -1 scores every guess zero.
  expect(config.scoring.lambda.area).toBe(DEFAULTS.scoring.lambda.area)
  expect(config.scoring.falloff).toBe(DEFAULTS.scoring.falloff)
  // And an unrelated section is untouched by its neighbour's mistakes.
  expect(config.beta).toEqual({ code: 'newcode', daysAhead: 3 })
  expect(problems).toHaveLength(2)
})

test('the limits are the range outside which the game stops working', () => {
  expect(validateConfig({ scoring: { falloff: 0 } }).problems).toHaveLength(1)
  expect(validateConfig({ beta: { daysAhead: 2.5 } }).problems).toHaveLength(1)
  expect(validateConfig({ beta: { code: '' } }).problems).toHaveLength(1)
  expect(validateConfig({ beta: { code: 'x'.repeat(65) } }).problems).toHaveLength(1)
})

test('location overrides keep only what was actually set', () => {
  const { config } = validateConfig({
    locations: {
      katzs: { factShort: '  A corrected fact.  ' },
      wonder: { hidden: true },
      empire: { hidden: false },
      nope: { factShort: '' },
    },
  })
  expect(config.locations.katzs).toEqual({ factShort: 'A corrected fact.' })
  expect(config.locations.wonder).toEqual({ hidden: true })
  // An override that says nothing is not stored at all.
  expect(config.locations.empire).toBeUndefined()
  expect(config.locations.nope).toBeUndefined()
})

test('an oversized fact is refused rather than truncated', () => {
  const { config, problems } = validateConfig({
    locations: { katzs: { factShort: 'x'.repeat(601) } },
  })
  expect(problems).toHaveLength(1)
  expect(config.locations.katzs).toBeUndefined()
})
