/** Card size used for de-overlapping. Cards are fixed-width so this stays close. */
export const CARD_W = 168
export const CARD_H = 122
const CARD_GAP = 8

/** Height of the map pin, so a card clears the marker it belongs to. */
const PIN_CLEARANCE = 36

export type Pin = { id: string; x: number; y: number }

/** Card position plus the pin it belongs to, so a leader line can join them. */
export type Placed = Pin & { anchorX: number; anchorY: number }

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H + CARD_GAP

/**
 * Cards sit above their pin; clustered answers would cover each other, so each
 * card is pushed down until it clears the ones already placed. `x, y` is the
 * card's bottom centre, `anchorX, anchorY` the pin it was displaced from --
 * the caller draws a leader between them, which is what makes a displaced card
 * readable as belonging to a particular pin rather than floating loose.
 *
 * ponytail: greedy, one axis, first-come-first-served. Fine for five cards. If
 * days routinely cluster four answers in lower Manhattan this wants real label
 * placement, which is a solver, not a bigger nudge.
 */
export function deoverlap(pins: Pin[]): Placed[] {
  const done: Placed[] = []

  // North to south, so the stack order matches how the map reads.
  for (const pin of [...pins].sort((a, b) => a.y - b.y)) {
    const card = { id: pin.id, x: pin.x, y: pin.y - PIN_CLEARANCE }

    let moved = true
    while (moved) {
      moved = false
      for (const placed of done) {
        if (overlaps(placed, card)) {
          card.y = placed.y + CARD_H + CARD_GAP
          moved = true
        }
      }
    }
    done.push({ ...card, anchorX: pin.x, anchorY: pin.y })
  }
  return done
}
