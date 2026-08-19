/**
 * Satellite sources. No label layer is ever loaded -- labels are the answers.
 */

export type Imagery = {
  id: string
  /** Shown to the player in the corner wordmark. */
  label: string
  url: string
  attribution: string
  /** A concrete tile used to confirm the service is alive before wiring it up. */
  probe: string
}

/**
 * Always drawn underneath the city imagery. Both NYC sources stop at the city
 * line, so without this everything outside the five boroughs is a black void --
 * very visible at the end-of-game framing, which pulls back past the city.
 */
export const BASEMAP: Imagery = {
  id: 'esri-world',
  label: 'Esri World Imagery',
  // Note {z}/{y}/{x} -- Esri inverts y relative to standard XYZ.
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
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
    url: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8',
    attribution: 'Imagery &copy; NYC DoITT (2018)',
    probe: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/15/9649/12315.png8',
  },
  {
    id: 'nyc-2024',
    label: 'NYC aerial · 2024',
    url: 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; City of New York (2024)',
    probe: 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/15/12315/9649',
  },
]

import { storage } from '../game/telemetry'

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
