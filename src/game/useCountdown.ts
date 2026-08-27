import { useEffect, useState } from 'react'
import { msUntilRollover, formatCountdown } from './date'

/**
 * Ticks once a second, but only where a countdown is actually on screen -- which
 * is never mid-game. That matters: reaching zero reloads to pick up the new
 * day's puzzle, and a player who started before midnight must be left alone to
 * finish the day they started rather than have it pulled out from under them.
 */
export function useCountdown(): string {
  const [ms, setMs] = useState(msUntilRollover)
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = msUntilRollover()
      if (remaining <= 0) window.location.reload()
      setMs(remaining)
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return formatCountdown(ms)
}
