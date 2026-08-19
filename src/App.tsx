import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapHandle, type Overlay } from './map/MapView'
import { loadPuzzle, type Puzzle, type PuzzleLocation } from './data/loadPuzzle'
import { haversine, roundScore, describeMiss, type LngLat } from './game/scoring'
import { MULTIPLIERS, MAX_TOTAL, totalScore, shareString } from './game/share'
import { track } from './game/telemetry'
import { imageryVariant } from './map/tiles'
import { puzzleDate, msUntilRollover, formatCountdown } from './game/date'
import { loadProgress, saveProgress, recordGame, loadStats, type Stats } from './game/storage'

type Result = { guess: LngLat; distanceM: number; score: number; copy: string }

/**
 * The one place a guess becomes a result. Resume replays saved taps through
 * this, so a restored game and a live one cannot drift apart.
 */
function scoreGuess(guess: LngLat, location: PuzzleLocation): Result {
  const answer = { lng: location.lng, lat: location.lat }
  const distanceM = haversine(guess, answer)
  return {
    guess,
    distanceM,
    score: roundScore(distanceM, location.class),
    copy: describeMiss(guess, answer),
  }
}

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [started, setStarted] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [stats, setStats] = useState<Stats>(loadStats)
  const today = puzzleDate()
  const [current, setCurrent] = useState<Result | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const map = useRef<MapHandle>(null)
  // Time-to-guess is the clearest signal of whether a round is fun-hard or
  // unfair-hard, and it cannot be reconstructed after the fact.
  const roundStarted = useRef(0)
  const gameStarted = useRef(0)

  useEffect(() => {
    loadPuzzle(today)
      .then((p) => {
        setPuzzle(p)
        gameStarted.current = Date.now()
        roundStarted.current = Date.now()

        // Replay the saved taps through the live scoring rules rather than
        // restoring stored numbers, so a resumed game and a fresh one can never
        // disagree about what a guess was worth.
        const saved = loadProgress(today)
        if (saved) {
          const replayed = saved.guesses.map((guess, i) => scoreGuess(guess, p.locations[i]))
          setResults(replayed)
          setRound(replayed.length)
          track('game_resumed', { round: replayed.length + 1, date: today })
          // Deliberately not skipping the landing: a player who refreshes wants
          // to be told their progress survived, not dropped back onto the map
          // wondering. A finished game bypasses it anyway, via `over`.
        } else {
          track('game_start', {
            puzzleNumber: p.puzzleNumber,
            date: p.date,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
          })
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [today])

  const over = !!puzzle && round >= puzzle.locations.length
  // One path into the recap, whether the fifth round just ended or the page was
  // reloaded on a finished game. Running it from `next` as well would add a
  // second set of pins over the first.
  const recapShown = useRef(false)
  useEffect(() => {
    // `mapReady` is load-bearing on a reload into a finished game: the map is
    // built behind an async tile probe, so without it this fires first and the
    // answer pins are silently never added.
    if (!puzzle || !over || !mapReady || recapShown.current) return
    recapShown.current = true
    setStats(recordGame(today, totalScore(results)))
    map.current?.showAllAnswers(puzzle.locations.map((l) => ({ lng: l.lng, lat: l.lat })))
  }, [puzzle, over, mapReady, results, today])

  // Every answer, each card pinned to its own location, all at once.
  const overlays = useMemo<Overlay[]>(() => {
    if (!over || !puzzle) return []
    return puzzle.locations.map((loc, i) => ({
      id: loc.id,
      lngLat: { lng: loc.lng, lat: loc.lat },
      content: <FactCard location={loc} result={results[i]} index={i} />,
    }))
  }, [over, puzzle, results])

  if (error) return <Centered>{error}</Centered>
  if (!puzzle) return <Centered>Loading…</Centered>

  if (!started && !over) {
    return (
      <Landing
        puzzle={puzzle}
        stats={stats}
        resuming={results.length > 0}
        onPlay={() => {
          setStarted(true)
          roundStarted.current = Date.now()
          gameStarted.current = Date.now()
        }}
      />
    )
  }

  const location = puzzle.locations[round]

  function place(guess: LngLat) {
    // The reveal is showing; taps must not overwrite a committed answer.
    if (current || over) return
    const answer = { lng: location.lng, lat: location.lat }
    const { distanceM, score } = scoreGuess(guess, location)
    setCurrent(scoreGuess(guess, location))
    map.current?.revealAnswer(guess, answer)

    // Written on commit, not on Next. A refresh during the reveal must not cost
    // the player the round they have already played.
    saveProgress(today, { guesses: [...results.map((r) => r.guess), guess] })

    track('round_complete', {
      round: round + 1,
      locationId: location.id,
      class: location.class,
      borough: location.borough,
      difficulty: location.difficulty,
      tags: location.tags,
      distanceM: Math.round(distanceM),
      score,
      msToGuess: Date.now() - roundStarted.current,
    })
  }

  function next() {
    const finished = [...results, current!]
    setResults(finished)
    setCurrent(null)
    roundStarted.current = Date.now()
    map.current?.clearPins()
    setRound((r) => r + 1)

    // Two camera moves at once would fight; the recap framing supersedes the
    // reset, so on the last round only one of them runs.
    if (finished.length === puzzle!.locations.length) {
      track('game_complete', {
        puzzleNumber: puzzle!.puzzleNumber,
        total: totalScore(finished),
        scores: finished.map((r) => r.score),
        avgDistanceM: Math.round(
          finished.reduce((sum, r) => sum + r.distanceM, 0) / finished.length,
        ),
        durationMs: Date.now() - gameStarted.current,
      })
    } else {
      map.current?.resetCamera()
    }
  }

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <MapView
        ref={map}
        onPlace={place}
        onReady={() => setMapReady(true)}
        enabled={!current && !over}
        overlays={overlays}
      />

      {!over && (
        <Floating className="top-3">
          {/* No controls in here, so let map drags pass straight through it. */}
          <div className="pointer-events-none flex items-center justify-between gap-3 rounded-2xl bg-neutral-900/90 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-neutral-400">Find</p>
              <h1 className="truncate text-lg font-semibold leading-tight">
                {location.prompt}
              </h1>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-neutral-400">
              {round + 1}/{puzzle.locations.length}
            </p>
          </div>
        </Floating>
      )}

      {current && (
        <Floating className="bottom-3">
          <div className="space-y-4 rounded-2xl bg-neutral-900/90 p-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-lg font-medium">{current.copy}</p>
            <p className="shrink-0 text-2xl font-semibold tabular-nums">
              {current.score}
              {MULTIPLIERS[round] > 1 && (
                <span className="ml-1 text-sm font-normal text-amber-400">
                  ×{MULTIPLIERS[round]}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={next}
            className="w-full rounded-xl bg-white py-3 font-semibold text-neutral-900 active:bg-neutral-200"
          >
            Next
          </button>
          </div>
        </Floating>
      )}

      {over && <Results puzzle={puzzle} results={results} stats={stats} />}

      <p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-neutral-900/75 px-2.5 py-1 text-[10px] font-medium tracking-wide text-neutral-300">
        {imageryVariant().label}
      </p>
    </div>
  )
}

/**
 * Pinned beside its answer, all five readable at once. Deliberately inert: the
 * recap is read, not operated, and making five cards interactive turned them
 * into a wall that swallowed every attempt to pan the map behind them.
 */
function FactCard({
  location,
  result,
  index,
}: {
  location: PuzzleLocation
  result?: Result
  index: number
}) {
  return (
    // Opaque rather than blurred on purpose: a backdrop-filter over satellite
    // imagery is repainted on every frame the card moves, and five of them made
    // panning the recap unusable.
    <div className="w-full rounded-lg bg-neutral-900 p-2.5 text-left text-white shadow-xl ring-1 ring-white/15">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold tabular-nums text-neutral-500">
          {index + 1}
        </span>
        <span className="flex-1 text-xs font-semibold leading-tight">{location.name}</span>
        <span className="text-xs font-semibold tabular-nums text-amber-400">
          {result?.score ?? 0}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] leading-tight text-neutral-400">{result?.copy}</p>
      <p className="mt-1.5 text-[11px] leading-snug text-neutral-200">
        {location.factShort}
      </p>
      <p className="mt-1 text-[9px] text-neutral-500">{location.sourceAttribution}</p>
    </div>
  )
}

/** Ticks once a second, but only where a countdown is actually on screen. */
function useCountdown(): string {
  const [ms, setMs] = useState(msUntilRollover)
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilRollover()), 1000)
    return () => clearInterval(id)
  }, [])
  return formatCountdown(ms)
}

