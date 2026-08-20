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

**No further days until deploy** (decided 2026-08-19). One authored day is enough to build and
test against, and writing more before there are players means writing against guesses. At
deploy, author the first 50 days in one pass, then use collected play data to build a
generative engine that keeps at least 10 days queued.

*What the queue depth is actually for:* redundancy if authoring stalls, and beta testers, who
consume upcoming days rather than replaying today's.

*No separate beta pool* (decided 2026-08-19). The value of beta access is concentrated in
bunched early plays -- a tester getting through many rounds in one sitting is exactly the
feedback density that answers whether `venue` works -- not in sustained daily access. So the
drain is a burst against a bounded window, not a continuous leak, and a 10-day buffer covers
it. Beta days come from the ordinary queue.

Two consequences to hold onto: beta access wants to be a bounded cohort window rather than an
always-on feature, or the burst assumption stops holding; and a tester who burns day 47 early
cannot play it fresh on the day, which is their trade to make and not a bug to design around.

**Parked until after go-live** (2026-08-19). The engine is not to be designed or evaluated
before there is real play data -- designing it against guesses about what the data will show
is how you end up with a model fitted to assumptions. The notes below exist so the telemetry
already captures what it will need, not as a brief to start work.

*What "generative" can and cannot learn from play data:* round results measure difficulty
well -- score distribution and time-to-guess per location are exactly the calibration signal
the difficulty tiers need, and far better than guessing. They do not measure whether a place
is *worth* including. Nothing in the telemetry distinguishes a beloved landmark from a
well-known traffic intersection. So the engine is candidate harvest plus fame ranking plus
play-calibrated difficulty, with the human pass still in the loop -- the spec's own warning
stands, that an automated score will confidently rank a random subway station above the
Stonewall Inn.

Venue freshness stays a manual gate regardless: a generated day can schedule a bar that shut
in 2024, and no amount of play data will say so.

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

**Custom quizzes and an admin panel.** An authoring UI that builds a quiz -- pick answers by
clicking a map rather than typing coordinates, set each prompt, class and point value -- and
shares it by code, the same delivery as the beta codes above.

Scope becomes a property of the quiz rather than a constant: city, state, country or global.
This is the feature that turns a New York game into a game engine, and most of the work is
not the admin panel. It is that four things currently hardcoded to New York have to become
per-quiz:

| hardcoded today | where | why it breaks elsewhere |
|---|---|---|
| `NYC_BOUNDS`, min zoom, standard framing | `MapView.tsx` | every quiz needs its own extent |
| blocks and avenues | `scoring.ts` `describeMiss` | "3 avenues off" is nonsense in London, and meaningless at country scale |
| lambda per class (3000 / 2000 / 2600) | `scoring.ts` | tuned for city distances; a global quiz misses by thousands of km and every guess scores zero |
| DoITT imagery, z18 cap | `tiles.ts` | the city surveys stop at the city line, so anything outside NYC is Esri-only |

So the unit of configuration is a **scope**: a bounding box, a zoom range, a distance
vocabulary, and a lambda set. Daily NYC becomes one scope among several rather than the
assumption the code is built on. The lambda point is the one most likely to be
underestimated -- the decay curve is calibrated in metres against how a *city* miss feels,
and a country-scale quiz needs values two or three orders of magnitude larger or every
answer scores zero.

Per-question point scaling is the cheap part: `MULTIPLIERS` moves from a module constant to a
field on each question. `MAX_TOTAL` is already derived rather than hardcoded to 1000, so the
share string and results survive that unchanged.

**Server-backed, Phase 3.** Decided 2026-08-19 against the fragment-encoded alternative, which
would have shipped sooner and touched no infrastructure. The server buys discoverability,
editing after sharing, and play counts -- and it puts custom quizzes alongside beta codes and
accounts, all of which need the same backend, rather than building a delivery mechanism twice.

*Two consequences that follow from that choice:* hosting quizzes means hosting user-generated
content, so moderation, reporting and takedown are in scope from the start rather than
discovered later. And custom quiz results must be segregated from daily telemetry, or the
affinity model and the imagery experiment are both polluted by scopes and scoring curves they
were never calibrated against.

**Beta mode — playtest codes.** A code that unlocks five plays per day drawn from the *next*
scheduled days' rounds, so testers burn future content instead of replaying today's. Needs a
feedback capture path and somewhere to put the results, which is the first thing in this
project that genuinely needs a backend -- it should be scoped alongside whatever Phase 3
account work happens rather than bolted onto the static build.

