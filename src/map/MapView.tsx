import { useEffect, useRef } from 'react'
import { Map as MapLibreMap } from 'maplibre-gl'
import { pickSource } from './tiles'

/** [[W,S],[E,N]] -- the player cannot pan out of the city. */
const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.30, 40.47],
  [-73.68, 40.93],
]

/**
 * Past z18 you start reading painted rooftop signage, stadium logos and storefront
 * awnings -- that is a label layer wearing a hat.
 */
const MAX_ZOOM = 18
const MIN_ZOOM = 9.5

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    let cancelled = false

    pickSource().then((source) => {
      if (cancelled || !container.current) return

      const m = new MapLibreMap({
        container: container.current,
        style: {
          version: 8,
          sources: {
            satellite: {
              type: 'raster',
              tiles: [source.url],
              tileSize: 256,
              maxzoom: MAX_ZOOM,
              attribution: source.attribution,
            },
          },
          layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
        },
        bounds: NYC_BOUNDS,
        fitBoundsOptions: { padding: 20 },
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: NYC_BOUNDS,
        // North-up is essential: the Manhattan grid is a primary orientation cue.
        dragRotate: false,
        pitchWithRotate: false,
        // A tap that drifts past 10px is the tail end of a pan, not a placement.
        // Placement commits with no confirm step (M2), so this is load-bearing.
        clickTolerance: 10,
        attributionControl: { compact: true },
      })

      m.touchZoomRotate.disableRotation()
      m.keyboard.disableRotation()

      map.current = m
    })

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  return (
    <div
      ref={container}
      className="map-surface h-full w-full"
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
