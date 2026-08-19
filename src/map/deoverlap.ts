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
    // Integer pixels throughout, and not for crispness.
    //
    // A card is pushed to `other.y + CARD_GAP + h`, which clears `other` only if
    // `(other.y + CARD_GAP + h) - h` recovers `other.y + CARD_GAP` exactly. In
    // floating point it does not: projected coordinates are fractional, the
    // round trip lands an ULP low, the card still tests as overlapping, and the
    // loop below re-assigns it the same value forever. That froze the tab at the
    // end of every game. Integers make the cancellation exact.
    const x0 = Math.round(pin.x)
    const h = Math.round(pin.h)
    const anchorY = Math.round(pin.y)

    let x = x0
    let y = Math.max(anchorY - PIN_CLEARANCE, h + CARD_GAP)
    let column = 0

    // Bounded as a backstop: a freeze is far worse than a card in the wrong
    // place, and this loop is one arithmetic slip away from never ending.
    for (let pass = 0; pass < 64; pass++) {
      let moved = false
      for (const other of done) {
        if (overlaps(other, { id: pin.id, x, y, h })) {
          y = other.y + CARD_GAP + h
          moved = true
        }
      }

      // Five cards of two hundred-odd pixels need more stack than a phone is
      // tall, so a full column starts another one beside it. Folding back to the
      // top instead -- the obvious move -- just drops the card onto the ones
      // already placed there, which is the overlap this whole function exists to
      // prevent.
      if (y > viewportH) {
        column += 1
        const step = Math.ceil(column / 2) * (CARD_W + CARD_GAP)
        x = x0 + (column % 2 === 1 ? step : -step)
        y = h + CARD_GAP
        moved = true
      }
      if (!moved) break
    }

    done.push({ id: pin.id, x, y, h, anchorX: x0, anchorY })
  }
  return done
}
