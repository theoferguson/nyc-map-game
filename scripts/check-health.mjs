/**
 * Alarms on the game being broken in ways that look fine.
 *
 * A sibling to check-tiles, and the same reasoning: the failures this project
 * actually has all produce plausible output rather than errors. A dead database
 * still serves the page. A bad deploy still returns 200 at the root. An empty
 * events table reads as "nobody played" whether nobody played or the pipeline
 * broke. None of that shows up without someone deliberately looking.
 *
 *   node scripts/check-health.mjs                    public checks only
 *   ADMIN_TOKEN=... node scripts/check-health.mjs    plus runway and traffic
 *
 * Depends on node built-ins only, like check-tiles, so the alarm cannot be
 * broken by the dependency tree it exists to outlive. It talks to the deployed
 * site rather than the database for the same reason: no credential in CI, and
 * it tests what players actually reach.
 */

import { runwayDays } from './runway.mjs'

const SITE = process.env.SITE ?? 'https://nyc-map-game.vercel.app'
const TOKEN = process.env.ADMIN_TOKEN ?? ''
/** Below this, authoring is no longer a background task. */
const MIN_RUNWAY_DAYS = Number(process.env.MIN_RUNWAY_DAYS ?? 14)
/** Traffic below this says nothing, so the completion check stays quiet. */
const MIN_LOADS = Number(process.env.MIN_LOADS ?? 10)

const problems = []
const notes = []
const fail = (m) => problems.push(m)
const note = (m) => notes.push(m)

const nyDate = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Mirror of the client decoder. */
function decode(blob, date) {
  const key = new TextEncoder().encode(date)
  const bytes = Uint8Array.from(Buffer.from(blob, 'base64')).map((b, i) => b ^ key[i % key.length])
  return JSON.parse(new TextDecoder().decode(bytes))
}

const today = nyDate(0)
const tomorrow = nyDate(1)

/* ------------------------------------------------- the game loads and plays */

try {
  const res = await fetch(`${SITE}/api/puzzle?date=${today}`)
  if (!res.ok) {
    fail(`today's puzzle (${today}) returned ${res.status} — nobody can play`)
  } else {
    const body = await res.json()
    const locations = decode(body.locations, body.date)

    if (locations.length !== 5) fail(`today has ${locations.length} locations, expected 5`)

    const diffs = locations.map((l) => l.difficulty)
    if (diffs.some((d, i) => i > 0 && d < diffs[i - 1])) {
      fail(`today's difficulty does not climb (${diffs.join(',')})`)
    }

    // The Staten Island Ferry check. A coordinate outside the extent the map
    // clamps to is unreachable, so the round is unwinnable and nothing about
    // the page looks wrong.
    for (const l of locations) {
      if (l.lng <= -74.3 || l.lng >= -73.68 || l.lat <= 40.47 || l.lat >= 40.93) {
        fail(`today: ${l.id} is at ${l.lat}, ${l.lng} — outside New York`)
      }
    }
    note(`today ${today} is puzzle #${body.puzzleNumber}, ${locations.length} locations`)
  }
} catch (e) {
  fail(`today's puzzle could not be fetched: ${e.message}`)
}

/* ------------------------------------------------------- the gate still holds */

try {
  const res = await fetch(`${SITE}/api/puzzle?date=${tomorrow}`)
  if (res.status !== 404) {
    fail(`tomorrow (${tomorrow}) returned ${res.status}, expected 404 — future content is exposed`)
  }
} catch (e) {
  fail(`gate check failed: ${e.message}`)
}

/* ------------------------------------------------------------------- config */

try {
  const res = await fetch(`${SITE}/api/config`)
  const body = await res.json()
  if (!res.ok) fail(`config returned ${res.status}`)
  else if (!(body.config?.scoring?.lambda?.venue > 0)) fail('config has no usable scoring curve')
  else if ('code' in (body.config.beta ?? {})) fail('the beta code is being published in the public config')
} catch (e) {
  fail(`config could not be fetched: ${e.message}`)
}

/* ------------------------------------------- the events endpoint is deployed */

try {
  // GET is not allowed, which is exactly what a live function says. A POST
  // would prove more and cost a row in the table on every run.
  const res = await fetch(`${SITE}/api/events`)
  if (res.status !== 405) fail(`/api/events returned ${res.status} to GET, expected 405`)
} catch (e) {
  fail(`/api/events unreachable: ${e.message}`)
}

/* ------------------------------------------------ runway and traffic (token) */

if (!TOKEN) {
  note('no ADMIN_TOKEN — skipped content runway and traffic checks')
} else {
  const admin = (body) =>
    fetch(`${SITE}/api/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify(body),
    })

  try {
    const res = await admin({ action: 'dates' })
    if (!res.ok) {
      fail(`could not list authored days (${res.status})`)
    } else {
      const { dates } = await res.json()
      const all = dates.map((d) => d.date)
      const left = runwayDays(all, today)
      const last = all.filter((d) => d >= today).sort().at(-1)
      if (left === null) {
        fail('no content for today or any day after it — the queue is empty')
      } else if (left < MIN_RUNWAY_DAYS) {
        fail(`only ${left} day(s) of content left, through ${last}`)
      } else {
        note(`${left} days of content, through ${last}`)
      }
    }
  } catch (e) {
    fail(`runway check failed: ${e.message}`)
  }

  try {
    const res = await fetch(`${SITE}/api/stats`, {
      method: 'POST',
      headers: { 'x-admin-token': TOKEN },
    })
    if (!res.ok) {
      fail(`could not read traffic (${res.status})`)
    } else {
      const { days } = await res.json()
      const yesterday = days?.find((d) => d.date === nyDate(-1))
      if (!yesterday) {
        note('no traffic recorded yesterday')
      } else if (yesterday.loads >= MIN_LOADS && !yesterday.completes) {
        // Everyone who started gave up, or the game breaks partway. Either is
        // worth waking up to; neither shows anywhere else.
        fail(`${yesterday.loads} loads yesterday and zero completions`)
      } else {
        note(`yesterday: ${yesterday.loads} loads, ${yesterday.completes ?? 0} finished`)
      }
    }
  } catch (e) {
    fail(`traffic check failed: ${e.message}`)
  }
}

/* ------------------------------------------------------------------ verdict */

for (const n of notes) console.log(`ok    ${n}`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
console.log(`\nhealthy`)
