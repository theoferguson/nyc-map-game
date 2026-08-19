/**
 * Satellite sources. No label layer is ever loaded -- labels are the answers.
 *
 * DoITT is the city's own aerial survey: higher resolution over the five boroughs
 * than any commercial basemap, city-owned, no license question. Verified 2026-08-19
 * to serve unlabeled imagery through z18. Years 2020+ have been removed from this
 * host, so 2018 is the newest available -- see PLAN.md section 0 on vintage.
 */
export const DOITT = {
  url: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8',
  attribution: 'Imagery &copy; NYC DoITT',
  probe: 'https://maps.nyc.gov/xyz/1.0.0/photo/2018/15/9649/12315.png8',
}

/** Global fallback. Note {z}/{y}/{x} -- Esri inverts y relative to standard XYZ. */
export const ESRI = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  probe: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/12315/9649',
}

/**
 * Returns the raster layers to draw, bottom first.
 *
 * DoITT stops at the city line, so anything outside the five boroughs renders as
 * a void -- very visible at the end-of-game framing, which pulls back further
 * than the city. Esri goes underneath to fill the surround, with DoITT's sharper
 * city imagery on top of it wherever DoITT has coverage.
 *
 * MapLibre's multi-URL `tiles` array shards across hosts, it does not fail over,
 * so DoITT's availability is settled up front with one probe instead.
 */
export async function resolveSources(timeoutMs = 1500) {
  try {
    const res = await fetch(DOITT.probe, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) return [ESRI, DOITT]
  } catch {
    // fall through
  }
  console.warn('[tiles] DoITT unreachable, falling back to Esri World Imagery')
  return [ESRI]
}
