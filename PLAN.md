# NYC Daily Map Game — Phase 1 implementation plan

Source spec: `~/Downloads/NYC-MAP-GAME-SPEC.md`. This file records deviations, verified
facts, and milestone order. Spec wins where this file is silent.

---

## 0. Verified before writing code (2026-08-19)

Tile endpoints, probed with real NYC tile coords (z15 x=9649 y=12315, midtown):

| Endpoint | Status |
|---|---|
| `https://maps.nyc.gov/xyz/1.0.0/photo/{year}/{z}/{x}/{y}.png8` | 200 for years 2010–2018 (even). Real imagery, zero labels, serves z18. **Standard XYZ order.** |
| same, 2020 / 2022 / 2023 / 2024 / 2025 | 301 → `www.nyc.gov` → 403. Gone from this host. |
| `https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2022/MapServer/tile/{z}/{y}/{x}` | 200, 2022 imagery. Esri `{z}/{y}/{x}` order. |
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 200. Global fallback, attribution required. |

**Decision: DoITT 2018 primary.** City-owned, no license question, standard XYZ, highest
res over the footprint, confirmed unlabeled at z18.

**Open risk — imagery vintage.** DoITT here tops out at 2018; the spec's `venue` category
is the one that churns. A bar that opened in 2021 sits on a 2018 rooftop that looks like
whatever was there before. If playtests show venue rounds feel wrong, switch to
NYC_Orthos_2022 (costs the Esri y/x flip, nothing else). Do not decide this in advance —
it only matters if it shows up in play.

Fallback wiring: one `fetch` probe of a known tile at boot with a ~1.5s timeout, pick the
source URL from the result. MapLibre's multi-URL `tiles` array shards across hosts, it does
not fail over — do not use it for this.

---

## 1. Deviations from the spec

Each of these is smaller than what the spec describes and does the same job. Anything not
listed here, build as written.

**Tap/pan disambiguation → use MapLibre's `clickTolerance`.**
The spec calls for a hand-rolled pointerdown/up handler tracking `startX/startY/startTime`.
MapLibre already suppresses `click` when the pointer moved past `clickTolerance` (default 3)
during the gesture. Set `clickTolerance: 10` and use `map.on('click')` — the <10px rule
comes free and correct, including multi-touch and inertia cases a hand-rolled version gets
wrong. The 300ms half is dropped: a deliberate, motionless 400ms press is a real tap, not a
pan, and the timer would reject it. Custom pointer handling stays only in careful mode,
which genuinely needs it for the ring. Revisit if device testing shows tolerance-only misses.

**Reveal arc → straight GeoJSON LineString.** Great-circle curvature over ≤30km is
sub-pixel. Two `Marker`s plus one line layer; no arc interpolation, no `pins.ts`.

**Coordinate obfuscation → XOR the whole `locations` blob, not per-field.** Base64 + a
date-keyed XOR over one JSON string, decoded at load. Field-level XOR over floats is fiddly
for no extra protection. ~8 lines, not the spec's hour.

**Puzzle date → `Intl.DateTimeFormat`.** `Intl.DateTimeFormat('en-CA', {timeZone:
'America/New_York'}).format(d)` yields `YYYY-MM-DD` directly. No date library. Countdown to
next rollover computes off the same call.

**Haversine → 6 lines.** No turf.js.

**File tree collapsed.** Spec's 15 files → ~10: fold `pins.ts` into `MapView.tsx`,
`obfuscation.ts` into `loadPuzzle.ts`, `types.ts` into `loadPuzzle.ts`. Split back out when
a file actually gets unpleasant.

**Deps: `maplibre-gl`, `tailwindcss`, and nothing else.** No react-map-gl (spec agrees),
no state library (spec agrees), no date library, no geo library.

---

## 2. Architectural constraint worth stating once

**MapView mounts once and stays mounted for the entire game.** Round and Reveal are
overlays on top of it, not sibling screens that swap. Unmounting between rounds refetches
every tile and makes the camera reset visible as a flash. The round machine drives the map
imperatively through a ref: `resetCamera()`, `showGuess()`, `showAnswer()`, `fitBoth()`.