*Resolved (2026-08-19):* beta days come from the ordinary queue, no separate pool. The point
of beta access is bunched early plays rather than sustained daily access, so the draw is a
burst inside a bounded window that the standing queue absorbs. See section 10.

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

**Scoring reshaped, not just retuned (2026-08-19).** Widening lambda alone could not fix
"punishing": a plain exponential is steepest exactly where players are most accurate, so
tightening the tail to keep blind guessing worthless made near misses brutal, and loosening
it to reward near misses made tapping midtown every round viable. Raising distance to a
power first flattens the head and then falls off harder, which lets both ends be right:

    score = 100 * exp(-(d / lambda) ^ 1.5)      area 3000, landmark 2000, venue 2600

| miss              | plain exp | now |
|-------------------|-----------|-----|
| 5 blocks          | 83        | 94  |
| 15 blocks         | 58        | 73  |
| 1.5 miles         | 34        | 41  |
| blind midtown tap | 20        | 21  |
| wrong borough     | 1         | 0   |

*Consequence:* the head is now flat enough that anything inside ~75m scores 100, so the
explicit 40m bullseye is belt-and-braces rather than load-bearing. Precision below a block
is unrewarded for venues. If tapping the actual door should beat being a block away, that is
a separate mechanic -- a precision bonus -- not more lambda tuning.

**Two features were dead behind one event.** `standardFraming` and the map instance that
drives the fact cards were both assigned inside `m.once('load', ...)`. When that never
fired, the camera never reset between rounds (leaving the player buried at the reveal zoom)
and the end-of-game cards never rendered -- while the map itself worked fine, so nothing
looked broken. Neither needed the event: `cameraForBounds` only wants the container size.
Both are now captured synchronously at construction.

*Rule of thumb this earns:* do not hang state that other features read off a map lifecycle
event unless that state genuinely cannot exist earlier. A silent no-op is worse than a crash.

**Reveal zoom capped at z15.** Framing guess and answer together meant a near-perfect guess
produced a tiny box and `fitBounds` slammed to the zoom cap, so every good round ended with
a long pinch back out to the city. The round is over by then, so the detail buys nothing.

**Camera reset eased rather than cut.** Round transitions now run the reveal's zoom-in
backwards over 900ms instead of snapping to the wide view. The destination is still the
single camera computed at startup, so the spec's requirement that every round begin from an
identical framing survives -- only the path to it changed.

Placement is suppressed while the reset is in flight: a tap mid-zoom-out would commit
wherever the camera happened to be pointing at that instant, which is not where the player
aimed. Grabbing the map mid-flight aborts the ease and hands control straight back, which
does mean an interrupted reset can start a round off-framing -- acceptable, since taking the
map over is deliberate, and the alternative is locking the player out of their own map.

On the final round the recap framing runs instead of the reset, rather than both firing and
fighting each other.

**Recap cards made inert, and joined to their pins by leaders (2026-08-19).** Two reported
problems, one cause: five 184x128 cards, each capturing pointer events, formed a wall over
the map, so any drag starting on a card did nothing and the map could not be panned to reach
cards near the edges.

Cards are now `pointer-events-none` throughout. They are read, not operated, so they have no
business consuming gestures aimed at the map underneath. Tap-to-expand went with it, which
leaves `factLong` with no home in the UI -- it belongs in the results sheet as an accordion,
which is where the spec always had it.

Displaced cards are joined to their pin by a leader line and a dot. Without one, a card
nudged clear of a neighbour is just floating near several pins with no way to tell which one
it describes -- the de-overlap was working and still read as broken. `deoverlap` now returns
`anchorX/anchorY` alongside the card position so the leader lands on the pin rather than on
wherever the card drifted to, and a test pins that.

Recap framing now derives its padding from the card size rather than using round numbers.
Cards hang above their pins and are wider than them, so the camera has to frame the cards,
not the answers; the previous 150px top padding cut the northernmost card off the screen.

**Card heights are measured, not estimated (2026-08-19).** The de-overlap was correct and
running on wrong numbers: it reserved a fixed 122px per card while a real card renders
anywhere from ~130px to ~260px depending on how long that location's fact runs. Cards it
believed were clear overlapped by a hundred pixels, which looked exactly like a broken
de-overlap.

Heights are now read from the rendered DOM in a layout effect and fed back into placement.
The first pass assumes a tall card, so cards only ever settle inward and never flash an
overlap. `deoverlap` takes a height per card and a viewport height, and clamps so nothing
hangs off the top of the screen where it cannot be reached.

