import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  Map as LeafletMap,
  Marker,
  Polyline,
  Draggable,
  divIcon,
  latLngBounds,
  type LatLng,
} from 'leaflet'
import { resolveSources, NYC_BOUNDS as NYC } from './tiles'
import { imageryLayers } from './layers'
import type { LngLat } from '../game/scoring'

/** [[S,W],[N,E]] for the camera APIs -- the player cannot pan out of the city. */
const NYC_BOUNDS = latLngBounds([NYC[1], NYC[0]], [NYC[3], NYC[2]])

// A tap that drifts past 10px is the tail end of a pan, not a placement. Leaflet
// has no per-map option for this; every drag in the app is the map's, so the
// class default is the map's.
Draggable.mergeOptions({ clickTolerance: 10 })

/** Programmatic camera moves cut instead of flying when the OS asks for less motion. */
const animate = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A teardrop pin, tip on the point. Drawn inline: Leaflet's default marker is a
 *  PNG that bundlers lose, and two colours do not justify an asset pipeline. */
const pinIcon = (color: string) =>
  divIcon({
    className: '',
    iconSize: [27, 41],
    iconAnchor: [13.5, 41],
    html: `<svg width="27" height="41" viewBox="0 0 27 41"><path d="M13.5 .5C6.3.5.5 6.3.5 13.5c0 9.8 13 27 13 27s13-17.2 13-27C26.5 6.3 20.7.5 13.5.5z" fill="${color}" stroke="rgb(0 0 0 / .3)"/><circle cx="13.5" cy="13.5" r="5" fill="#fff"/></svg>`,
  })

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

/**
 * The browser fires click, click, dblclick -- so a double-click to zoom would
 * commit the first click as a guess. Placement therefore waits out the
 * double-click window before committing.
 */
