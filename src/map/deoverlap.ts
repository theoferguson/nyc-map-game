/**
 * Card width is fixed by the layout; height is NOT -- it depends on how long the
 * location's fact runs, and varies by more than 2x across a single day. Measure
 * it and pass it in. An estimate here silently produces overlapping cards that
 * look exactly like a broken de-overlap.
 */
export const CARD_W = 200
const CARD_GAP = 10

/** Height of the map pin, so a card clears the marker it belongs to. */
const PIN_CLEARANCE = 36

/** `y` is the card's bottom edge; `h` its measured height. */
export type Card = { id: string; x: number; y: number; h: number }
export type Placed = Card & { anchorX: number; anchorY: number }

const overlaps = (a: Card, b: Card) =>
  Math.abs(a.x - b.x) < CARD_W &&
  a.y - a.h < b.y + CARD_GAP &&
  b.y - b.h < a.y + CARD_GAP

/**
 * Cards sit above their pin; clustered answers would cover each other, so each
 * card is pushed down until it clears the ones already placed. `x, y` is the
 * card's bottom centre, `anchorX, anchorY` the pin it was displaced from -- the
 * caller draws a leader between them, which is what makes a displaced card read
 * as belonging to a particular pin rather than floating loose.
 *
 * ponytail: greedy, one axis, first-come-first-served. Fine for five cards. If
 * days routinely cluster four answers in lower Manhattan this wants real label
 * placement, which is a solver, not a bigger nudge.
 */
export function deoverlap(pins: Card[], viewportH = Infinity): Placed[] {
  const done: Placed[] = []

  // North to south, so the stack order matches how the map reads.
  for (const pin of [...pins].sort((a, b) => a.y - b.y)) {
    // Never let a card hang off the top of the screen -- it is unreachable
    // there, because the recap framing is already at the edge of what the
    // camera is allowed to show.
    const card = {
      ...pin,
      y: Math.max(pin.y - PIN_CLEARANCE, pin.h + CARD_GAP),
    }

    let moved = true
    while (moved) {
      moved = false
      for (const placed of done) {
        if (overlaps(placed, card)) {
          card.y = placed.y + CARD_GAP + card.h
          moved = true
        }
      }
    }

    // If the stack has run off the bottom, fold back to the top of the column.
    if (card.y > viewportH) card.y = pin.h + CARD_GAP

    done.push({ ...card, anchorX: pin.x, anchorY: pin.y })
  }
  return done
}
