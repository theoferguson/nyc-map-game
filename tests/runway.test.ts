import { test, expect } from 'vitest'
import { runwayDays } from '../scripts/runway.mjs'

const TODAY = '2026-08-27'

test('counts to the last authored day', () => {
  expect(runwayDays(['2026-08-26', '2026-08-27', '2026-09-10'], TODAY)).toBe(14)
  expect(runwayDays(['2026-08-27'], TODAY)).toBe(0)
})

test('an exhausted queue is null, not a silent zero', () => {
  // The bug this module exists for. Inline, the missing last date produced NaN,
  // and `NaN < threshold` is false -- so the alarm for running out of content
  // said nothing at exactly the moment content ran out.
  expect(runwayDays(['2026-08-20', '2026-08-26'], TODAY)).toBeNull()
  expect(runwayDays([], TODAY)).toBeNull()
})

test('unsorted input is still measured from the furthest day', () => {
  expect(runwayDays(['2026-09-10', '2026-08-28', '2026-09-02'], TODAY)).toBe(14)
})

test('garbage dates do not read as a healthy runway', () => {
  expect(runwayDays(['not-a-date'], TODAY)).toBeNull()
})