*The general lesson:* any constant describing rendered text is a guess with a short shelf
life. Measure it or fix it -- do not estimate it.

**maxBounds released at the recap.** The cage exists to stop players wandering out of the
city mid-round. At the end-of-game framing the viewport is *wider than the city*, so
MapLibre had nowhere legal to pan and the map locked solid -- reported as "the map doesn't
navigate", and it genuinely did not. The game is over by then and there is nothing left to
constrain, so the bounds are dropped when the recap opens.

**Esri layered under DoITT.** DoITT stops at the city line, so the recap framing -- which
pulls back further than the city -- rendered everything outside the five boroughs as a black
void, which reads as a broken map and made panning feel pointless. Esri World Imagery now
draws underneath to fill the surround, with DoITT's sharper imagery on top wherever it has
coverage. Both attributions are already carried.

**The recap froze the tab (2026-08-19).** "The map doesn't pan" was not a pan bug at all --
the page was locked solid. `deoverlap` had an infinite loop, and it hit on the fifth Next of
every game.

The loop pushes a card to `other.y + CARD_GAP + h`, which clears `other` only if
`(other.y + CARD_GAP + h) - h` recovers `other.y + CARD_GAP` exactly. In floating point it
does not. Projected coordinates are fractional, the round trip lands an ULP low, the card
still tests as overlapping, and it is reassigned the identical value forever. The
termination argument is sound in exact arithmetic and wrong in doubles. Fixed by rounding to
integer pixels, where the cancellation is exact, plus a bounded pass count as a backstop --
a card in the wrong place beats a frozen tab.

Found by bisecting in a real browser after two wrong guesses from reading the code. Loading
the recap state directly was fine; only reaching it through play froze, because that path
produced the fractional geometry that triggered it.

**Overflow columns.** Five cards of two hundred-odd pixels need ~1100px of stack and a phone
gives ~800. The previous "fold back to the top of the column" overflow dropped cards onto
the ones already placed there -- the exact overlap the function exists to prevent. A full
column now starts another beside it, alternating right and left of the pin.

---

## 9. Imagery experiment and data capture (2026-08-19)

**`factLong` dropped.** It lost its home when the recap cards became inert, and carrying an
unused long-form write-up is real authoring cost on every one of ~1,800 locations a year.
Removed from the schema and from the one built day. `factShort` is what the recap shows.

### The imagery A/B

Two city surveys, assigned 50/50 and **sticky per browser** in `nycmap:imagery`:

| variant | source | wordmark |
|---|---|---|
| `doitt-2018` | `maps.nyc.gov` DoITT photo/2018 | NYC aerial · 2018 |
| `nyc-2024` | `tiles.arcgis.com` NYC_Orthos_2024 | NYC aerial · 2024 |

2024 was found while probing for 2022 and is the better comparison -- six years apart rather
than four, against a `venue` category that churns fastest. (A 2023 service exists but returns
HTML, not tiles.) Esri World Imagery still draws underneath both to fill outside the city.

Stickiness is the experiment. Reassigning per round or per day would mix both surveys into
one player's results and make the comparison meaningless, quite apart from the imagery
visibly changing mid-game. A test pins it.

A small wordmark in the bottom-left names the survey the player is on -- honest about what
they are looking at, and it makes the variant visible in any screenshot they share.

**Primary metric: venue-round score.** Chosen 2026-08-19, before any data existed, which is
the only time such a choice is worth anything. It is the measure most sensitive to the thing
actually being changed -- fresher rooftops should help most where the target is a shopfront
rather than a stadium. Time-to-guess on venue rounds and completion rate are secondary and
descriptive; if the primary shows nothing, a secondary that does is a hypothesis for the next
experiment, not a result from this one.

*Statistical caveat worth stating up front:* five rounds a day against an early player base
will not power a real test for a long while. Treat the first weeks as directional only. It
also means the two variants are playing measurably different games, which is fine now and
becomes a fairness problem the moment leaderboards exist -- Phase 3 must either freeze the
variant or exclude experiment cohorts from ranking.

### Data capture

`src/game/telemetry.ts`. Events buffer in `localStorage` and **nothing is transmitted** --
there is no backend, and no data should leave the device before there is a consent story.
Buffering now means the schema is exercised by real play from day one instead of being
designed in the abstract against a backend that does not exist.

| event | carries |
|---|---|
| `game_start` | puzzle number, date, viewport, first-touch attribution |
| `round_complete` | round, location id, class, borough, difficulty, distance, score, ms-to-guess |
| `game_complete` | total, per-round scores, average distance, duration |
| `share` | method (Web Share vs clipboard), total |

