/**
 * Turns hand-authored days in content/days.json into dated puzzles.
 *
 * Authors never type coordinates. Every location carries a `query` instead,
 * which is geocoded against Nominatim and cached back into the file. Across 250
 * locations, hand-entered latitudes are a guarantee of silent errors -- and a
 * wrong coordinate does not look wrong, it just marks correct answers wrong.
 *
 *   node scripts/author.mjs            geocode anything missing, then assemble
 *   node scripts/author.mjs --check    report gaps and rule violations only
 *
 * Nominatim asks for one request a second and an identifying user agent. Cached
 * results mean that cost is paid once per location, ever.
 */
import { readFile, writeFile } from 'node:fs/promises'

const DAYS = new URL('../content/days.json', import.meta.url)
const PREVIEW = new URL('../content/preview.json', import.meta.url)
const OUT = new URL('../puzzles/', import.meta.url)
const UA = 'nyc-map-game/0.1 (ferguson.theo@gmail.com)'

/**
 * The real queue begins here, one puzzle per calendar day.
 *
 * Every date from PREVIEW_FROM up to the day before it serves the same
 * placeholder puzzle, so the game is playable before launch without burning a
 * day of authored content. Those are numbered 0 -- a share string reading
 * "NYC Daily #0" is a clearer signal that this is not the real thing than any
 * numbering that looks legitimate.
 */
const START = '2026-08-25'
const PREVIEW_FROM = '2026-08-20'
const BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island']

/** [west, south, east, north] -- mirrors the map's own bounds. */
const NYC = [-74.3, 40.47, -73.68, 40.93]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = process.argv.includes('--check')

const days = JSON.parse(await readFile(DAYS, 'utf8'))
const preview = JSON.parse(await readFile(PREVIEW, 'utf8'))

/* ------------------------------------------------------------- geocoding */

