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
const OUT = new URL('../puzzles/', import.meta.url)
const UA = 'nyc-map-game/0.1 (ferguson.theo@gmail.com)'

/** Day one. Sequential from here, one puzzle per calendar day. */
const START = '2026-08-20'
const BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = process.argv.includes('--check')

const days = JSON.parse(await readFile(DAYS, 'utf8'))

/* ------------------------------------------------------------- geocoding */

let looked = 0
for (const day of days) {
  for (const loc of day.locations) {
    if (loc.lat && loc.lng) continue
    if (check) {
      console.log(`  missing coords: ${loc.id}`)
      continue
    }
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(loc.query)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    const [hit] = await res.json()
    if (!hit) {
      console.error(`  NOT FOUND: ${loc.id} — "${loc.query}"`)
    } else {
      loc.lat = +(+hit.lat).toFixed(6)
      loc.lng = +(+hit.lon).toFixed(6)
      console.log(`  ok ${loc.id.padEnd(34)} ${loc.lat}, ${loc.lng}`)
    }
    looked++
    await sleep(1100)
  }
}
if (looked) await writeFile(DAYS, JSON.stringify(days, null, 2) + '\n')

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

const ids = days.flatMap((d) => d.locations.map((l) => l.id))
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
if (dupes.length) problems.push(`repeated locations: ${[...new Set(dupes)].join(', ')}`)

const mix = {}
for (const id of ids) mix[id] = 1
for (const day of days) for (const l of day.locations) mix[l.borough] = (mix[l.borough] ?? 0) + 1

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  problems.forEach((p) => console.error('  ' + p))
  process.exit(1)
}

/* --------------------------------------------------------------- assemble */

const date = (n) => {
  const [y, m, d] = START.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d + n))
  return at.toISOString().slice(0, 10)
}

if (!check) {
  for (const [i, day] of days.entries()) {
    const puzzle = {
      date: date(i),
      puzzleNumber: i + 1,
      theme: day.theme ?? null,
      locations: day.locations.map(({ query, ...keep }) => keep),
    }
    await writeFile(new URL(`${puzzle.date}.json`, OUT), JSON.stringify(puzzle, null, 2) + '\n')
  }
}

const total = ids.length
console.log(`\n${days.length} days, ${total} locations, ${date(0)} → ${date(days.length - 1)}`)
console.log(
  'borough mix: ' +
    BOROUGHS.map((b) => `${b} ${Math.round(((mix[b] ?? 0) / total) * 100)}%`).join(' · '),
)