const DOUBLE_CLICK_WINDOW_MS = 300


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
  const map = useRef<LeafletMap | null>(null)
  const standardFraming = useRef<{ center: LatLng; zoom: number } | null>(null)
  const pins = useRef<Marker[]>([])
  /** The dashed guess-to-answer line, emptied between rounds rather than rebuilt. */
  const link = useRef<Polyline | null>(null)
  const pendingPlace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetting = useRef(false)
  /** Screen position of an in-progress hold, for the ring. */
  const [holding, setHolding] = useState<{ x: number; y: number } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Pointers currently down on the map.
   *
   * A hold is only ever started by a lone finger. Without this, a pinch
   * started two holds: the second `pointerdown` overwrote `holdTimer.current`,
   * orphaning the first timer where no cancel path could reach it. It fired
   * mid-zoom and committed at `unproject` of the original screen point against
   * a camera that had since moved -- which is why the pin landed between the
   * fingers rather than under either of them.
   */
  const pointers = useRef(new Set<number>())

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

  const addPin = (m: LeafletMap, p: LngLat, color: string) => {
    // Not interactive, so a tap on a pin falls through to the map like any other.
    pins.current.push(
      new Marker([p.lat, p.lng], { icon: pinIcon(color), interactive: false, keyboard: false }).addTo(m),
    )
  }

  useEffect(() => {
    let cancelled = false

    resolveSources().then((sources) => {
      if (cancelled || !container.current) return

      const m = new LeafletMap(container.current, {
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        // Fractional zoom: MIN_ZOOM is 9.5, and a pinch should stop where the
        // fingers stop rather than snapping to a whole level.
        zoomSnap: 0,
        maxBounds: NYC_BOUNDS,
        // A hard wall rather than Leaflet's default rubber band, which lets the
        // player drag out into New Jersey and then yanks them back.
        maxBoundsViscosity: 1,
        // No rotation exists in Leaflet, so north-up -- essential, the Manhattan
        // grid is a primary orientation cue -- needs nothing switched off.
        zoomControl: false,
        // Safari's emulated long-press fires a contextmenu and swallows the next
        // click; careful mode's hold is ours, and nothing here wants a menu.
        tapHold: false,
      })
      m.attributionControl.setPrefix(false)
      // Leaflet's maxBounds only keeps the centre in the city; the screen edges
      // are free to show New Jersey. So the zoom floor is wherever the city box
      // exactly covers the screen -- which is also the opening framing -- and
      // it moves when the window changes shape, until the recap lifts the cage.
      const cover = () => Math.max(MIN_ZOOM, m.getBoundsZoom(NYC_BOUNDS, true))
      m.setMinZoom(cover())
      m.setView(NYC_BOUNDS.getCenter(), cover(), { animate: false })
      m.on('resize', () => {
        if (m.options.maxBounds) m.setMinZoom(cover())
      })
      for (const layer of imageryLayers(sources, MAX_ZOOM)) layer.addTo(m)
      link.current = new Polyline([], {
        color: '#fbbf24',
        weight: 2,
        dashArray: '4 4',
        interactive: false,
      }).addTo(m)

      m.on('click', (e) => {
        // Gated here rather than in the caller: the pin is dropped from this
        // handler, so a guard further downstream leaves a stray pin behind.
        // A tap mid-zoom-out would commit wherever the camera happens to be
        // pointing at that instant, which is not where the player aimed.
        // Careful mode commits from the pointer handlers below instead, so
        // this path must stay out of the way entirely -- otherwise a tap
        // commits through it and the hold-to-place guarantee is worthless.
        if (!canPlace.current || resetting.current || careful.current.on) return
        const p = { lng: e.latlng.lng, lat: e.latlng.lat }
        if (pendingPlace.current) clearTimeout(pendingPlace.current)
        pendingPlace.current = setTimeout(() => {
          pendingPlace.current = null
          addPin(m, p, '#fbbf24')
          place.current(p)
        }, DOUBLE_CLICK_WINDOW_MS)
      })

      // Belt and braces for gestures the pointer events do not describe as two
      // fingers -- a trackpad pinch, or a touch Leaflet has captured. If the
      // camera starts moving, whatever the player is doing is not placing.
      m.on('zoomstart', cancelHold)
      m.on('movestart', cancelHold)

      // The zoom itself is Leaflet's; all we do is call off the pending commit.
      m.on('dblclick', () => {
        if (pendingPlace.current) clearTimeout(pendingPlace.current)
        pendingPlace.current = null
      })

      map.current = m
      // Dev-only handle so browser-driven tests can assert on camera state.
      if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = m

      // Captured immediately, and replayed verbatim at the start of every round.
      // Recomputing per round, or easing into it, lets the previous reveal leak
      // position into the next prompt. The map was framed on the city a few
      // lines up, so where it sits now is the standard framing.
      standardFraming.current = { center: m.getCenter(), zoom: m.getZoom() }
      ready.current?.()
    })

    return () => {
      cancelled = true
      if (pendingPlace.current) clearTimeout(pendingPlace.current)
      map.current?.remove()
      map.current = null
      link.current = null
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

      // Registered before the move, which ends synchronously when motion is
      // reduced. If the player grabs the map mid-flight it fires when their drag
      // ends -- they have taken over, so hand control straight back.
      m.once('moveend', () => {
        resetting.current = false
      })
      const { center, zoom } = standardFraming.current
      m.flyTo(center, zoom, { duration: RESET_MS / 1000, animate: animate() })
    },

    revealAnswer: (guess, answer) => {
      const m = map.current
      if (!m) return
      addPin(m, answer, '#22c55e')

      // Straight line, not a great-circle arc: curvature over a few km is
      // sub-pixel, so interpolating it would be invisible work.
      link.current?.setLatLngs([
        [guess.lat, guess.lng],
        [answer.lat, answer.lng],
      ])

      m.flyToBounds(latLngBounds([guess.lat, guess.lng], [answer.lat, answer.lng]), {
        padding: [80, 80],
        maxZoom: REVEAL_MAX_ZOOM,
        duration: 0.9,
        animate: animate(),
      })
    },

    clearPins: () => {
      pins.current.forEach((p) => p.remove())
      pins.current = []
      link.current?.setLatLngs([])
    },

    focusLocation: (p, bottomInset = 0) => {
      const m = map.current
      if (!m) return
      // Close enough to read the block, wide enough to keep a neighbouring pin
      // in frame so the recap still feels like a map rather than a slideshow.
      //
      // The padding is load-bearing: the recap panel covers the lower half of a
      // phone screen, so centring the answer would put the pin directly behind
      // it. This lifts it into the visible strip above: the centre goes half the
      // inset below the pin, which puts the pin mid-strip. Always animated, even
      // with reduced motion -- the flight is what tells the player where the
      // next answer is relative to the last.
      const center = m.unproject(m.project([p.lat, p.lng], RECAP_ZOOM).add([0, bottomInset / 2]), RECAP_ZOOM)
      m.flyTo(center, RECAP_ZOOM, { duration: 0.9 })
    },

    showAllAnswers: (points) => {
      const m = map.current
      if (!m || !points.length) return
      points.forEach((p) => addPin(m, p, '#22c55e'))

      // maxBounds exists to stop players wandering out of the city mid-round.
      // The game is over; there is nothing left to constrain, and the recap
      // flies between answers which the cage would fight.
      m.setMaxBounds(undefined)
      m.setMinZoom(MIN_ZOOM)

    },
  }), [])


  // A declaration rather than a const: hoisting is what lets the map effect,
  // which is written above this, register it as a listener.
  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHolding(null)
  }

  const releasePointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    cancelHold()
  }

  /**
   * Careful mode: a press must survive `holdMs` without wandering. Released
   * early it commits nothing, which is the entire point -- there is no confirm
   * step anywhere else in the game, so this is the only undo a player gets.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.add(e.pointerId)
    // A second finger means a pinch, never a placement. Cancel what the first
    // one started rather than racing it -- and do this before the careful-mode
    // guard, so the set stays honest even when careful mode is off.
    if (pointers.current.size > 1) {
      cancelHold()
      return
    }
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
      // Re-checked at fire time, not only at press time: a second finger, a
      // round ending, or a camera reset can all happen inside the hold.
      if (!m || !canPlace.current || pointers.current.size !== 1) return
      const { lng, lat } = m.containerPointToLatLng([x, y])
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
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onPointerLeave={releasePointer}
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
