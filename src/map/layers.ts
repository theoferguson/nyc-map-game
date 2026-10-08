import { TileLayer, latLngBounds } from 'leaflet'
import type { Imagery } from './tiles'

/**
 * Tile layers for `sources`, bottom first, shared with the admin pin map. Not in
 * tiles.ts: node-side code imports that, and Leaflet cannot load without a window.
 */
export function imageryLayers(sources: Imagery[], maxZoom: number): TileLayer[] {
  return sources.map(
    (s) =>
      new TileLayer(s.url, {
        attribution: s.attribution,
        maxZoom,
        ...(s.maxzoom ? { maxNativeZoom: s.maxzoom } : {}),
        ...(s.bounds
          ? { bounds: latLngBounds([s.bounds[1], s.bounds[0]], [s.bounds[3], s.bounds[2]]) }
          : {}),
        // Mid-pinch every intermediate level would be fetched and thrown away a
        // moment later. Load once the zoom settles; the old tiles stay scaled
        // on screen meanwhile.
        updateWhenZooming: false,
      }),
  )
}
