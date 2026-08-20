import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
import { resolveSources, NYC_BOUNDS as NYC } from './tiles'
import { deoverlap, CARD_W } from './deoverlap'
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
  onReady,
  enabled = true,
  carefulMode = false,
  holdMs = 800,
  overlays = [],
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
  overlays?: Overlay[]
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const standardFraming = useRef<CenterZoomBearing | null>(null)
  const pins = useRef<Marker[]>([])
  const pendingPlace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetting = useRef(false)
  const [loaded, setLoaded] = useState<MapLibreMap | null>(null)
  const [moveTick, setMoveTick] = useState(0)
  /** Screen position of an in-progress hold, for the ring. */
  const [holding, setHolding] = useState<{ x: number; y: number } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardEls = useRef<Record<string, HTMLDivElement | null>>({})
  const [heights, setHeights] = useState<Record<string, number>>({})

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
      setLoaded(m)
      ready.current?.()
    })

    return () => {
      cancelled = true
      if (pendingPlace.current) clearTimeout(pendingPlace.current)
      map.current?.remove()
      map.current = null
    }
  }, [])

  // The camera is the external system; subscribing is all the effect does.
  // Only while cards are on screen -- during normal play there is nothing
  // anchored to the map, so waking React on every frame buys nothing.
  const hasOverlays = overlays.length > 0
  useEffect(() => {
    if (!loaded || !hasOverlays) return
    const bump = () => setMoveTick((t) => t + 1)
    loaded.on('move', bump)
    return () => {
      loaded.off('move', bump)
    }
  }, [loaded, hasOverlays])

  // Card heights vary by more than 2x with fact length, so they are measured
  // rather than estimated. An estimate here silently overlaps the tall ones.
  useLayoutEffect(() => {
    const measured: Record<string, number> = {}
    for (const o of overlays) {
      const h = cardEls.current[o.id]?.offsetHeight
      if (h) measured[o.id] = h
    }
    // Measuring rendered DOM is exactly the "synchronise with an external
    // system" case; the height cannot be derived during render because it does
    // not exist until the browser has laid the card out.
    // oxlint-disable-next-line react/set-state-in-effect
    setHeights((prev) => {
      const same =
        Object.keys(measured).length === Object.keys(prev).length &&
        Object.entries(measured).every(([k, v]) => prev[k] === v)
      return same ? prev : measured
    })
    // Deliberately NOT keyed on camera movement: offsetHeight forces a
    // synchronous layout, and card height cannot change from panning. Measuring
    // per move meant five forced layouts every frame of every drag.
  }, [overlays])

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
        // Before the first measurement lands, assume tall: a card that starts
        // too large only settles inward, which never flashes an overlap.
        return { id: o.id, x, y, h: heights[o.id] ?? 240 }
      }),
      loaded.getContainer().clientHeight,
    )
  }, [loaded, overlays, moveTick, heights])

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

    showAllAnswers: (points) => {
      const m = map.current
      if (!m || !points.length) return
      points.forEach((p) => addPin(m, p, '#22c55e'))

      // maxBounds exists to stop players wandering out of the city mid-round.
      // At the recap framing the viewport is wider than the city itself, so
      // MapLibre has nowhere legal to pan and the map locks solid. The game is
      // over -- there is nothing left to constrain.
      m.setMaxBounds(null)

      const bounds = points.reduce(
        (b, p) => b.extend([p.lng, p.lat]),
        new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]),
      )
      // Cards hang above their pins and are wider than them, so the framing has
      // to hold the cards, not just the answers. Too little padding here and the
      // northernmost card is simply cut off the top of the screen.
      m.fitBounds(bounds, {
        padding: {
          top: 280, // a tall card plus its pin
          bottom: 260, // clears the results sheet
          left: CARD_W / 2 + 12,
          right: CARD_W / 2 + 12,
        },
        maxZoom: 13,
        duration: 1200,
      })
    },
  }), [])

  const byId = new Map(placed.map((p) => [p.id, p]))

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
      {/* Leaders first, so cards paint over them. */}
      {placed.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          {placed.map((p) => (
            <g key={p.id}>
              <line
                x1={p.anchorX}
                y1={p.anchorY}
                x2={p.x}
                y2={p.y}
                stroke="rgb(251 191 36 / 0.7)"
                strokeWidth={1.5}
              />
              <circle cx={p.anchorX} cy={p.anchorY} r={2.5} fill="rgb(251 191 36)" />
            </g>
          ))}
        </svg>
      )}
      {overlays.map((o) => {
        const p = byId.get(o.id)
        if (!p) return null
        return (
          // pointer-events-none throughout: the cards are read, not operated,
          // and a wall of five of them would otherwise swallow every pan and
          // pinch aimed at the map underneath.
          <div
            key={o.id}
            ref={(el) => {
              cardEls.current[o.id] = el
            }}
            className="pointer-events-none absolute z-20"
            style={{
              left: p.x,
              top: p.y,
              width: CARD_W,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {o.content}
          </div>
        )
      })}
    </div>
  )
}
