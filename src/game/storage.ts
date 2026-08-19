import { previousDate } from './date'

/**
 * Safari in private mode throws on write, and anything in storage can be
 * corrupted, truncated by a quota error, or hand-edited. Nothing in here may
 * ever throw: losing a saved game is bad, but a stored value that breaks every
 * page load leaves a player with a game they can only fix by clearing site data.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // no-op
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // no-op
    }
  },
  keys(): string[] {
    try {
      // The indexed accessors, not Object.keys: localStorage only enumerates
      // as a plain object by quirk of being a host object.
      return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
        (k): k is string => k !== null,
      )
    } catch {
      return []
    }
  },
  parse<T>(key: string, fallback: T): T {
    const raw = this.get(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
}

/* ---------------------------------------------------------------- progress */

const PROGRESS_PREFIX = 'nycmap:progress:'

/**
 * Only the taps are stored. Distance, score and the miss copy are all derived
 * from a guess and the puzzle, so saving them would be duplicating the scoring
 * rules into storage -- and a later tweak to the curve would leave a resumed
 * game showing numbers the game can no longer produce.
 */
export type Progress = { guesses: { lng: number; lat: number }[] }

export function loadProgress(date: string): Progress | null {
  const saved = storage.parse<Progress | null>(PROGRESS_PREFIX + date, null)
  if (!saved || !Array.isArray(saved.guesses)) return null
  const guesses = saved.guesses.filter(
    (g) => typeof g?.lng === 'number' && typeof g?.lat === 'number',
  )
  return guesses.length ? { guesses } : null
}

export function saveProgress(date: string, progress: Progress): void {
  storage.set(PROGRESS_PREFIX + date, JSON.stringify(progress))

  // Yesterday's save is dead the moment the day turns, and one key per day
  // would accumulate for as long as somebody keeps playing.
  for (const key of storage.keys()) {
    if (key.startsWith(PROGRESS_PREFIX) && key !== PROGRESS_PREFIX + date) {
      storage.remove(key)
    }
  }
}

/* ------------------------------------------------------------------- stats */

const STATS_KEY = 'nycmap:stats'

/** Five buckets of 200, matching the 1000-point maximum. */
const BUCKETS = 5

export type Stats = {
  played: number
  streak: number
  maxStreak: number
  lastPlayed: string | null
  totalScore: number
  distribution: number[]
}

const EMPTY: Stats = {
  played: 0,
  streak: 0,
  maxStreak: 0,
  lastPlayed: null,
  totalScore: 0,
  distribution: Array(BUCKETS).fill(0),
}

export function loadStats(): Stats {
  const saved = storage.parse<Partial<Stats>>(STATS_KEY, {})
  return {
    ...EMPTY,
    ...saved,
    distribution:
      Array.isArray(saved.distribution) && saved.distribution.length === BUCKETS
        ? saved.distribution
        : [...EMPTY.distribution],
  }
}

/**
 * Idempotent per day. A player who refreshes the results screen, or reopens it
 * later the same evening, must not have their streak counted twice.
 */
export function recordGame(date: string, total: number): Stats {
  const stats = loadStats()
  if (stats.lastPlayed === date) return stats

  const continuing = stats.lastPlayed === previousDate(date)
  const streak = continuing ? stats.streak + 1 : 1
  const distribution = [...stats.distribution]
  distribution[Math.min(BUCKETS - 1, Math.floor((total / 1000) * BUCKETS))] += 1

  const next: Stats = {
    played: stats.played + 1,
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    lastPlayed: date,
    totalScore: stats.totalScore + total,
    distribution,
  }
  storage.set(STATS_KEY, JSON.stringify(next))
  return next
}