The camera reset is the correctness-critical one. Compute the standard framing once at boot
(`cameraForBounds(NYC_BOUNDS, {padding: 20})`) and store it; call `jumpTo` with that exact
stored camera at the start of every round. Recomputing per round, or easing into it, lets
the previous reveal leak position into the next prompt.

---

## 3. Milestones

Each ends at something runnable. Ordered so the riskiest unknown (does this feel good on a
phone) is reachable early rather than gated behind content.

**M0 — scaffold.** `npm create vite@latest -- --template react-ts`, tailwind, maplibre-gl.

**M1 — the map.** `MapView.tsx`: bounds, minZoom 9.5, maxZoom 18, rotation and pitch off,
tile probe + source selection, standard framing computed once.
*Done when:* pan is bounded to NYC, zoom refuses past 18, and z18 imagery shows no label
layer anywhere in the five boroughs.

**M2 — one round, end to end.** One hand-written puzzle JSON. Prompt banner, click commits,
haversine, per-class λ score, reveal with both pins and the connecting line, camera fits
both, blocks copy, Next button.
*Done when:* a single round is playable and the block phrasing reads right at 50m, 400m,
and 5km.

**M3 — the full day.** Five rounds, `[1,1,2,3,3]` multipliers, camera hard-reset between
rounds, GAME_OVER, results screen, share string, clipboard + Web Share.

**M4 — persistence and rollover.** The three `localStorage` keys, mid-game resume, ET date
computation, landing screen with completed-state and midnight countdown.
*Done when:* refreshing mid-round-4 resumes at round 4 with rounds 1–3 intact.

**M5 — mobile hardening. Needs a real phone; do not sign this off in a desktop browser.**
`touch-action: none`, `-webkit-touch-callout: none`, `user-select: none`, `contextmenu`
preventDefault. Careful mode: hold-to-commit with ring, 800ms default, 0.8/1.5/3s options,
early release cancels. Settings screen. 380px one-handed layout.
*Done when:* the full acceptance checklist passes on an actual iOS Safari and Android
Chrome device.

**M6 — content.** See below.

---

## 4. Content scope — the real long pole

The spec says Phase 1 ships 30 hand-built days. That is 150 locations, each needing
coordinates, a class, a difficulty tier, `factShort`, `factLong`, and a source — days of
writing, and it all gates on questions playtesting hasn't answered yet.

**Build 5 days first, playtest, then expand.** The spec's own closing note says the thing to
learn first is whether round-2 taps improve after round 1's reveal, and how much of the
`venue` category survives contact with players. If venues turn out to be unfair-hard rather
than fun-hard, a chunk of 150 hand-written entries gets thrown away. Five days is enough to
find that out.

Keep the borough rule from day one — at least two of five outside Manhattan — since it
shapes which locations get written at all.

---

## 5. Deferred, with triggers

- Polygon containment for `area` (spec already defers; centroid + λ=400 until then)
- The harvest/ranking pipeline — Phase 2, and only worth building once daily content is the
  bottleneck rather than the game design
- Timer, hard mode, the name — spec's open questions, all answerable after playtest
- Colorblind share palette — ships with M5 settings if cheap, otherwise first feedback

---

## 6. Decisions taken during build

**z18 cap confirmed by eye (2026-08-19).** DoITT serves through z21 and its native 6-inch
survey is ~0.15 m/px (≈z19–20), so the cap discards roughly two thirds of the available
detail on purpose — it is a difficulty dial, not a technical ceiling. Held at 18 after
looking at real imagery: rooftop text legible at 0.45 m/px is metres tall, which means it
sits on `area`/`landmark` locations whose shape already gives them away, while `venue`
roofs are blank and leak nothing at any zoom.

Knob: `MAX_ZOOM` in `src/map/MapView.tsx`. Turn it down for the spec's open "hard mode"
question; turn it up only if playtests show `venue` rounds are unfair-hard rather than
fun-hard, since close inspection is the only tool players have on that class.

---

## 7. Design changes from playtest notes (2026-08-19)