Every event carries an anonymous install id and the imagery variant.

**Optimization** questions this answers: which locations are unfairly hard (low scores plus
long ms-to-guess), whether difficulty actually climbs across the five rounds as intended,
where players abandon, and whether the imagery variant moves any of it. `msToGuess` is the
one that cannot be reconstructed later, which is why it is captured from the start.

**Marketing** is first-touch only -- referrer hostname and any UTM parameters, recorded on
the first visit and never overwritten. Where somebody came from the day they discovered the
game is the question; the referrer on their fortieth visit is not. Plus share rate and
method from the `share` event.

**Deliberately not captured:** no accounts, no contact details, no device geolocation, no IP,
no full referrer URL (hostname only). The only coordinates recorded are the ones the player
deliberately tapped inside the game. Storage failures are swallowed -- Safari in private mode
throws on write, and telemetry must never break a game.

**Open before anything is transmitted:** a consent notice is likely required in the EU/UK
once events leave the device, even anonymous ones. Decide the lawful basis and the banner
before wiring a flush endpoint, not after. `drain()` exists as that seam and is deliberately
not called anywhere yet.

### Location affinity (planned, not built)

Gameplay reveals which parts of the city a player actually knows. Somebody who drops a pin on
Katz's in four seconds from a cold start knows the Lower East Side; somebody who lands in the
East Village knows the neighbourhood but not the block. That is a far better targeting signal
than anything a form would collect, and it is a by-product of the game rather than something
extra asked of the player.

**Most of the raw signal is already captured.** `round_complete` carries location id, class,
borough, difficulty, distance, score and ms-to-guess. No new events are needed to start; what
is missing is the derivation and one schema addition.

**Raw score is the wrong measure and will mislead.** A high score on Katz's may only mean the
player is good at the game. Affinity is the *residual*: how far this player's result sits
above their own average, and above the population's average on that same location. Both
normalisations matter -- the first separates local knowledge from general skill, the second
separates genuinely obscure places from ones everybody gets. Ranking on raw score would
surface the easiest locations to the best players, which is the opposite of useful.

**The hard constraint is sparsity.** A daily game gives at most one observation per player per
location, ever. One data point on Katz's is weak evidence and there is no second one coming.
So affinity has to be built at the **category** level and only then attributed back to
individual places: this player is strong on Lower East Side venues, on pre-war civic
buildings, on Queens generally. Individual-location affinity is an output of the category
model, not an input to it.

**Tagging locations is the enabling piece, and it is now in the schema.** `class` and `borough`
are too coarse -- they cannot distinguish a deli from a nightclub, or SoHo from Inwood. Every
location carries a `tags` array (neighbourhood, era, venue type, theme); a test rejects any
day with fewer than three tags per location, because retrofitting them across accumulated
content is the expensive version. Tags ride along on `round_complete`, so the affinity model
has its categories from the first day of real play. They also feed themed days and difficulty
tiering.

**Consent basis changes here, and this is the part to get right before building it.** Product
analytics that improve the game are one thing; profiling individuals to target advertising is
another, and under GDPR/UK GDPR it generally requires opt-in consent rather than legitimate
interest. Two further points: today's install id is anonymous, but Phase 3 accounts would tie
these profiles to real identities and make them personal data outright; and inferred
neighbourhood familiarity is close to a home-location inference, which is sensitive in a way
raw game scores are not. Decide the consent flow and the retention window before the profiles
exist, because deleting them afterwards is much harder than not building them yet.

### Player location

**What is captured now:** `game_start` carries IANA timezone and browser locale. No third
party, no network call, nothing about the player's IP leaving the device.

**What that is actually worth:** timezone answers "which part of the world", not "which
neighbourhood". `America/New_York` spans Maine to Florida, so it cannot separate a local from
a visitor -- which is the question that would most explain scores, and probably the single
most valuable bit this game could know about a player.

**Why IP geolocation is not wired up yet.** There is no backend, and resolving an IP from the
browser means calling a third-party lookup service: every player's IP handed to a vendor, on
a request ad blockers routinely block, with rate limits behind it. The server-side version is
better on every axis -- it already sees the request IP, resolves it without involving anyone
else, and can store city/region while discarding the address. So this lands with the backend
rather than being bolted onto a static build.

*If it is wanted before then*, a client-side vendor lookup is a small change -- it is a
deliberate trade, not a technical obstacle, and worth making knowingly.

