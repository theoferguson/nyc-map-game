/**
 * Brings database content back into puzzles/ and content/days.json.
 *
 *   DATABASE_URL=... npm run puzzles:pull
 *
 * The admin panel edits the database directly, so after any edit the local
 * files are stale -- and the next `puzzles:push` would silently overwrite the
 * edit with whatever is on disk. Pull first, or lose the change.
 *
 * `query` is not stored in the puzzle payload (it exists only to geocode), so
 * it is preserved from the local file by id wherever one already exists.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import postgres from 'postgres'

const OUT = new URL('../puzzles/', import.meta.url)
const DAYS = new URL('../content/days.json', import.meta.url)

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

function xor(bytes, key) {
  const k = new TextEncoder().encode(key)
  return bytes.map((b, i) => b ^ k[i % k.length])
}

/** id -> query, from whatever is already on disk. */
const queries = {}
try {
  for (const day of JSON.parse(await readFile(DAYS, 'utf8'))) {
    for (const l of day.locations) if (l.query) queries[l.id] = l.query
  }
} catch {
  console.warn('no local content/days.json to recover queries from')
}

const sql = postgres(url, { max: 1 })
const rows = await sql`select date::text, puzzle_number, theme, locations from puzzles order by date`
await sql.end()

const existing = new Set((await readdir(OUT)).filter((f) => f.endsWith('.json')))
const days = []
let missingQuery = 0

for (const r of rows) {
  const bytes = xor(Uint8Array.from(Buffer.from(r.locations, 'base64')), r.date)
  const locations = JSON.parse(new TextDecoder().decode(bytes))
  await writeFile(
    new URL(`${r.date}.json`, OUT),
    JSON.stringify(
      { date: r.date, puzzleNumber: r.puzzle_number, theme: r.theme, locations },
      null,
      2,
    ) + '\n',
  )
  existing.delete(`${r.date}.json`)

  // puzzleNumber 0 is the placeholder, which lives in content/preview.json and
  // is not part of the authored queue.
  if (r.puzzle_number > 0) {
    days.push({
      theme: r.theme,
      locations: locations.map((l) => {
        if (!queries[l.id]) missingQuery++
        return { ...l, query: queries[l.id] ?? l.name }
      }),
    })
  }
}

await writeFile(DAYS, JSON.stringify(days, null, 2) + '\n')

console.log(`pulled ${rows.length} day(s); ${days.length} into content/days.json`)
if (existing.size) console.log(`local files with no row: ${[...existing].join(', ')}`)
if (missingQuery) console.log(`${missingQuery} location(s) had no local query; used the name`)
