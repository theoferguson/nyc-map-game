# Architecture

A map for someone reading this codebase for the first time. `PLAN.md` records *why* almost
every decision was made, in the order it happened; this is *what exists and how it fits*.

## The shape of it

A React SPA on Vercel, with serverless functions in `api/` and one Postgres database.
There is no backend framework and no server-side rendering.

```
browser                     Vercel functions            Postgres
────────                    ─────────────────           ────────
src/App.tsx  ─ game state
  │
  ├─ GET  /api/puzzle  ───▶  api/puzzle.ts   ────────▶  puzzles     one day, date-gated
  ├─ GET  /api/config  ───▶  api/config.ts   ────────▶  config      scoring, beta, overrides
  ├─ POST /api/beta    ───▶  api/beta.ts     ────────▶  config      is this code right?
  ├─ POST /api/events  ───▶  api/events.ts   ────────▶  events      opt-in telemetry
  ├─ POST /api/tally   ───▶  api/tally.ts    ────────▶  tallies     consent-free counters
  │
src/admin/AdminPanel.tsx
  ├─ POST /api/admin   ───▶  api/admin.ts    ────────▶  config, puzzles
  └─ POST /api/stats   ───▶  api/stats.ts    ────────▶  tallies, events
```

## Where things live

| path | what it holds |
|---|---|
| `src/App.tsx` | the game state machine, and nothing else |
| `src/screens/` | `Landing`, `Results`, `SettingsPanel` — one screen each |
| `src/ui/` | `Floating`, `Centered` — layout primitives shared by screens |
| `src/map/` | MapLibre setup, imagery sources, the A/B assignment |
| `src/game/` | rules and device state: scoring, dates, storage, telemetry, config |
| `src/data/` | puzzle loading, the codec, day validation |
| `src/admin/` | the operator panel, reachable at `/?admin` |
| `api/` | one file per route; `_`-prefixed files are shared, not routes |
| `scripts/` | authoring, publishing, and the two alarms |
| `tests/` | tests for `api/` — see below |

## Things that will bite you

**Every file in `api/` becomes a public route**, named after the file. `api/_db.ts` does not,
because Vercel skips underscore-prefixed files — which is why shared server code lives there and
why endpoint tests live in `tests/` instead. A stray `api/helper.ts` is a public endpoint.

**Functions are compiled, not bundled.** Import specifiers are emitted verbatim, so a relative
import must be written `./_db.js` even though the file is `_db.ts`. Getting this wrong passes
`tsc`, passes `vercel build`, works under `vercel dev`, and fails only in production.
`tests/build-output.test.ts` guards it.

**Content is not in this repo.** `content/` and `puzzles/` are gitignored; days live in the
`puzzles` table and are served one at a time behind a date gate. The exception is
`content/sample.json`, invented placeholder content so a clone runs with no database.

**The admin panel writes to the database directly.** Run `npm run puzzles:pull` before the next
`puzzles:push`, or the push overwrites the edit.

**`jsonb` parameters must be cast through text** (`${JSON.stringify(x)}::text::jsonb`). Passed
straight to `::jsonb`, the driver stores a JSON *string*, every `->>` returns null, and nothing
errors. It has happened twice; `npm run check:db` now catches it.

**Scoring is versioned.** `round_complete` carries `configVersion`, because retuning lambda
would otherwise make yesterday's scores and today's silently incomparable.

## Four TypeScript projects

Each has a different lib and types, which is why there are four rather than one.

| config | covers | why separate |
|---|---|---|
| `tsconfig.app.json` | `src/`, minus tests | DOM types, bundler resolution |
| `tsconfig.node.json` | `vite.config.ts`, the dev plugin | node types, build tooling |
| `api/tsconfig.json` | `api/` | node types, `nodenext` resolution |
| `tsconfig.test.json` | every test, wherever it lives | needs DOM *and* node |

## Where tests go

Unit tests sit beside what they test, as `src/**/*.test.ts`. Tests for the serverless functions
live in `tests/`, because a `.test.ts` file inside `api/` would be published as a route.

Both are typechecked by `tsconfig.test.json`. That was not always true, and the six tests that
went unchecked are how an untyped parameter and a broken import both survived.

## Running it

See `README.md`. The short version: `npm run dev` works with no database and no credentials,
serving `content/sample.json`.
