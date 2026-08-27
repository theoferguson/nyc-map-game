# NYC Daily Map Game

A daily browser game in the Wordle family. Five significant New York locations are named;
you find each one on unlabelled satellite imagery and tap it. Scoring is by proximity,
feedback is immediate, and the day ends with every answer on the map at once.

**Play it: https://nyc-map-game.vercel.app**

No accounts, no backend, no database. Static files and `localStorage`.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

| script | what it does |
|---|---|
| `npm run dev` | dev server (builds puzzles first) |
| `npm run build` | typecheck, build puzzles, bundle |
| `npm test` | unit tests |
| `npm run check:tiles` | asserts every imagery endpoint still serves real tiles |
| `npm run check:health` | asserts today plays, the gate holds, and content has not run out |
| `npm run check:db` | round-trips an event and a config through the API; needs `DATABASE_URL` |
| `npm run puzzles:push` | uploads `puzzles/` to the database; needs `DATABASE_URL` |
| `npm run puzzles:pull` | brings database edits back into `puzzles/` and `content/` |

`check:health` runs daily in Actions alongside `check:tiles`. It checks the deployed site
rather than the database — no credential in CI, and it tests what players actually reach.
Set `ADMIN_TOKEN` as a repository secret to enable the content-runway and traffic checks.

`check:tiles` is worth running on a schedule. The imagery services are third-party and
break silently — NYC dropped every survey after 2018 from one host without notice, and a
dead endpoint takes the whole game with it.

## Telemetry

Anonymous play data — scores, distances, which places are too hard — is buffered locally and
flushed to `POST /api/events` only after the player opts in. Saying no records nothing and
deletes the device's anonymous id. There is no account, no ad network and no third party;
country and city come from Vercel's edge headers, and the IP itself is never stored.

The endpoint answers 503 until `DATABASE_URL` is set, and the client retries 5xx, so events
buffer safely before the database exists. To provision:

```
# Vercel dashboard → Storage → Postgres, which sets DATABASE_URL
psql "$DATABASE_URL" -f api/schema.sql
DATABASE_URL=... npm run check:db
```

## Content

Authored content is **not in this repo**. `content/` and `puzzles/` are gitignored, and the
days live in the database, served one at a time through `GET /api/puzzle?date=…`. That
endpoint refuses any date after today in New York unless a valid beta code is presented, so a
future puzzle cannot be read by guessing a URL.

Authoring is unchanged — edit `content/days.json`, run `node scripts/author.mjs` — but
publishing is now `npm run puzzles:push` rather than a commit.

The date-keyed XOR on the payload is a speed bump against devtools, not protection. Today's
answers necessarily reach the browser, because scoring happens there.

## Admin panel

`/?admin` — traffic, scoring curve, beta code, and a full content editor: every field of every
location on any authored day, with a map so a pin can be reviewed rather than a coordinate.

**The panel edits the database directly.** After editing, run `npm run puzzles:pull` before the
next `puzzles:push`, or the push overwrites the edit with whatever is on disk. Writes are
guarded by `ADMIN_TOKEN`; the URL is not a secret and is not meant to be one. Every client
reads `GET /api/config` at boot and falls back to the last cached config, then to the values
compiled into the build, so a slow or missing endpoint never stops a game starting.

## Imagery

Satellite only. **No label layer is ever loaded** — labels are the answers. Zoom is capped
at z18, past which painted rooftop signage starts to become legible.

Two city surveys are served 50/50 and sticky per browser, as an experiment in whether
fresher imagery makes restaurant and bar rounds fairer:

- NYC DoITT aerial survey, 2018
- NYC orthoimagery, 2024

Esri World Imagery draws underneath both, because the city surveys stop at the city line.
The survey in use is named in the bottom-left corner.

## Puzzle content

Days are authored as plain JSON in `puzzles/` and encoded into `public/puzzles/` at build
time. Each location carries coordinates, a class (`area` / `landmark` / `venue`) that sets
its scoring curve, tags, a short fact and a source.

**The answers are in the client, and the obfuscation is not security.** Coordinates are
XOR'd against the puzzle date and base64'd, which stops casual devtools peeking and nothing
more — the decoder is `src/data/loadPuzzle.ts`, right here in the open. Wordle shipped its
entire word list and survived; this is the same bet.

## Layout

```
src/game/     scoring curve, miss copy, share string, telemetry
src/map/      MapLibre setup, imagery sources, recap card placement
src/data/     puzzle schema, loading, decoding
puzzles/      authored days (plain)
scripts/      puzzle encoder, imagery health check
PLAN.md       milestones, decisions and why they were made
```

`PLAN.md` is the interesting file. It records where the original spec turned out to be
wrong and what replaced it.

## Privacy

Gameplay events buffer in `localStorage` and **nothing is transmitted** — there is no
backend to transmit to. No accounts, no contact details, no device geolocation, no IP. The
only coordinates recorded are the ones a player deliberately taps inside the game.

## Licence

Code is MIT (see `LICENSE`).

Location facts are rewritten from Wikipedia, which is CC BY-SA 4.0. Derived text carries
the same terms, so **the contents of `puzzles/` are CC BY-SA 4.0**, with per-location
attribution in each entry's `sourceAttribution` field.

Map imagery belongs to its providers and is attributed in-app; it is not covered by either
licence here.
