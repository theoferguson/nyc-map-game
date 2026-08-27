/**
 * Days of authored content remaining, or null if there are none.
 *
 * Its own module because it is the one calculation in the health check whose
 * failure mode is silence. Written inline it read fine and was wrong: with an
 * exhausted queue there is no last date, the subtraction yields NaN, and
 * `NaN < threshold` is false -- so the alarm for running out of content stayed
 * quiet precisely when the content had run out.
 */
export function runwayDays(dates, today) {
  const future = dates.filter((d) => d >= today).sort()
  const last = future.at(-1)
  if (!last) return null
  const days = Math.round((Date.parse(last) - Date.parse(today)) / 86_400_000)
  return Number.isFinite(days) ? days : null
}