**When it does land:** store city or metro, not coordinates; never retain the raw IP; and note
that IP geolocation is explicitly personal data under GDPR/UK GDPR even before it is joined
to anything else. Combined with the neighbourhood-familiarity inference above, the two
together get closer to identifying where somebody lives than either does alone -- which is
the version worth having a retention policy for before it exists rather than after.

---

## 10. M4 — persistence and rollover (2026-08-19)

**The day is New York's day, for everyone.** `src/game/date.ts` derives the puzzle date from
`America/New_York` via `Intl`, no date library. Not UTC -- a player in the city would roll to
tomorrow's puzzle at 8pm -- and not the device clock, which would hand a player in Berlin New
York's Tuesday on their Wednesday.

The countdown resolves the next New York midnight in two passes: the first uses the current
UTC offset, the second uses the offset actually in force at the instant found. They differ
across a clock change, which is why the day before one is 23 hours long and the day before
the other is 25. Both are pinned by test against the real 2026 transitions.

**Only the taps are saved.** `nycmap:progress:YYYY-MM-DD` stores guessed coordinates and
nothing else; distance, score and miss copy are replayed through the live scoring rules on
resume via a single `scoreGuess`. Storing the numbers instead would copy the scoring rules
into storage, and the recalibration earlier in this file would have left resumed games
showing totals the game could no longer produce.

Progress is written on commit, not on Next, so a refresh during the reveal cannot cost a
round already played. Older days are pruned on save -- one key per day would otherwise
accumulate for as long as somebody keeps playing.

*Simplification:* a refresh during a reveal resumes at the start of the next round rather
than restoring the reveal card. Every score survives, which is the part that matters; the
player loses only a card they had just read.

**Stats are idempotent per day.** `recordGame` no-ops if that date is already recorded, so
reopening the results screen cannot inflate played count or streak. Streaks continue when the
last completed day is the calendar day before, which is why `previousDate` handles month,
year and leap-day boundaries.

**A landing screen, including on resume.** A player who refreshes gets `Resume` rather than
being dropped straight back on the map wondering whether their game survived. A finished game
bypasses the landing entirely and restores the recap.

### Two bugs the browser test caught that unit tests could not

**Reloading a finished game restored the cards but no answer pins.** The recap effect fired as
soon as `puzzle` and `over` were true, which on a cold load beats the map into existence --
the map is built behind an async tile probe. `map.current?.showAllAnswers()` then no-opped
silently. MapView now reports readiness through `onReady`, and the effect waits for it. This
is the second time an optional-chained call on the map handle has failed silently rather than
loudly; anything that drives the map on first paint has to wait for it.

**Restoring a finished game added a second set of pins.** `next()` and the restore effect both
called `showAllAnswers`. Now only the effect does, so fresh completion and reload follow one
path.

### Code review fixes on M4

Seven findings, all real, all fixed. Three were reproduced before being touched.

**Blank page on a stats key holding `"null"`.** `storage.parse` returns its fallback for a
falsy raw value or a parse error -- but `"null"` parses cleanly *to* `null`, and reading
`.distribution` off it throws. `loadStats` runs during render via `useState(loadStats)`, so
this was an uncaught render throw: a blank page on every load, fixable only by clearing site
data. Exactly the failure the module's own docstring promises cannot happen. A guard that
only catches malformed input misses input that is well-formed and wrong.

**A corrupt guess shifted every later one onto the wrong location.** `loadProgress` filtered
invalid entries instead of truncating, so `[valid, corrupt, valid]` compacted to two guesses
and scored guess 3 against location 2 -- wrong distance, wrong score, wrong copy, and nothing
to indicate it. Truncates at the first bad entry now.

**Midnight mid-game swapped the puzzle underneath the player.** `today` was recomputed every
render and was the sole dependency of the loading effect, so crossing New York midnight
loaded tomorrow's puzzle while `round`, `results` and the current reveal still described
today's -- then wrote the guesses under the new date, whose purge loop deleted the real save.
The date is pinned at load now, and rollover is handled only where no game is in progress.

**A save longer than its puzzle bricked the game permanently.** Replaying guesses past the end
of `locations` threw on `undefined.lng`; the throw landed on the error screen, which offers no
route back to the only code that rewrites the progress key. Reachable by re-authoring a day
with fewer stops. Bounded now.

Also: recording a completed game no longer waits on the map, so a WebGL failure cannot silently
lose it from played/streak/distribution; the countdown reloads when it reaches zero, but only
from screens where no game is in progress; and `scoreGuess` is evaluated once per guess.

