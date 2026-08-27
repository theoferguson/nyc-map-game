/**
 * The one implementation of the puzzle codec.
 *
 * It existed four times -- the client decoder, the admin endpoint, the push
 * script and the pull script -- which is the worst thing to have four of. The
 * two halves drifting apart does not throw: every coordinate decodes to a
 * different number, and the game confidently marks correct answers wrong while
 * looking entirely healthy.
 *
 * Plain JavaScript, with types in codec.d.mts, because the node scripts import
 * it directly and cannot run TypeScript.
 *
 * The encoding is not security. It is a date-keyed XOR that stops the answers
 * being readable in devtools by accident; the protection for future content is
 * the date gate in /api/puzzle.
 */
export function xor(bytes, key) {
  const k = new TextEncoder().encode(key)
  return bytes.map((b, i) => b ^ k[i % k.length])
}

export function encodeLocations(locations, date) {
  const plain = new TextEncoder().encode(JSON.stringify(locations))
  return btoa(String.fromCharCode(...xor(plain, date)))
}

export function decodeLocations(blob, date) {
  const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(xor(bytes, date)))
}
