import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  type CenterZoomBearing,
  type GeoJSONSource,
} from 'maplibre-gl'
import { pickSource } from './tiles'
import type { LngLat } from '../game/scoring'

/** [[W,S],[E,N]] -- the player cannot pan out of the city. */
const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.30, 40.47],
  [-73.68, 40.93],
]

/**
 * Past z18 you start reading painted rooftop signage, stadium logos and storefront
 * awnings -- that is a label layer wearing a hat. See PLAN.md section 6.
 */
const MAX_ZOOM = 18
const MIN_ZOOM = 9.5
const FRAMING_PADDING = 20

/**
 * MapLibre fires click, click, dblclick -- so a double-click to zoom would commit
 * the first click as a guess. Placement therefore waits out the double-click
 * window before committing. The guess pin drops immediately so the tap still
 * feels instant; only the irreversible part is deferred.
 */
const DOUBLE_CLICK_WINDOW_MS = 300

const EMPTY = { type: 'FeatureCollection', features: [] } as const

/** A card pinned to a map coordinate -- used for the end-of-game fact cards. */
export type Overlay = { id: string; lngLat: LngLat; content: ReactNode }

export type MapHandle = {
  /** Return to the identical standard framing every round starts from. */
  resetCamera: () => void
  revealAnswer: (guess: LngLat, answer: LngLat) => void
  clearPins: () => void
  /** End of game: every answer at once, camera pulled back to hold them all. */
  showAllAnswers: (points: LngLat[]) => void
}

export function MapView({
  ref,
  onPlace,
  overlays = [],
}: {
  ref?: Ref<MapHandle>
  onPlace: (p: LngLat) => void
  overlays?: Overlay[]
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const standardFraming = useRef<CenterZoomBearing | null>(null)
  const pins = useRef<Marker[]>([])
  const pendingPlace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)
  const [hosts, setHosts] = useState<Record<string, HTMLElement>>({})

  // onPlace changes as the round advances, but the map listener is registered
  // once -- read the current one through a ref instead of rebuilding the map.
  const place = useRef(onPlace)
  useEffect(() => {
    place.current = onPlace
  })

  const addPin = (m: MapLibreMap, p: LngLat, color: string) => {
    pins.current.push(new Marker({ color }).setLngLat([p.lng, p.lat]).addTo(m))
  }

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
            link: { type: 'geojson', data: EMPTY },
          },
          layers: [
            { id: 'satellite', type: 'raster', source: 'satellite' },
            {
              id: 'link',
              type: 'line',
              source: 'link',
              paint: {
                'line-color': '#fbbf24',
                'line-width': 2,
                'line-dasharray': [2, 2],
              },
            },
          ],
        },
        bounds: NYC_BOUNDS,
        fitBoundsOptions: { padding: FRAMING_PADDING },
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: NYC_BOUNDS,
        // North-up is essential: the Manhattan grid is a primary orientation cue.
        dragRotate: false,
        pitchWithRotate: false,
        // A tap that drifts past 10px is the tail end of a pan, not a placement.
        clickTolerance: 10,
        attributionControl: { compact: true },
      })

      m.touchZoomRotate.disableRotation()
      m.keyboard.disableRotation()

      // Computed once and replayed verbatim. Recomputing per round, or easing
      // into it, lets the previous reveal leak position into the next prompt.
      m.once('load', () => {
        standardFraming.current =
          m.cameraForBounds(NYC_BOUNDS, { padding: FRAMING_PADDING }) ?? null
        setReady(true)
      })

      m.on('click', (e) => {
        const p = { lng: e.lngLat.lng, lat: e.lngLat.lat }
        if (pendingPlace.current) clearTimeout(pendingPlace.current)
        pendingPlace.current = setTimeout(() => {
          pendingPlace.current = null
          addPin(m, p, '#fbbf24')
          place.current(p)
        }, DOUBLE_CLICK_WINDOW_MS)
      })

      // The zoom itself is MapLibre's; all we do is call off the pending commit.
      m.on('dblclick', () => {
        if (pendingPlace.current) clearTimeout(pendingPlace.current)
        pendingPlace.current = null
      })

      map.current = m
    })

    return () => {
      cancelled = true
      if (pendingPlace.current) clearTimeout(pendingPlace.current)
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Anchor one Marker per overlay and portal React into it, so the cards track
  // their pins through pan and zoom without re-rendering on every frame.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return

    const markers = overlays.map((o) => {
      const el = document.createElement('div')
      return {
        id: o.id,
        el,
        marker: new Marker({ element: el, anchor: 'bottom', offset: [0, -34] })
          .setLngLat([o.lngLat.lng, o.lngLat.lat])
          .addTo(m),
      }
    })

    setHosts(Object.fromEntries(markers.map((x) => [x.id, x.el])))
    return () => {
      markers.forEach((x) => x.marker.remove())
      setHosts({})
    }
  }, [overlays, ready])

  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const m = map.current
      if (m && standardFraming.current) m.jumpTo(standardFraming.current)
    },

    revealAnswer: (guess, answer) => {
      const m = map.current
      if (!m) return
      addPin(m, answer, '#22c55e')

      // Straight line, not a great-circle arc: curvature over a few km is
      // sub-pixel, so interpolating it would be invisible work.
      ;(m.getSource('link') as GeoJSONSource).setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [guess.lng, guess.lat],
            [answer.lng, answer.lat],
          ],
        },
      })

      m.fitBounds(
        new LngLatBounds([guess.lng, guess.lat], [guess.lng, guess.lat]).extend([
          answer.lng,
          answer.lat,
        ]),
        { padding: 80, maxZoom: MAX_ZOOM - 1, duration: 900 },
      )
    },

    clearPins: () => {
      pins.current.forEach((p) => p.remove())
      pins.current = []
      const src = map.current?.getSource('link') as GeoJSONSource | undefined
      src?.setData(EMPTY)
    },

    showAllAnswers: (points) => {
      const m = map.current
      if (!m || !points.length) return
      points.forEach((p) => addPin(m, p, '#22c55e'))

      const bounds = points.reduce(
        (b, p) => b.extend([p.lng, p.lat]),
        new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]),
      )
      m.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 1200 })
    },
  }), [])

  return (
    <>
      <div
        ref={container}
        className="map-surface h-full w-full"
        onContextMenu={(e) => e.preventDefault()}
      />
      {overlays.map((o) =>
        hosts[o.id] ? createPortal(o.content, hosts[o.id]) : null,
      )}
    </>
  )
}