let looked = 0
for (const day of [preview, ...days]) {
  for (const loc of day.locations) {
    if (loc.lat && loc.lng) continue
    if (check) {
      console.log(`  missing coords: ${loc.id}`)
      continue
    }
    // Bounded to the city, and not as an optimisation.
    //
    // Over-qualifying a query ("X, Brooklyn, New York") makes Nominatim return
    // nothing; stripping the qualifier makes it return the best match on earth,
    // which for "Nathan's Famous" is a restaurant in Moscow. A confidently
    // wrong coordinate is far worse than a missing one -- it marks correct
    // answers wrong and looks fine doing it. viewbox+bounded means a bare name
    // can only ever resolve inside New York.
    const box = `${NYC[0]},${NYC[3]},${NYC[2]},${NYC[1]}`
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=1` +
      `&viewbox=${box}&bounded=1&q=${encodeURIComponent(loc.query)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    const [hit] = await res.json()
    if (!hit) {
      console.error(`  NOT FOUND: ${loc.id} — "${loc.query}"`)
    } else if (hit.class === 'route') {
      // A route is a line, and Nominatim answers with its centre. "Staten
      // Island Ferry" resolved to the middle of the Upper Bay -- open water,
      // miles from either dock, and no player could ever have been right.
      // Inside the viewbox, inside NYC, plausible to every other check.
      // Ask for a terminal, a station, a building: something that is a place.
      console.error(`  ROUTE, NOT A PLACE: ${loc.id} — "${loc.query}" is a ${hit.type} route`)
    } else {
      loc.lat = +(+hit.lat).toFixed(6)
      loc.lng = +(+hit.lon).toFixed(6)
      // class/type printed because a linear feature is the failure that looks
      // most like a success -- a street or a river centre is a real coordinate.
      console.log(`  ok ${loc.id.padEnd(34)} ${loc.lat}, ${loc.lng}  (${hit.class}/${hit.type})`)
    }
    looked++
    await sleep(1100)
  }
}
if (looked) {
  await writeFile(DAYS, JSON.stringify(days, null, 2) + '\n')
  await writeFile(PREVIEW, JSON.stringify(preview, null, 2) + '\n')
}

/* --------------------------------------------------------------- validate */

const problems = []
days.forEach((day, i) => {
  const where = `day ${i + 1}`
  if (day.locations.length !== 5) problems.push(`${where}: ${day.locations.length} locations`)

  const diffs = day.locations.map((l) => l.difficulty)
  if (diffs.some((d, j) => j && d < diffs[j - 1]))
    problems.push(`${where}: difficulty does not climb (${diffs.join(',')})`)

  const outside = day.locations.filter((l) => l.borough !== 'manhattan').length
  if (outside < 2) problems.push(`${where}: only ${outside} outside Manhattan`)

  for (const l of day.locations) {
    if (!l.lat || !l.lng) problems.push(`${where}: ${l.id} has no coordinates`)
    else if (l.lng < -74.3 || l.lng > -73.68 || l.lat < 40.47 || l.lat > 40.93)
      problems.push(`${where}: ${l.id} outside NYC bounds (${l.lat}, ${l.lng})`)
    if (!BOROUGHS.includes(l.borough)) problems.push(`${where}: ${l.id} borough "${l.borough}"`)
    if (!['area', 'landmark', 'venue'].includes(l.class))
      problems.push(`${where}: ${l.id} class "${l.class}"`)
    if ((l.tags ?? []).length < 3) problems.push(`${where}: ${l.id} needs 3+ tags`)
    if ((l.factShort ?? '').length < 60) problems.push(`${where}: ${l.id} fact too short`)
    if (!l.sourceUrl) problems.push(`${where}: ${l.id} has no source`)
  }
})

const all = days.flatMap((d) => d.locations)
const ids = all.map((l) => l.id)
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
if (dupes.length) problems.push(`repeated ids: ${[...new Set(dupes)].join(', ')}`)

// Distinct ids can still be the same place under two names, which only shows up
// as a player being asked to find somewhere they already found.
for (const field of ['query', 'name']) {
  const seen = all.map((l) => l[field].toLowerCase())
  const twice = seen.filter((v, i) => seen.indexOf(v) !== i)
  if (twice.length) problems.push(`same ${field} twice: ${[...new Set(twice)].join(', ')}`)
}

const mix = {}
for (const id of ids) mix[id] = 1
for (const day of days) for (const l of day.locations) mix[l.borough] = (mix[l.borough] ?? 0) + 1

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  problems.forEach((p) => console.error('  ' + p))
  process.exit(1)
}

/* --------------------------------------------------------------- assemble */

const date = (from, n) => {
  const [y, m, d] = from.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const previewDays = Math.round(
  (Date.parse(START) - Date.parse(PREVIEW_FROM)) / 86_400_000,
)

if (!check) {
  for (let i = 0; i < previewDays; i++) {
    const d = date(PREVIEW_FROM, i)
    await writeFile(
      new URL(`${d}.json`, OUT),
      JSON.stringify(
        {
          date: d,
          puzzleNumber: 0,
          theme: preview.theme ?? null,
          locations: preview.locations.map(({ query: _q, ...keep }) => keep),
        },
        null,
        2,
      ) + '\n',
    )
  }

  for (const [i, day] of days.entries()) {
    const puzzle = {
      date: date(START, i),
      puzzleNumber: i + 1,
      theme: day.theme ?? null,
      locations: day.locations.map(({ query: _q, ...keep }) => keep),
    }
    await writeFile(new URL(`${puzzle.date}.json`, OUT), JSON.stringify(puzzle, null, 2) + '\n')
  }
}

const total = ids.length
console.log(`\npreview: ${previewDays} days, ${PREVIEW_FROM} → ${date(PREVIEW_FROM, previewDays - 1)}`)
console.log(`queue:   ${days.length} days, ${total} locations, ${date(START, 0)} → ${date(START, days.length - 1)}`)
console.log(
  'borough mix: ' +
    BOROUGHS.map((b) => `${b} ${Math.round(((mix[b] ?? 0) / total) * 100)}%`).join(' · '),
)
