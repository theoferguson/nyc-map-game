/**
 * Runtime configuration: the handful of things worth changing without a deploy.
 *
 * Deliberately small. Most of what an admin panel could expose should not be a
 * live knob -- round multipliers change what a share string means, and content
 * scheduling already lives in git where it has history and review. What is here
 * either needs fast iteration (scoring, tuned by feel) or has an urgent path
 * (a wrong answer that is live right now).
 *
 * Everything degrades to `DEFAULTS`, which are the values the app shipped with.
 * The config fetch is on the boot path, so it fails open: a slow endpoint, a
 * malformed document or no database at all leaves the game playing exactly as
 * it does today.
 */

export type ScoringConfig = {
  lambda: { area: number; landmark: number; venue: number }
  falloff: number
  bullseyeM: number
}

/** Per-location corrections. Keyed by location id, applied after decoding. */
export type LocationOverride = {
  /** Replaces the authored fact. For fixing something wrong that is already live. */
  factShort?: string
  /** Drops the round entirely. The day plays one round shorter. */
  hidden?: boolean
}

export type Config = {
  scoring: ScoringConfig
  beta: { code: string; daysAhead: number }
  locations: Record<string, LocationOverride>
}

export const DEFAULTS: Config = {
  scoring: {
    lambda: { area: 4200, landmark: 2800, venue: 3600 },
    falloff: 1.5,
    bullseyeM: 40,
  },
  beta: { code: 'fivepoints', daysAhead: 5 },
  locations: {},
}

/**
 * Bounds, not preferences. Each one is the range outside which the game stops
 * working rather than merely playing differently -- a lambda of 1 scores every
 * guess zero, a falloff of 0 scores every guess 100. The admin panel is a
 * trusted surface, but a typo is not an attack and should still bounce.
 */
const LIMITS = {
  lambda: [100, 50_000],
  falloff: [0.5, 4],
  bullseyeM: [0, 500],
  daysAhead: [0, 30],
  codeLength: 64,
  factLength: 600,
  locationCount: 200,
} as const

const between = (n: unknown, [lo, hi]: readonly [number, number]): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

/**
 * Returns the config with anything invalid replaced by its default, plus the
 * list of what was rejected.
 *
 * Field-by-field rather than all-or-nothing on purpose: one bad lambda should
 * not silently discard a fact correction saved half an hour earlier. The
 * endpoint refuses a write that produced any problems; the client accepts the
 * repaired document, because a partly-usable config beats none on the boot path.
 */
export function validateConfig(raw: unknown): { config: Config; problems: string[] } {
  const problems: string[] = []
  const input = (raw ?? {}) as Partial<Config>
  const config: Config = structuredClone(DEFAULTS)

  const scoring = input.scoring
  if (scoring && typeof scoring === 'object') {
    for (const cls of ['area', 'landmark', 'venue'] as const) {
      const value = scoring.lambda?.[cls]
      if (value === undefined) continue
      if (between(value, LIMITS.lambda)) config.scoring.lambda[cls] = value
      else problems.push(`scoring.lambda.${cls} must be ${LIMITS.lambda[0]}-${LIMITS.lambda[1]}`)
    }
    if (scoring.falloff !== undefined) {
      if (between(scoring.falloff, LIMITS.falloff)) config.scoring.falloff = scoring.falloff
      else problems.push(`scoring.falloff must be ${LIMITS.falloff[0]}-${LIMITS.falloff[1]}`)
    }
    if (scoring.bullseyeM !== undefined) {
      if (between(scoring.bullseyeM, LIMITS.bullseyeM)) config.scoring.bullseyeM = scoring.bullseyeM
      else problems.push(`scoring.bullseyeM must be ${LIMITS.bullseyeM[0]}-${LIMITS.bullseyeM[1]}`)
    }
  }

  const beta = input.beta
  if (beta && typeof beta === 'object') {
    if (beta.code !== undefined) {
      const code = typeof beta.code === 'string' ? beta.code.trim() : ''
      if (code && code.length <= LIMITS.codeLength) config.beta.code = code
      else problems.push(`beta.code must be 1-${LIMITS.codeLength} characters`)
    }
    if (beta.daysAhead !== undefined) {
      if (between(beta.daysAhead, LIMITS.daysAhead) && Number.isInteger(beta.daysAhead)) {
        config.beta.daysAhead = beta.daysAhead
      } else problems.push(`beta.daysAhead must be a whole number 0-${LIMITS.daysAhead[1]}`)
    }
  }

  const locations = input.locations
  if (locations && typeof locations === 'object' && !Array.isArray(locations)) {
    const entries = Object.entries(locations)
    if (entries.length > LIMITS.locationCount) {
      problems.push(`at most ${LIMITS.locationCount} location overrides`)
    }
    for (const [id, value] of entries.slice(0, LIMITS.locationCount)) {
      if (!id || id.length > 64 || !value || typeof value !== 'object') {
        problems.push(`locations.${id}: not a valid override`)
        continue
      }
      const override: LocationOverride = {}
      const fact = (value as LocationOverride).factShort
      if (fact !== undefined) {
        if (typeof fact === 'string' && fact.trim() && fact.length <= LIMITS.factLength) {
          override.factShort = fact.trim()
        } else problems.push(`locations.${id}.factShort must be 1-${LIMITS.factLength} characters`)
      }
      if ((value as LocationOverride).hidden === true) override.hidden = true
      if (Object.keys(override).length > 0) config.locations[id] = override
    }
  }

  return { config, problems }
}
