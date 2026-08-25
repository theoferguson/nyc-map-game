/**
 * Uploads puzzles/*.json into the database. Content is no longer shipped with
 * the build, so this is how an authored day reaches players:
 *
 *   DATABASE_URL=... npm run puzzles:push
 *
 * Idempotent -- re-running replaces each day with what is on disk.
 */
import { readdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { encodeLocations } from './encode.mjs'

const SRC = new URL('../puzzles/', import.meta.url)

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const files = (await readdir(SRC)).filter((f) => f.endsWith('.json')).sort()
if (files.length === 0) {
  console.error(`no puzzles found in ${SRC.pathname}`)
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
let pushed = 0

for (const file of files) {
  const puzzle = JSON.parse(await readFile(new URL(file, SRC), 'utf8'))
  const encoded = encodeLocations(puzzle.locations, puzzle.date)

  await sql`
    insert into puzzles (date, puzzle_number, theme, locations)
    values (${puzzle.date}, ${puzzle.puzzleNumber}, ${puzzle.theme}, ${encoded})
    on conflict (date) do update
      set puzzle_number = excluded.puzzle_number,
          theme = excluded.theme,
          locations = excluded.locations`
  pushed++
}

/**
 * Days on disk are the source of truth, so anything else in the table is a
 * leftover -- a shifted schedule strands the old tail date, which would then
 * keep serving content nothing regenerates.
 *
 * Guarded on a plausible push rather than a flag: the danger is running this
 * against a partial directory, not against a full one.
 */
if (pushed >= 10) {
  const dates = files.map((f) => f.replace(/\.json$/, ''))
  const stale = await sql`delete from puzzles where date::text <> all(${dates}) returning date::text`
  if (stale.length) console.log(`removed ${stale.length} stale day(s): ${stale.map((r) => r.date).join(', ')}`)
} else {
  console.log(`only ${pushed} day(s) pushed — skipping the prune`)
}

const [{ count }] = await sql`select count(*)::int from puzzles`
const [{ first, last }] = await sql`select min(date)::text first, max(date)::text last from puzzles`
await sql.end()

console.log(`pushed ${pushed} puzzle(s); ${count} in the database, ${first} to ${last}`)
