/**
 * The encoder half of the puzzle codec. Its counterpart is `decodePuzzle` in
 * src/data/loadPuzzle.ts.
 *
 * Split into its own module so the round-trip test can drive the real encoder
 * rather than a copy of it. If these two drift, every coordinate decodes to
 * garbage and the game marks correct answers wrong -- silently, since a wrong
 * number is still a number.
 */
export function xor(bytes, key) {
  const k = new TextEncoder().encode(key)
  return bytes.map((b, i) => b ^ k[i % k.length])
}

export function encodeLocations(locations, date) {
  const plain = new TextEncoder().encode(JSON.stringify(locations))
  return Buffer.from(xor(plain, date)).toString('base64')
}