**Facts moved out of the per-round reveal to the end of the game.** The spec had put
`factShort` inline on each reveal card and treated fact length as a pacing constraint
because of it. Facts now batch to the end instead, so the per-round reveal carries only the
miss copy and the score, and the pacing constraint it was written to solve goes away.
`factShort` and `factLong` both survive -- the card shows short, tapping opens long.

**The recap is spatial, not a list.** At game over the camera pulls back to hold all five
answers and every fact card is anchored to its own pin, so the day reads as a map of where
you were rather than an accordion. Implemented as one MapLibre `Marker` per location with
React portalled into it, which keeps the cards tracking their pins through pan and zoom
without re-rendering on every frame.

Every card is readable outright at game over -- nothing in the recap hides behind a tap,
since the recap is the payoff. Tapping a card swaps `factShort` for `factLong`.

Cards are de-overlapped with a greedy vertical nudge (`deoverlap` in `MapView.tsx`), so
clustered answers stack rather than covering each other. Positions are derived from
`map.project()` on every camera move rather than stored, which means they cannot drift out
of sync with the map.

*Known ceiling:* a nudged card sits away from its own pin with no leader line joining them.
Five cards is fine; if days routinely cluster four answers in lower Manhattan, this wants
real label placement rather than a bigger nudge.

**Results overlay the map rather than replacing it.** Total, share squares, block average
and the share button sit in a sheet over the live map, so the recap stays visible behind it.

**Double-click to zoom no longer commits a guess.** MapLibre fires click, click, dblclick,
so with commit-on-tap the first click of a zoom gesture was submitting an answer. Placement
now waits out a 300ms double-click window before committing; a `dblclick` inside that window
cancels it. The delay is on the commit only.

*Tune on device (M5):* 300ms matches MapLibre's own double-click window. If placement feels
laggy on a phone, the honest fix is dropping the guess pin optimistically on click and
retracting it on `dblclick`, not shortening the window -- shortening it starts letting
double-clicks through as guesses again.

---

## 8. Roadmap

**Hints — subway overlay.** An "ask for a hint" control that superimposes the subway lines
on the imagery, for a score penalty. The lines are a strong orientation aid without naming
anything, so this stays inside the no-labels rule as long as station names are not drawn.
Source: NYC Open Data subway routes GeoJSON, added as a line layer above the raster and
toggled. Open: flat penalty per hint, or a multiplier on that round's score.

**Beta mode — playtest codes.** A code that unlocks five plays per day drawn from the *next*
scheduled days' rounds, so testers burn future content instead of replaying today's. Needs a
feedback capture path and somewhere to put the results, which is the first thing in this
project that genuinely needs a backend -- it should be scoped alongside whatever Phase 3
account work happens rather than bolted onto the static build.

*Note:* playing tomorrow's locations early means testers cannot play them fresh on the day,
so either the harvest pipeline stays ahead enough to burn days cheaply, or beta days come
from a separate pool that never enters the main rotation. Decide before content is scarce.

**Scoring recalibrated (2026-08-19).** The spec's lambdas (area 400, landmark 250, venue
350) decayed far too fast to match how a miss feels on the ground: a guess half an avenue
from the Louis Armstrong House -- essentially the right block -- scored 58, and one block
out scored 80. Retuned to area 2500, landmark 1600, venue 2200, anchored on ~15 short blocks
earning a middling score rather than near-zero.

| miss            | venue was | now | landmark was | now |
|-----------------|-----------|-----|--------------|-----|
| 1 block         | 80        | 96  | 73           | 95  |
| half an avenue  | 58        | 92  | 47           | 89  |
| 5 blocks        | 32        | 83  | 20           | 78  |
| 15 blocks       | 3         | 58  | 1            | 47  |
| 3 miles         | 0         | 11  | 0            | 5   |
| wrong borough   | 0         | 1   | 0            | 0   |

The far end still has to stay near zero or tapping the middle of Manhattan every round
becomes a viable strategy -- that is the constraint the tuning is squeezed against, and the
anchors are pinned in `scoring.test.ts` so a future retune has to be deliberate.
