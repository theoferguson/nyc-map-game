import { test, expect } from 'vitest'

/**
 * The multi-pointer rule, extracted from `MapView.onPointerDown` so it can be
 * exercised without a map. It is three lines of bookkeeping and it was wrong
 * for the entire life of careful mode on touch devices.
 *
 * A pinch put two pointers down. The second overwrote `holdTimer.current`,
 * which orphaned the first timer where no cancel path could reach it -- so it
 * fired mid-zoom and committed at a screen point the camera had since moved
 * away from. The pin landed between the player's fingers.
 */
function holdMachine() {
  const pointers = new Set<number>()
  let timer: string | null = null
  return {
    down(id: number) {
      pointers.add(id)
      if (pointers.size > 1) {
        timer = null
        return
      }
      timer = `hold-${id}`
    },
    up(id: number) {
      pointers.delete(id)
      timer = null
    },
    /** What the timer would do if it fired right now. */
    wouldCommit: () => timer !== null && pointers.size === 1,
    pointers: () => pointers.size,
  }
}

test('one finger held commits', () => {
  const h = holdMachine()
  h.down(1)
  expect(h.wouldCommit()).toBe(true)
})

test('a second finger cancels the hold and starts no new one', () => {
  const h = holdMachine()
  h.down(1)
  h.down(2)
  expect(h.wouldCommit()).toBe(false)
})

test('lifting one finger of a pinch does not resurrect the hold', () => {
  const h = holdMachine()
  h.down(1)
  h.down(2)
  h.up(2)
  // One pointer is down again, but nothing was ever held -- the player is
  // finishing a zoom, not pressing.
  expect(h.pointers()).toBe(1)
  expect(h.wouldCommit()).toBe(false)
})

test('a fresh press after the pinch ends is a real hold again', () => {
  const h = holdMachine()
  h.down(1)
  h.down(2)
  h.up(1)
  h.up(2)
  h.down(3)
  expect(h.wouldCommit()).toBe(true)
})