*The pattern across these:* every one is a storage or clock edge that unit tests would pass
and a player would hit eventually. Storage is untrusted input, and the clock moves while the
page is open.

---

## 11. Roadmap sources — verified 2026-08-19

Dataset identifiers previously written from memory. Three of the four were wrong, so they
are recorded here as checked rather than assumed.

| source | status |
|---|---|
| LPC Individual Landmark Sites | **`ts56-fkf5`** on data.cityofnewyork.us — 1,532 records, matching the spec's "~1,450" |
| Wikipedia pageviews API | works, but the host is **`wikimedia.org`**, not `en.wikipedia.org` — the obvious URL 404s |
| Subway *route* linework | **not located.** data.ny.gov carries stations, complexes and entrances; route geometry did not surface |
| Historic Districts / Scenic Landmarks | `xbvj-gfnw`, `gi7d-8gt5` — exist, useful for `area` |

**The subway gap matters for the hint feature.** Hints were specced as superimposed subway
*lines*, which work because they trace the city's shape without naming anything. Station
points are a weaker hint — a scatter of dots — and a labelled station map would give the
answer away outright, which the no-labels rule forbids. Either route geometry gets sourced
elsewhere (OpenStreetMap carries subway route relations) or the hint becomes something else.
Worth settling before that feature is scheduled, since it changes what is being built.

**Share line switched from mean to median (2026-08-19).** Distances across five rounds are
wildly skewed -- four good guesses and one in the wrong borough is a common shape -- and the
mean let that single round define the line. A strong game printed `855/1000` next to `avg 9.9
blocks off`, two numbers telling opposite stories about the same play. The median reports the
game the player actually had. The line is what people quote at each other, so it should not
contradict the score sitting above it.

---

## 12. M5 — mobile hardening (2026-08-19)

**Careful mode.** Press and hold to commit; release early and nothing is placed. Off by
default, because a tap that commits is the core of the game and making everyone hold to solve
a problem only some players have is the wrong trade. 800ms default, with 1.5s and 3s offered
-- not 3s by default, since three seconds times five rounds times every day is a chore, and a
standard long-press is about 500ms, so 800 already reads as deliberate.

Drifting more than 12px cancels the hold: on a phone that is a pan, not a placement.

*Bug found by browser test:* the MapLibre `click` path was left unguarded, so a plain tap
still committed while careful mode was on -- the hold-to-place guarantee was worthless and
looked fine in code review. Careful mode now suppresses that path entirely.

**Settings reachable during play**, not only from the landing screen. A player who realises on
round 1 that they need careful mode would otherwise be locked out of it for the rest of the
game, which is precisely the person the setting exists for.

**Colourblind squares are a different encoding, not a recoloured palette.** Green / yellow /
orange is exactly the axis red-green colourblindness collapses, so swapping hues would leave
three of the four bands indistinguishable to the people the setting is for. The alternative
set varies *fill* -- `○ ◔ ◕ ●` -- which survives being seen in greyscale.

**Verified at 380px with touch emulation:** no horizontal overflow, `touch-action: none` in
force, hold ring draws, early release cancels, full hold commits.

**Verified on device (2026-08-19).** 800ms hold, 12px drift cancel and `clickTolerance: 10` all
confirmed on real hardware, with no iOS callout on long-press over the map. The spec required
these be tuned on a phone rather than in a desktop browser; they were, and none needed
changing. Chrome's touch emulation reproduces neither the callout behaviour nor thumb
imprecision, so this could not have been signed off from the harness.

That closes the last open item in M0–M5. Everything the spec listed for Phase 1 is built and
verified except content volume, which is deliberately deferred to deploy.

---

## 13. Deployment (2026-08-19)

**Vercel.** The app is static -- a ~330KB gzipped bundle, with map tiles served by DoITT and
Esri rather than by us -- so a CDN is both cheaper and more scalable than compute. Vercel's
free tier includes 100GB transfer, roughly 300,000 cold loads a month, and a daily game where
most players return to a warm cache stays well inside that.

Fly.io was considered and is the wrong shape *for the frontend*: it runs machines, so it would
mean paying for idle compute to serve files, and hand-rolling multi-region deployment for what
a CDN does by default. Its bandwidth is genuinely cheaper (\$0.02/GB against Vercel's
\$0.15/GB over the free allowance), but the crossover is far past where this will be for a
long time.

**Where Fly does belong is the Phase 3 backend** -- beta codes, custom quizzes, telemetry
flush and accounts -- alongside the Fly Postgres already running for other projects. Static
frontend on the CDN, API on Fly.

