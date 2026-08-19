import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import {
  Map as MapLibreMap,
  Marker,
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

const EMPTY = { type: 'FeatureCollection', features: [] } as const

export type MapHandle = {
  /** Return to the identical standard framing every round starts from. */
  resetCamera: () => void
  showGuess: (p: LngLat) => void
  revealAnswer: (guess: LngLat, answer: LngLat) => void
  clearPins: () => void
}

export function MapView({
  ref,
  onPlace,
}: {
  ref?: Ref<MapHandle>
  onPlace: (p: LngLat) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const standardFraming = useRef<CenterZoomBearing | null>(null)
  const guessPin = useRef<Marker | null>(null)
  const answerPin = useRef<Marker | null>(null)

  // onPlace changes every render as the round advances; the map listener is
  // registered once, so read the current one through a ref rather than
  // tearing down and rebuilding the map.
  const place = useRef(onPlace)
  useEffect(() => {
    place.current = onPlace
  })

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
        // Placement commits with no confirm step, so this is load-bearing.
        clickTolerance: 10,
        attributionControl: { compact: true },
      })

      m.touchZoomRotate.disableRotation()
      m.keyboard.disableRotation()

      // Computed once and replayed verbatim. Recomputing per round, or easing
      // into it, lets the previous reveal leak position into the next prompt.
      m.once('load', () => {
        standardFraming.current = m.cameraForBounds(NYC_BOUNDS, {
          padding: FRAMING_PADDING,
        }) ?? null
      })

      m.on('click', (e) => place.current({ lng: e.lngLat.lng, lat: e.lngLat.lat }))

      map.current = m
    })

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const m = map.current
      if (m && standardFraming.current) m.jumpTo(standardFraming.current)
    },

    showGuess: (p) => {
      const m = map.current
      if (!m) return
      guessPin.current?.remove()
      guessPin.current = new Marker({ color: '#fbbf24' })
        .setLngLat([p.lng, p.lat])
        .addTo(m)
    },

    revealAnswer: (guess, answer) => {
      const m = map.current
      if (!m) return

      answerPin.current?.remove()
      answerPin.current = new Marker({ color: '#22c55e' })
        .setLngLat([answer.lng, answer.lat])
        .addTo(m)

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
        [
          [Math.min(guess.lng, answer.lng), Math.min(guess.lat, answer.lat)],
          [Math.max(guess.lng, answer.lng), Math.max(guess.lat, answer.lat)],
        ],
        { padding: 80, maxZoom: MAX_ZOOM - 1, duration: 900 },
      )
    },

    clearPins: () => {
      guessPin.current?.remove()
      answerPin.current?.remove()
      guessPin.current = null
      answerPin.current = null
      const src = map.current?.getSource('link') as GeoJSONSource | undefined
      src?.setData(EMPTY)
    },
  }), [])

  return (
    <div
      ref={container}
      className="map-surface h-full w-full"
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
