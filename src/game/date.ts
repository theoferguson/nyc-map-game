/**
 * The puzzle day is New York's day.
 *
 * Not UTC and not the device clock: a player in the city would roll over to
 * tomorrow's puzzle at 8pm on UTC, and a player in Berlin would get New York's
 * Tuesday on their Wednesday morning. The game is about one city, so it keeps
 * that city's calendar for everyone.
 */
const NY = 'America/New_York'

const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function nyParts(at: Date) {
  const parts = Object.fromEntries(
    FORMAT.formatToParts(at).map((p) => [p.type, p.value]),
  )
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour,
    minute: +parts.minute,
    second: +parts.second,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` for whichever day it currently is in New York. */
export function puzzleDate(at: Date = new Date()): string {
  const p = nyParts(at)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** The day before a puzzle date, for streak continuity. */
export function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const previous = new Date(Date.UTC(y, m - 1, d - 1))
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`
}

/** New York's offset from UTC at a given instant, in ms. Negative west of UTC. */
function offsetMs(at: Date): number {
  const p = nyParts(at)
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asIfUTC - Math.floor(at.getTime() / 1000) * 1000
}

export function msUntilRollover(at: Date = new Date()): number {
  const p = nyParts(at)
  const midnight = Date.UTC(p.year, p.month - 1, p.day + 1)

  // Resolved twice: the first pass uses today's offset, the second uses the
  // offset actually in force at the instant found. They differ across a clock
  // change, which is why the day before one is 23 hours long and the day before
  // the other is 25.
  const firstPass = midnight - offsetMs(at)
  const resolved = midnight - offsetMs(new Date(firstPass))
  return resolved - at.getTime()
}

/** `H:MM:SS` until the next puzzle. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${h}:${pad(m)}:${pad(total % 60)}`
}

/** `date` shifted by whole days, staying on the puzzle-date calendar. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d + days))
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}
