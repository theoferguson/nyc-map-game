import { test, expect } from 'vitest'
import {
  puzzleDate,
  previousDate,
  msUntilRollover,
  formatCountdown,
  shiftDate,
  daysBetween,
} from './date'

const HOUR = 3_600_000

test('the day rolls at New York midnight, not UTC', () => {
  // 23:30 on the 19th in New York is already the 20th in UTC. Getting this
  // wrong hands city players tomorrow's puzzle at 8pm.
  expect(puzzleDate(new Date('2026-08-20T03:30:00Z'))).toBe('2026-08-19')
  expect(puzzleDate(new Date('2026-08-20T04:00:00Z'))).toBe('2026-08-20')
})

test('the day is New York\'s for everyone, wherever they are', () => {
  // Same instant, and it must resolve to the same puzzle for every player.
  const instant = new Date('2026-08-20T03:30:00Z')
  expect(puzzleDate(instant)).toBe('2026-08-19')
})

test('countdown lands exactly on the next New York midnight', () => {
  const at = new Date('2026-08-19T16:00:00Z') // noon EDT
  const rollover = new Date(at.getTime() + msUntilRollover(at))
  expect(puzzleDate(rollover)).toBe('2026-08-20')
  // And a moment earlier is still today.
  expect(puzzleDate(new Date(rollover.getTime() - 1000))).toBe('2026-08-19')
})

test('clock changes make the day 23 and 25 hours long', () => {
  // Spring forward, 8 March 2026: midnight EST to midnight EDT is 23 hours.
  const spring = new Date('2026-03-08T05:00:00Z') // 00:00 EST
  expect(msUntilRollover(spring)).toBe(23 * HOUR)

  // Fall back, 1 November 2026: midnight EDT to midnight EST is 25 hours.
  const fall = new Date('2026-11-01T04:00:00Z') // 00:00 EDT
  expect(msUntilRollover(fall)).toBe(25 * HOUR)
})

test('countdown is always a sane forward-running duration', () => {
  for (let h = 0; h < 24 * 400; h += 7) {
    const at = new Date(Date.UTC(2026, 0, 1) + h * HOUR)
    const ms = msUntilRollover(at)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(25 * HOUR)
    expect(puzzleDate(new Date(at.getTime() + ms))).toBe(previousDate(puzzleDate(new Date(at.getTime() + ms + HOUR * 25))))
  }
})

test('previousDate crosses months, years and leap days', () => {
  expect(previousDate('2026-08-19')).toBe('2026-08-18')
  expect(previousDate('2026-03-01')).toBe('2026-02-28')
  expect(previousDate('2026-01-01')).toBe('2025-12-31')
  expect(previousDate('2028-03-01')).toBe('2028-02-29')
})

test('countdown formatting', () => {
  expect(formatCountdown(0)).toBe('0:00:00')
  expect(formatCountdown(-500)).toBe('0:00:00')
  expect(formatCountdown(3 * HOUR + 4 * 60_000 + 5000)).toBe('3:04:05')
})

test('shiftDate crosses months, years and leap days', () => {
  expect(shiftDate('2026-08-21', 5)).toBe('2026-08-26')
  expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01')
  expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
  expect(shiftDate('2026-08-21', 0)).toBe('2026-08-21')
})

test('daysBetween is signed and survives a clock change', () => {
  expect(daysBetween('2026-08-21', '2026-08-26')).toBe(5)
  expect(daysBetween('2026-08-26', '2026-08-21')).toBe(-5)
  // 8 March 2026 is a 23-hour day; naive division would return 4.96 and floor
  // to 4, putting every later date one day out.
  expect(daysBetween('2026-03-05', '2026-03-10')).toBe(5)
  // 1 November 2026 is a 25-hour day.
  expect(daysBetween('2026-10-29', '2026-11-03')).toBe(5)
})
