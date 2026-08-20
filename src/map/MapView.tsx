import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  type CenterZoomBearing,
  type GeoJSONSource,
} from 'maplibre-gl'
import { resolveSources, NYC_BOUNDS as NYC } from './tiles'
import type { LngLat } from '../game/scoring'

/** [[W,S],[E,N]] for the camera APIs -- the player cannot pan out of the city. */
const NYC_BOUNDS: [[number, number], [number, number]] = [
  [NYC[0], NYC[1]],
  [NYC[2], NYC[3]],
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

/**
 * Where the recap sits when stepping between answers. Half a level back from
 * the reveal: close enough to read the block, far enough that the answer has
 * some neighbourhood around it rather than filling the frame.
 */
const RECAP_ZOOM = 14.5

/** Mirrors the reveal's zoom-in, so the round ends by running it backwards. */
const RESET_MS = 900
const FRAMING_PADDING = 20

/**
 * MapLibre fires click, click, dblclick -- so a double-click to zoom would commit
 * the first click as a guess. Placement therefore waits out the double-click
 * window before committing.
 */
const DOUBLE_CLICK_WINDOW_MS = 300

const EMPTY = { type: 'FeatureCollection', features: [] } as const


export type MapHandle = {
  /** Return to the identical standard framing every round starts from. */
  resetCamera: () => void
  revealAnswer: (guess: LngLat, answer: LngLat) => void
  clearPins: () => void
  /** End of game: drop every answer pin. */
  showAllAnswers: (points: LngLat[]) => void
  /**
   * Move to one answer as the player steps through the recap. `bottomInset` is
   * the height of the panel covering the map, so the pin lands in the part the
   * player can actually see.
   */
  focusLocation: (p: LngLat, bottomInset?: number) => void
}


export function MapView({
  ref,
  onPlace,
  onReady,
  enabled = true,
  carefulMode = false,
  holdMs = 800,
}: {
  ref?: Ref<MapHandle>
  onPlace: (p: LngLat) => void
  /** The map is built after an async tile probe, so callers that need to drive
   *  it on first paint -- restoring a finished game, say -- have to wait. */
  onReady?: () => void
  /** False during a reveal and after the game -- taps must not drop a pin. */
  enabled?: boolean
  /** Commit on a deliberate press-and-hold instead of a tap. */
  carefulMode?: boolean
  holdMs?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const standardFraming = useRef<CenterZoomBearing | null>(null)
  const pins = useRef<Marker[]>([])
  const pendingPlace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetting = useRef(false)
  /** Screen position of an in-progress hold, for the ring. */
  const [holding, setHolding] = useState<{ x: number; y: number } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // These change as the round advances, but the map listener is registered once,
  // so read the current values through refs rather than rebuilding the map.
  const place = useRef(onPlace)
  const canPlace = useRef(enabled)
  const ready = useRef(onReady)
  const careful = useRef({ on: carefulMode, ms: holdMs })
  useEffect(() => {
    place.current = onPlace
    canPlace.current = enabled
    ready.current = onReady
    careful.current = { on: carefulMode, ms: holdMs }
  })

  const addPin = (m: MapLibreMap, p: LngLat, color: string) => {
    pins.current.push(new Marker({ color }).setLngLat([p.lng, p.lat]).addTo(m))
  }

  useEffect(() => {
    let cancelled = false

    resolveSources().then((sources) => {
      if (cancelled || !container.current) return

      const m = new MapLibreMap({
        container: container.current,
        style: {
          version: 8,
          sources: {
            ...Object.fromEntries(
              sources.map((s, i) => [
                `satellite-${i}`,
                {
                  type: 'raster',
                  tiles: [s.url],
                  tileSize: 256,
                  // Per source, not per map: each service has its own coverage
                  // and its own useful zoom range, and asking outside either is
                  // a round trip for nothing.
                  ...(s.bounds ? { bounds: s.bounds } : {}),
                  minzoom: s.minzoom ?? 0,
                  maxzoom: s.maxzoom ?? MAX_ZOOM,
                  attribution: s.attribution,
                },
              ]),
            ),
            link: { type: 'geojson', data: EMPTY },
          },
          layers: [
            ...sources.map((_, i) => ({
              id: `satellite-${i}`,
              type: 'raster' as const,
              source: `satellite-${i}`,
            })),
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
        // A tap mid-zoom-out would commit wherever the camera happens to be
        // pointing at that instant, which is not where the player aimed.
        // Careful mode commits from the pointer handlers below instead, so
        // this path must stay out of the way entirely -- otherwise a tap
        // commits through it and the hold-to-place guarantee is worthless.
        if (!canPlace.current || resetting.current || careful.current.on) return
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
      // Dev-only handle so browser-driven tests can assert on camera state.
      if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = m

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
      ready.current?.()
    })

    return () => {
      cancelled = true
      if (pendingPlace.current) clearTimeout(pendingPlace.current)
      map.current?.remove()
      map.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const m = map.current
      if (!m || !standardFraming.current) return

      // Eased rather than cut, so the round closes by reversing the reveal's
      // zoom. The destination is still the one camera computed at startup, so
      // every round starts from an identical framing however it got there.
      resetting.current = true
      m.easeTo({ ...standardFraming.current, duration: RESET_MS })

      // Also fires if the player grabs the map mid-flight, which aborts the
      // ease -- they have taken over, so hand control straight back.
      m.once('moveend', () => {
        resetting.current = false
      })
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

    focusLocation: (p, bottomInset = 0) => {
      const m = map.current
      if (!m) return
      // Close enough to read the block, wide enough to keep a neighbouring pin
      // in frame so the recap still feels like a map rather than a slideshow.
      //
      // The padding is load-bearing: the recap panel covers the lower half of a
      // phone screen, so centring the answer would put the pin directly behind
      // it. This lifts it into the visible strip above.
      m.flyTo({
        center: [p.lng, p.lat],
        zoom: RECAP_ZOOM,
        padding: { top: 0, left: 0, right: 0, bottom: bottomInset },
        duration: 900,
        essential: true,
      })
    },

    showAllAnswers: (points) => {
      const m = map.current
      if (!m || !points.length) return
      points.forEach((p) => addPin(m, p, '#22c55e'))

      // maxBounds exists to stop players wandering out of the city mid-round.
      // The game is over; there is nothing left to constrain, and the recap
      // flies between answers which the cage would fight.
      m.setMaxBounds(null)

    },
  }), [])


  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHolding(null)
  }

  /**
   * Careful mode: a press must survive `holdMs` without wandering. Released
   * early it commits nothing, which is the entire point -- there is no confirm
   * step anywhere else in the game, so this is the only undo a player gets.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!carefulMode || !canPlace.current || !map.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const startedAt = { x: e.clientX, y: e.clientY }
    setHolding({ x, y })

    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      setHolding(null)
      const m = map.current
      if (!m || !canPlace.current) return
      const { lng, lat } = m.unproject([x, y])
      addPin(m, { lng, lat }, '#fbbf24')
      place.current({ lng, lat })
    }, careful.current.ms)

    // Drifting off the point is a pan, not a placement.
    const watch = (move: PointerEvent) => {
      if (Math.hypot(move.clientX - startedAt.x, move.clientY - startedAt.y) > 12) {
        cancelHold()
        window.removeEventListener('pointermove', watch)
      }
    }
    window.addEventListener('pointermove', watch)
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', watch), {
      once: true,
    })
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="map-surface h-full w-full"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
      />
      {holding && (
        <svg
          className="pointer-events-none absolute z-40"
          style={{ left: holding.x - 34, top: holding.y - 34 }}
          width={68}
          height={68}
        >
          <circle cx={34} cy={34} r={28} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth={4} />
          <circle
            cx={34}
            cy={34}
            r={28}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 28}
            transform="rotate(-90 34 34)"
          >
            <animate
              attributeName="stroke-dashoffset"
              from={2 * Math.PI * 28}
              to={0}
              dur={`${holdMs}ms`}
              fill="freeze"
            />
          </circle>
        </svg>
      )}
    </div>
  )
}
