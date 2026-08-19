/** Card size used for de-overlapping. Cards are fixed-width so this stays exact. */
export const CARD_W = 184
export const CARD_H = 128
const CARD_GAP = 8

export type Placed = { id: string; x: number; y: number }

/**
 * Cards sit above their pin, but five answers at a citywide framing collide.
 * Push each one down until it clears the cards already placed.
 *
 * ponytail: greedy 1D nudge, no leader lines back to the pin. If real days
 * cluster four answers in lower Manhattan, this wants proper label placement
 * rather than a bigger nudge.
 */
export function deoverlap(points: Placed[]): Placed[] {
  const done: Placed[] = []
  for (const p of [...points].sort((a, b) => a.y - b.y)) {
    let { y } = p
    let moved = true
    while (moved) {
      moved = false
      for (const q of done) {
        if (Math.abs(q.x - p.x) < CARD_W && Math.abs(q.y - y) < CARD_H + CARD_GAP) {
          y = q.y + CARD_H + CARD_GAP
          moved = true
        }
      }
    }
    done.push({ ...p, y })
  }
  return done
}
