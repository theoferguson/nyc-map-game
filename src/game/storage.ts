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

  // Truncated at the first bad entry, never filtered. Guess N is scored against
  // location N, so dropping a corrupt one from the middle would re-pair every
  // later guess with the wrong place -- wrong distance, wrong score, wrong copy,
  // and no sign anything went wrong.
  const guesses: Progress['guesses'] = []
  for (const g of saved.guesses) {
    if (!Number.isFinite(g?.lng) || !Number.isFinite(g?.lat)) break
    guesses.push({ lng: g.lng, lat: g.lat })
  }
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
  // `?? {}` is load-bearing: the string "null" parses cleanly to null, which
  // would throw below -- during render, via useState(loadStats) -- and leave a
  // blank page fixable only by clearing site data.
  const saved = storage.parse<Partial<Stats> | null>(STATS_KEY, {}) ?? {}
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

/* ---------------------------------------------------------------- settings */

const SETTINGS_KEY = 'nycmap:settings'

export type Settings = {
  carefulMode: boolean
  /** Milliseconds a press must be held before it commits. */
  holdMs: number
  /** Shapes instead of colours in the share squares. */
  colorblind: boolean
}

/**
 * 800ms, not the 3s the spec floated as an option.
 *
 * Three seconds times five rounds times every day is a chore, and a standard
 * long-press is around 500ms -- so 800 already reads as deliberate without
 * making deliberate feel like waiting. The longer options exist for players who
 * need them, which is the point of the setting.
 */
export const HOLD_OPTIONS = [800, 1500, 3000]

const DEFAULT_SETTINGS: Settings = {
  // Off by default: a tap that commits is the core of the game, and making
  // everyone hold to fix a problem only some players have is the wrong trade.
  carefulMode: false,
  holdMs: HOLD_OPTIONS[0],
  colorblind: false,
}

export function loadSettings(): Settings {
  const saved = storage.parse<Partial<Settings> | null>(SETTINGS_KEY, {}) ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    // A hold duration outside the offered set means edited or stale storage;
    // an absurd value here would lock the player out of placing a pin at all.
    holdMs: HOLD_OPTIONS.includes(saved.holdMs as number)
      ? (saved.holdMs as number)
      : DEFAULT_SETTINGS.holdMs,
  }
}

export function saveSettings(settings: Settings): void {
  storage.set(SETTINGS_KEY, JSON.stringify(settings))
}