`npm run build` runs `puzzles:build` first, so Vercel regenerates `public/puzzles/` at deploy
time. That directory is gitignored deliberately: the encoded puzzles are build output, not
source.

**The real scaling risk is not the host, it is the tiles.** Every player pulls dozens of tiles
per round from `maps.nyc.gov` and `server.arcgisonline.com`, which costs us nothing and is
exactly why it is fragile. Esri's World Imagery endpoint is intended for ArcGIS use, and heavy
anonymous traffic is plausibly outside its terms and trivially throttled; NYC's service is a
public city resource that would also notice. If this gets popular, what breaks is a third
party cutting us off, not a hosting bill -- and mitigating it means caching tiles ourselves,
which *is* a compute workload and where Fly would earn its place. Check Esri's terms before
launch rather than after.

### Development serves the queue, not the calendar

`loadTodaysPuzzle` returns the head of the authored queue in development and the real New York
date in production. Without it the app shows "no puzzle yet" from the day after the last
authored day, which during a content pause is every day.

`import.meta.env.DEV` is replaced at build time, so the branch is absent from the shipped
bundle -- verified by grepping the built output for the manifest URL. Production cannot
silently drift onto queue-head behaviour.

The build now emits `public/puzzles/index.json`, the authored dates earliest first. Phase 2's
archive and past-days play want the same list.

*Consequence worth knowing:* all storage keys off the puzzle's own `date`, never the date
requested, or a development session writes progress and streaks under a day it is not playing.

---

## 14. Tile performance and caching — to investigate

Measured 2026-08-20, one full five-round game on a 390px viewport:

| | requests | bytes | notes |
|---|---|---|---|
| DoITT city | 89 | 3.16 MB | **22 are 404s** — a quarter of them |
| Esri world | 71 | 1.21 MB | drawn *underneath* the city layer |
| **total** | **160** | **4.38 MB** | 18 tiles / 0.49 MB just to reach the standard framing |

Two problems are already visible in that table, before any deeper investigation.

**A quarter of city-layer requests are 404s.** DoITT stops at the city line, but the source has
no `bounds`, so MapLibre requests tiles for water and New Jersey and gets nothing back. Raster
sources accept a `bounds` field; setting it to the NYC extent should remove those outright.

**Esri is fetched at full detail underneath an opaque layer.** It exists to fill the surround
outside the city, which only shows at wide framings — yet it is fetched at every zoom,
including z18 inside Manhattan where the city layer covers it completely. Capping the Esri
source's `maxzoom` low and letting MapLibre overzoom those tiles for the background should
remove most of that 1.21 MB without any visible change.

**Then caching, which is the larger win.** Nothing is cached between sessions today, so a
daily player re-downloads the standard framing every single day. A service worker over the
Cache API would make the opening view instant on day two and cut repeat load substantially.
Worth checking third-party cache headers first — a proxy would be needed to set our own TTLs,
which is the same infrastructure as the tile-proxy option below.

**Why this is not just a nicety.** 4.38 MB per game is real on mobile data, and it is entirely
third-party: at 100,000 daily players that is roughly 440 GB a day landing on NYC's public
service and Esri's free endpoint. The terms question raised in section 13 is a good deal
sharper with that number attached — this is the volume that gets an anonymous client
throttled or blocked, and no amount of hosting spend prevents it. Reducing tile count is
therefore a dependency-risk mitigation first and a performance win second.

**Investigate in this order,** cheapest and most certain first: source `bounds` to kill the
404s; Esri `maxzoom` to stop fetching hidden detail; 512px tiles where a service offers them,
halving request count; prefetching the standard framing at boot so round one is instant; then
a service worker for cross-session caching; and only then a tile proxy, which buys TTL
control and insulation from a third-party cutoff but is the first thing here that needs a
server.

*Measure after each, not before.* The table above is the baseline to beat, and it is cheap to
regenerate.

### Applied 2026-08-20

Both quick wins done, measured before and after on the same imagery variant so the numbers
are comparable.

| | before | after |
|---|---|---|
| requests per game | 160 | **126** |
| city-layer 404s | 22 | **0** |
| Esri requests | 71 | 56 |

**Source `bounds` and `minzoom` killed every 404.** All 22 were outside the NYC box at zooms 1
to 11 -- MapLibre walking the pyramid upward hunting a parent tile to display while the real
one loaded, and getting nothing back each time because the city surveys start and stop at the
city line. Coverage is a property of the service, so it now lives on the source rather than
being left implicit.

