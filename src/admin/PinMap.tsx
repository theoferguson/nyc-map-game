import { useEffect, useRef, useState } from 'react'
import { Map as LeafletMap, Marker, divIcon } from 'leaflet'
import { resolveSources } from '../map/tiles'
import { imageryLayers } from '../map/layers'
import type { DayLocation } from '../data/validateDay'

/**
 * The whole point of the editor.
 *
 * "Staten Island Ferry" sat at 40.6626, -74.0521 for weeks: a real coordinate,
 * inside New York, inside the map bounds, passing every numeric check there
 * was. One look at it on imagery would have shown open water. Numbers cannot
 * be reviewed for plausibility; a pin can.
 *
 * All five of the day's pins are drawn, so a day whose answers cluster in one
 * neighbourhood -- or one that has drifted into the harbour -- reads at a
 * glance rather than needing five separate checks.
 */
export function PinMap({
  locations,
  selected,
  onMove,
}: {
  locations: DayLocation[]
  selected: number
  onMove: (lat: number, lng: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const markers = useRef<Marker[]>([])
  /**
   * State, not `map.current`. A ref does not re-render, so an effect that
   * depends on one never re-runs when the map finally exists -- and the map is
   * built behind an async tile probe. Markers would simply never appear, with
   * nothing looking broken. Same failure as the camera reset in section 7.
   */
  const [ready, setReady] = useState(false)
  // Read inside map callbacks, which are registered once and would otherwise
  // close over the first render's values forever.
  const latest = useRef({ locations, selected, onMove })
  // Written during render on purpose: the map's click handler is registered
  // once and would otherwise hold the first render's props forever. The value
  // is never read during render, so it cannot affect what is drawn.
  // oxlint-disable-next-line react/refs
  latest.current = { locations, selected, onMove }

  useEffect(() => {
    if (!container.current) return
    let cancelled = false

    void resolveSources().then((sources) => {
      if (cancelled || !container.current) return
      const m = new LeafletMap(container.current, {
        center: [40.72, -73.97],
        zoom: 10,
        // The surveys stop at z18, so past it there is nothing to request.
        maxZoom: 18,
        zoomControl: false,
      })
      m.attributionControl.setPrefix(false)
      for (const layer of imageryLayers(sources, 18)) layer.addTo(m)
      m.on('click', (e) => latest.current.onMove(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)))
      map.current = m
      setReady(true)
    })

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      setReady(false)
    }
  }, [])

  // Markers are rebuilt rather than diffed: five of them, and a rebuild cannot
  // leave a stale pin behind after an edit.
  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const marker of markers.current) marker.remove()
    markers.current = locations.map((l, i) => {
      const active = i === selected
      const size = active ? 18 : 12
      const icon = divIcon({
        className: '',
        iconSize: [size, size],
        html: `<div style="width:100%;height:100%;box-sizing:border-box;border-radius:50%;
          background:${active ? '#fbbf24' : '#ffffff'};border:2px solid #171717;
          box-shadow:0 1px 4px rgba(0,0,0,.6);cursor:pointer"></div>`,
      })
      // Clicks bubble to the map, as they did before: a click on a pin moves the
      // highlighted one there, which is the only thing a click here ever does.
      return new Marker([l.lat, l.lng], { icon, title: l.prompt, bubblingMouseEvents: true }).addTo(m)
    })
  }, [locations, selected, ready])

  // Keyed on which location is being edited, not on its coordinates: flying to
  // it on every keystroke would fight the operator typing a latitude.
  const focusedId = locations[selected]?.id
  useEffect(() => {
    const l = latest.current.locations[latest.current.selected]
    if (!map.current || !l) return
    map.current.flyTo([l.lat, l.lng], 15, { duration: 0.6 })
  }, [focusedId, ready])

  return (
    <div className="space-y-2">
      <div ref={container} className="isolate h-72 w-full overflow-hidden rounded-xl ring-1 ring-white/10" />
      <p className="text-[11px] text-neutral-500">
        Click the map to move the highlighted pin. Zoom in far enough to see the
        building — that is the check a coordinate cannot give you.
      </p>
    </div>
  )
}