function Landing({
  puzzle,
  stats,
  resuming,
  onPlay,
}: {
  puzzle: Puzzle
  stats: Stats
  resuming: boolean
  onPlay: () => void
}) {
  const countdown = useCountdown()
  return (
    <Centered>
      <div className="w-full max-w-xs space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">NYC Daily</h1>
          <p className="mt-1 text-sm text-neutral-400">
            #{puzzle.puzzleNumber} · {puzzle.date}
          </p>
        </div>

        <p className="text-sm leading-relaxed text-neutral-300">
          Five New York places. Find each one on the map and tap it. No labels, no
          search — just how well you know the city.
        </p>

        <button
          onClick={onPlay}
          className="w-full rounded-xl bg-white py-3 font-semibold text-neutral-900 active:bg-neutral-200"
        >
          {resuming ? 'Resume' : 'Play'}
        </button>

        {stats.played > 0 && (
          <p className="text-xs text-neutral-500">
            {stats.played} played · {stats.streak} day streak · best{' '}
            {stats.maxStreak}
          </p>
        )}
        <p className="text-xs text-neutral-600">Next puzzle in {countdown}</p>
      </div>
    </Centered>
  )
}

function Results({
  puzzle,
  results,
  stats,
}: {
  puzzle: Puzzle
  results: Result[]
  stats: Stats
}) {
  const [copied, setCopied] = useState(false)
  const countdown = useCountdown()
  const total = totalScore(results)
  const text = shareString(puzzle.puzzleNumber, results)

  async function share() {
    track('share', {
      method: typeof navigator.share === 'function' ? 'web_share' : 'clipboard',
      total,
      puzzleNumber: puzzle.puzzleNumber,
    })
    if (typeof navigator.share === 'function') {
      await navigator.share({ text }).catch(() => {})
      return
    }
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Floating className="bottom-3">
      <div className="space-y-3 rounded-2xl bg-neutral-900/90 p-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-neutral-400">NYC Daily #{puzzle.puzzleNumber}</p>
          <p className="text-3xl font-semibold tabular-nums">
            {total}
            <span className="text-base font-normal text-neutral-500">/{MAX_TOTAL}</span>
          </p>
        </div>
        <p className="text-2xl tracking-wide">
          {text.split('\n')[1]}
        </p>
        <p className="text-sm text-neutral-400">{text.split('\n')[2]}</p>
        <button
          onClick={share}
          className="w-full rounded-xl bg-white py-3 font-semibold text-neutral-900 active:bg-neutral-200"
        >
          {copied ? 'Copied' : 'Share'}
        </button>
        <p className="text-center text-xs text-neutral-500">
          {stats.streak > 1 && `${stats.streak} day streak · `}Next puzzle in {countdown}
        </p>
      </div>
    </Floating>
  )
}

/**
 * Every panel floats over the imagery rather than docking to a screen edge, so
 * the map stays the whole surface and nothing reads as chrome. Insets clear the
 * iOS notch and home indicator.
 */
function Floating({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-3 z-10 mx-auto max-w-md ${className}`}
      style={{
        marginBottom: 'env(safe-area-inset-bottom)',
        marginTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="pointer-events-auto">{children}</div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-900 p-8 text-center text-white">
      {children}
    </div>
  )
}
