/**
 * Satellite sources. No label layer is ever loaded -- labels are the answers.
 */

/**
 * `[west, south, east, north]`. Doubles as the imagery coverage box and the area
 * the player may pan over, which are the same rectangle for the same reason.
 */
export const NYC_BOUNDS: [number, number, number, number] = [-74.30, 40.47, -73.68, 40.93]

export type Imagery = {
  id: string
  /** Shown to the player in the corner wordmark. */
  label: string
  url: string
  attribution: string
  /** A concrete tile used to confirm the service is alive before wiring it up. */
  probe: string
  /** Where the service has tiles. Outside this MapLibre would ask and get a 404. */
  bounds?: [number, number, number, number]
  minzoom?: number
  maxzoom?: number
}

/**
 * Always drawn underneath the city imagery. Both NYC sources stop at the city
 * line, so without this everything outside the five boroughs is a black void --
 * very visible at the end-of-game framing, which pulls back past the city.
 */
export const BASEMAP: Imagery = {
  id: 'esri-world',
  label: 'Esri World Imagery',
  /**
   * Capped well below the map's own limit. This layer exists to fill the surround
   * outside the city, which is only ever on screen at the wide end-of-game
   * framing; from z14 up the player is inside the five boroughs looking for a
   * building, where the city survey covers it completely and every Esri tile
   * fetched underneath is bytes nobody sees. Above the cap MapLibre overzooms
   * these tiles, so the background stays present, just soft -- which is the
   * right trade for a layer that is either hidden or peripheral.
   */
  maxzoom: 13,
  // Note {z}/{y}/{x} -- Esri inverts y relative to standard XYZ.
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics',
  probe: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/12315/9649',
}

/**
 * The two city surveys under test. Six years apart, which matters most for the
 * `venue` class: a bar that opened in 2021 sits on a 2018 rooftop showing
 * whatever preceded it. Verified 2026-08-19 -- both serve unlabelled imagery
 * through z18, which is the cap the game enforces.
 */
export const VARIANTS: Imagery[] = [
  {
    id: 'doitt-2018',
    label: 'NYC aerial · 2018',
    bounds: NYC_BOUNDS,
    // The map never goes below 9.5, and without a floor MapLibre walks the
    // pyramid up to z1 hunting for a parent tile to show while loading.
    minzoom: 9,
    url: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8',
    attribution: 'Imagery &copy; NYC OTI (2018)',
    probe: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/15/9649/12315.png8',
  },
  {
    id: 'nyc-2024',
    label: 'NYC aerial · 2024',
    bounds: NYC_BOUNDS,
    minzoom: 9,
    url: 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; NYC OTI (2024)',
    probe: 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/15/12315/9649',
  },
]

import { storage } from '../game/storage'

const VARIANT_KEY = 'nycmap:imagery'

/**
 * Sticky per browser, assigned once at random.
 *
 * Stickiness is the whole experiment: reassigning per round or per day would
 * mix both surveys into one player's results and make the comparison
 * meaningless, quite apart from the imagery visibly changing mid-game.
 */
export function imageryVariant(): Imagery {
  const stored = storage.get(VARIANT_KEY)
  const found = VARIANTS.find((v) => v.id === stored)
  if (found) return found

  const picked = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
  storage.set(VARIANT_KEY, picked.id)
  return picked
}

/**
 * Returns the raster layers to draw, bottom first.
 *
 * MapLibre's multi-URL `tiles` array shards across hosts, it does not fail over,
 * so the city layer's availability is settled up front with one probe instead.
 */
export async function resolveSources(timeoutMs = 1500): Promise<Imagery[]> {
  const variant = imageryVariant()
  try {
    const res = await fetch(variant.probe, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) return [BASEMAP, variant]
  } catch {
    // fall through
  }
  console.warn(`[tiles] ${variant.id} unreachable, falling back to world imagery`)
  return [BASEMAP]
}
