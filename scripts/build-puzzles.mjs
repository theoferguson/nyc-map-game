/**
 * Encodes puzzles/*.json into public/puzzles/*.json.
 *
 * Static JSON means the answers sit in devtools. Wordle shipped its entire word
 * list and survived, so this is not fatal -- but a date-keyed XOR over the
 * locations blob stops casual peeking for almost no effort. Authors edit the
 * plain files in puzzles/; only the encoded ones ship.
 *
 *   npm run puzzles:build
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'

const SRC = new URL('../puzzles/', import.meta.url)
const OUT = new URL('../public/puzzles/', import.meta.url)

/** Shared with the client decoder in src/data/loadPuzzle.ts -- keep in step. */
export function xor(bytes, key) {
  const k = new TextEncoder().encode(key)
  return bytes.map((b, i) => b ^ k[i % k.length])
}

await mkdir(OUT, { recursive: true })
const files = (await readdir(SRC)).filter((f) => f.endsWith('.json'))

for (const file of files) {
  const puzzle = JSON.parse(await readFile(new URL(file, SRC), 'utf8'))
  const plain = new TextEncoder().encode(JSON.stringify(puzzle.locations))
  const encoded = Buffer.from(xor(plain, puzzle.date)).toString('base64')

  await writeFile(
    new URL(file, OUT),
    JSON.stringify({ ...puzzle, locations: encoded }),
  )
  console.log(`ok  ${file}  ${puzzle.locations.length} locations  ${encoded.length} b64 chars`)
}
console.log(`\nbuilt ${files.length} puzzle(s)`)
