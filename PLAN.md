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

**Before this can answer anything, decide the success metric.** The hypothesis is that fresher
imagery makes `venue` rounds fairer, so the candidate measures are venue-round score,
time-to-guess on venue rounds, and abandonment before round 5. Pick one as primary before
looking at the data, or the result is whatever the first slice happens to say.

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
