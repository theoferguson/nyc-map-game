/**
 * Fails if a tile endpoint stops serving real imagery. The whole game is
 * unplayable if this breaks, and it breaks silently -- DoITT already dropped
 * every year after 2018 without notice.
 *
 * Reads the URLs straight out of src/map/tiles.ts so the two cannot drift.
 *
 *   npm run check:tiles
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Midtown Manhattan, and the same tile at z18 -- the zoom cap the game enforces.
const COORDS = [
  { z: 15, x: 9649, y: 12315 },
  { z: 18, x: 77196, y: 98524 },
]

const src = await readFile(new URL('../src/map/tiles.ts', import.meta.url), 'utf8')
const urls = src.match(/https:\/\/[^'"\s]+/g) ?? []
assert.ok(urls.length, 'no URLs found in tiles.ts -- did the file move?')

const isImage = (b) =>
  (b[0] === 0x89 && b[1] === 0x50) || // PNG
  (b[0] === 0xff && b[1] === 0xd8)    // JPEG

let checked = 0
for (const url of urls) {
  // A template gets checked at both zooms; a probe URL is already concrete.
  const targets = url.includes('{z}')
    ? COORDS.map((c) => url.replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y))
    : [url]

  for (const target of targets) {
    const res = await fetch(target)
    assert.equal(res.status, 200, `${target}\n  expected 200, got ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    assert.ok(isImage(bytes), `${target}\n  not image bytes (${res.headers.get('content-type')})`)
    assert.ok(bytes.length > 2000, `${target}\n  ${bytes.length} bytes, looks blank`)
    console.log(`ok   ${bytes.length.toString().padStart(6)} bytes  ${target}`)
    checked++
  }
}
console.log(`\nall ${checked} tile requests healthy`)
