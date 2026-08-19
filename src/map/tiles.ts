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
 * MapLibre's multi-URL `tiles` array shards across hosts, it does not fail over --
 * so pick the source up front with one probe instead.
 */
export async function pickSource(timeoutMs = 1500) {
  try {
    const res = await fetch(DOITT.probe, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) return DOITT
  } catch {
    // fall through
  }
  console.warn('[tiles] DoITT unreachable, falling back to Esri World Imagery')
  return ESRI
}
