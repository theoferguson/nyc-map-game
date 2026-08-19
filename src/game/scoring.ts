export type LocationClass = 'area' | 'landmark' | 'venue'

export type LngLat = { lng: number; lat: number }

/**
 * Findability varies enormously by class -- a park is visible from orbit, a deli's
 * roof tells you nothing -- so the decay curve is per class rather than global.
 */
const LAMBDA: Record<LocationClass, number> = {
  area: 400,
  landmark: 250,
  venue: 350,
}

/** Inside this radius every guess is a bullseye; below it the curve is noise. */
const BULLSEYE_M = 40

const EARTH_RADIUS_M = 6_371_000
const rad = (deg: number) => (deg * Math.PI) / 180

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function roundScore(distanceM: number, cls: LocationClass): number {
  if (distanceM <= BULLSEYE_M) return 100
  return Math.round(100 * Math.exp(-distanceM / LAMBDA[cls]))
}

/* ------------------------------------------------------------------ blocks */

/**
 * NYC distance is spoken in blocks, and the two axes are wildly different sizes.
 * Crossing streets north-south is ~80m a block; crossing avenues east-west is
 * ~280m. Natives say "three blocks" for the short axis and "two avenues" for the
 * long one, so the copy follows the dominant axis of the miss and names it.
 */
const STREET_BLOCK_M = 80
const AVENUE_BLOCK_M = 280

/** Rough box for the Jersey side of the Hudson, excluding Staten Island. */
const isJersey = (p: LngLat) => p.lng < -74.02 && p.lat > 40.68

type Miss = { blocks: number; axis: 'blocks' | 'avenues' }

function dominantAxis(guess: LngLat, answer: LngLat): Miss {
  const northSouthM = Math.abs(guess.lat - answer.lat) * 111_320
  const eastWestM =
    Math.abs(guess.lng - answer.lng) * 111_320 * Math.cos(rad(answer.lat))
  const acrossAvenues = eastWestM > northSouthM
  return {
    axis: acrossAvenues ? 'avenues' : 'blocks',
    blocks:
      (acrossAvenues ? eastWestM : northSouthM) /
      (acrossAvenues ? AVENUE_BLOCK_M : STREET_BLOCK_M),
  }
}

const plural = (n: number, axis: Miss['axis']) =>
  n === 1 ? (axis === 'avenues' ? 'avenue' : 'block') : axis

/** The emotional payoff of the round -- worth writing rather than templating. */
export function describeMiss(guess: LngLat, answer: LngLat): string {
  const d = haversine(guess, answer)
  if (d <= BULLSEYE_M) return 'Dead on.'

  if (isJersey(guess)) return 'You were in Jersey.'

  const { blocks, axis } = dominantAxis(guess, answer)
  // Nobody says "197 feet" -- round to something a person would actually utter.
  const feet = Math.round((d * 3.28084) / 10) * 10

  if (feet <= 150) return `${feet} feet off — same block.`
  if (blocks < 0.4) return `${feet} feet off, still on the right block.`
  if (blocks < 0.8) return `Half a ${plural(1, axis)} off, about ${feet} feet.`
  if (blocks < 1.5) return `One ${plural(1, axis)} off.`
  if (blocks < 2.5) return `Two ${axis} off.`
  if (blocks < 6) return `${Math.round(blocks)} ${axis} off.`
  if (blocks < 12) return `${Math.round(blocks)} ${axis} off — wrong end of the neighborhood.`
  if (blocks < 30) return `${Math.round(blocks)} ${axis} off. Different neighborhood entirely.`

  const miles = d / 1609.34
  if (miles < 3) return `${miles.toFixed(1)} miles off — you had the wrong part of town.`
  if (miles < 8) return `${miles.toFixed(1)} miles off. Almost certainly the wrong borough.`
  return `${miles.toFixed(0)} miles off. Not close.`
}