**Esri capped at z13.** Its whole job is filling the surround outside the city, which is only
on screen at the wide end-of-game framing. From z14 up the player is inside the boroughs
looking at a building, where the city survey is opaque over it -- so every Esri tile fetched
there was bytes nobody could see. Verified at z18 over Katz's: Esri now stops at exactly 13
while the city layer still delivers native z18 detail, on both variants, with zero failures.

*Two measurement traps worth remembering.* Byte totals move several percent run to run purely
from where the automated player happens to tap, so request count is the stabler signal.
And the imagery A/B assigns a variant per browser profile, so any run that does not pin
`nycmap:imagery` is silently measuring whichever survey it drew -- one run reported no city
tiles at all simply because it had been given the variant the matcher did not recognise.

*Understated on purpose:* the scripted player never zooms past about z15, so the Esri saving
in that table is a floor. Real play spends its time at z16-18 hunting storefronts, and every
one of those Esri tiles used to be fetched and hidden.

Still open from this section: 512px tiles, prefetching the standard framing, the service
worker for cross-session caching, and a tile proxy.

---

## 15. Imagery licensing — checked 2026-08-20

**Both city surveys are official City of New York services.** `NYC_Orthos_2024` is hosted by
the `NYCmaps` ArcGIS organisation and credited to NYC OTI, DoITT's successor. Public
government imagery, attribution required, no obstacle.

**Attribution was wrong and is now fixed.** We credited Maxar; Esri's own `copyrightText` reads
Vantor. The city layers said DoITT rather than NYC OTI. Both corrected -- that was the only
clear defect the review turned up.

**Esri World Imagery sits under the Esri Master License Agreement.** No grant could be found
covering anonymous use of `server.arcgisonline.com` from a non-ArcGIS application. That is
absence of permission rather than prohibition, and the realistic exposure is operational --
an unannounced throttle or block -- rather than legal.

**Decision: keep it.** The alternatives were worse on inspection:

| option | why not |
|---|---|
| Sentinel-2 cloudless (EOX) | CC BY-**NC**-SA for 2018–2025 data, not CC BY. Explicitly excludes commercial use, so it is a firmer bar than Esri's silence for anything that might monetise later |
| ArcGIS API key | Clean terms, but meters basemap requests and would exceed the free tier at section 14 volumes |
| NASA public-domain imagery | ~500 m/px, far too coarse at the recap framing |

There is no free-for-commercial global satellite basemap at this quality. Raw Copernicus
Sentinel data is openly licensed but would need mosaicking ourselves, which is exactly the
work EOX sells.

**One clause to carry into section 14.** The World Imagery item states: *"This layer is not
intended to be used to export tiles for offline."* A service worker caching Esri tiles across
sessions is arguably the thing that forbids. The city layers carry no such restriction, so
cross-session caching should be scoped to those and the Esri layer left uncached.

**Escape hatch, already costed.** If Esri ever throttles or the licence question becomes
pressing, the fix is to drop it from normal play and paint the surround a flat colour, keeping
Esri only as the fallback when city imagery is unreachable. That removes roughly 44% of
remaining tile requests as a side effect, and arguably reads better -- flat colour states the
play boundary, where satellite imagery invites players to study somewhere they cannot be
scored. Roughly an hour's work if it is ever needed.

---

## 16. Content pipeline (2026-08-20)

Authoring moved from hand-written `puzzles/*.json` to `content/days.json` plus
`scripts/author.mjs`. Three stages, and only the middle one is committed:

    content/days.json  --author.mjs-->  puzzles/*.json  --puzzles:build-->  public/puzzles/
    (source, no coords)   (network)      (committed)       (deploy)          (gitignored)

`author.mjs` needs Nominatim, so it cannot run on a deploy host -- which is why `puzzles/`
stays in the repository rather than being generated at build time.

**Authors never type coordinates.** Each location carries a `query` that is geocoded and
cached back into the source. Across 250 locations, hand-entered latitudes are a guarantee of
silent errors, and a wrong coordinate does not look wrong -- it just marks correct answers
wrong. Two of the first fifteen queries failed outright and a third would have needed
checking, which is three errors that would otherwise have shipped.

The script also enforces the content rules before writing anything: five locations a day,
difficulty climbing, at least two outside Manhattan, coordinates inside the map's bounds,
valid class and borough, three or more tags, a fact of reasonable length, a source, and no
location repeated across the whole run. It prints the borough mix so drift is visible.
