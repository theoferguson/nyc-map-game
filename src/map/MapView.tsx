import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from 'react'
import {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  type CenterZoomBearing,
  type GeoJSONSource,
} from 'maplibre-gl'
import { pickSource } from './tiles'
import { deoverlap, CARD_W } from './deoverlap'
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

/**
 * The reveal frames guess and answer together, but a near-perfect guess makes
 * that box tiny and fitBounds would slam to the zoom cap. Hold it well back:
 * the round is over, so the detail buys nothing and only costs the player the
 * pinch-out back to the city.
 */
const REVEAL_MAX_ZOOM = 15
const FRAMING_PADDING = 20

/**
 * MapLibre fires click, click, dblclick -- so a double-click to zoom would commit
 * the first click as a guess. Placement therefore waits out the double-click
 * window before committing.
 */
const DOUBLE_CLICK_WINDOW_MS = 300

const EMPTY = { type: 'FeatureCollection', features: [] } as const


/** A card pinned to a map coordinate -- the end-of-game fact cards. */
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
  enabled = true,
  overlays = [],
}: {
  ref?: Ref<MapHandle>
  onPlace: (p: LngLat) => void
  /** False during a reveal and after the game -- taps must not drop a pin. */
  enabled?: boolean
  overlays?: Overlay[]
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const standardFraming = useRef<CenterZoomBearing | null>(null)
  const pins = useRef<Marker[]>([])
  const pendingPlace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loaded, setLoaded] = useState<MapLibreMap | null>(null)
  const [moveTick, setMoveTick] = useState(0)

  // These change as the round advances, but the map listener is registered once,
  // so read the current values through refs rather than rebuilding the map.
  const place = useRef(onPlace)
  const canPlace = useRef(enabled)
  useEffect(() => {
    place.current = onPlace
    canPlace.current = enabled
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

      m.on('click', (e) => {
        // Gated here rather than in the caller: the pin is dropped from this
        // handler, so a guard further downstream leaves a stray pin behind.
        if (!canPlace.current) return
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

      // Captured immediately, and replayed verbatim at the start of every round.
      // Recomputing per round, or easing into it, lets the previous reveal leak
      // position into the next prompt.
      //
      // Deliberately NOT gated on the 'load' event: cameraForBounds only needs
      // the container size, which exists as soon as the map is constructed.
      // Waiting for 'load' meant that if it never fired, the camera reset and
      // the end-of-game cards both died silently with the map still working.
      standardFraming.current =
        m.cameraForBounds(NYC_BOUNDS, { padding: FRAMING_PADDING }) ?? {
          center: m.getCenter(),
          zoom: m.getZoom(),
          bearing: 0,
        }
      setLoaded(m)
    })

    return () => {
      cancelled = true
      if (pendingPlace.current) clearTimeout(pendingPlace.current)
      map.current?.remove()
      map.current = null
    }
  }, [])

  // The camera is the external system; subscribing is all the effect does.
  useEffect(() => {
    if (!loaded) return
    const bump = () => setMoveTick((t) => t + 1)
    loaded.on('move', bump)
    return () => {
      loaded.off('move', bump)
    }
  }, [loaded])

  // Card positions are derived, not stored: project each coordinate to screen
  // space and re-derive whenever the camera moves. Only five cards, and only at
  // game over, so this is cheaper than the marker-plus-portal lifecycle it
  // replaces -- and it cannot fall out of sync with the map.
  const placed = useMemo(() => {
    void moveTick // re-project on every camera move; map.project() is not reactive
    if (!loaded || !overlays.length) return []
    return deoverlap(
      overlays.map((o) => {
        const { x, y } = loaded.project([o.lngLat.lng, o.lngLat.lat])
        return { id: o.id, x, y }
      }),
    )
  }, [loaded, overlays, moveTick])

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
        { padding: 80, maxZoom: REVEAL_MAX_ZOOM, duration: 900 },
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
      // Leave room down the sides for the cards, which sit above their pins.
      m.fitBounds(bounds, {
        padding: { top: 150, bottom: 200, left: 100, right: 100 },
        maxZoom: 13,
        duration: 1200,
      })
    },
  }), [])

  const byId = new Map(placed.map((p) => [p.id, p]))

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="map-surface h-full w-full"
        onContextMenu={(e) => e.preventDefault()}
      />
      {overlays.map((o) => {
        const p = byId.get(o.id)
        if (!p) return null
        return (
          <div
            key={o.id}
            className="pointer-events-none absolute z-20"
            style={{
              left: p.x,
              top: p.y,
              width: CARD_W,
              transform: `translate(-50%, calc(-100% - 34px))`,
            }}
          >
            <div className="pointer-events-auto">{o.content}</div>
          </div>
        )
      })}
    </div>
  )
}
