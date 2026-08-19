import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapHandle, type Overlay } from './map/MapView'
import { loadPuzzle, type Puzzle, type PuzzleLocation } from './data/loadPuzzle'
import { haversine, roundScore, describeMiss, type LngLat } from './game/scoring'
import { MULTIPLIERS, MAX_TOTAL, totalScore, shareString } from './game/share'

type Result = { guess: LngLat; distanceM: number; score: number; copy: string }

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [current, setCurrent] = useState<Result | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const map = useRef<MapHandle>(null)

  // M4 replaces this with the America/New_York puzzle date.
  useEffect(() => {
    loadPuzzle('2026-08-19').then(setPuzzle).catch((e) => setError(String(e)))
  }, [])

  const over = !!puzzle && round >= puzzle.locations.length

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

  const location = puzzle.locations[round]

  function place(guess: LngLat) {
    // The reveal is showing; taps must not overwrite a committed answer.
    if (current || over) return
    const answer = { lng: location.lng, lat: location.lat }
    const distanceM = haversine(guess, answer)

    setCurrent({
      guess,
      distanceM,
      score: roundScore(distanceM, location.class),
      copy: describeMiss(guess, answer),
    })
    map.current?.revealAnswer(guess, answer)
  }

  function next() {
    const finished = [...results, current!]
    setResults(finished)
    setCurrent(null)
    map.current?.clearPins()
    setRound((r) => r + 1)

    // Two camera moves at once would fight; the recap framing supersedes the
    // reset, so on the last round only one of them runs.
    if (finished.length === puzzle!.locations.length) {
      map.current?.showAllAnswers(
        puzzle!.locations.map((l) => ({ lng: l.lng, lat: l.lat })),
      )
    } else {
      map.current?.resetCamera()
    }
  }

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <MapView
        ref={map}
        onPlace={place}
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

      {over && <Results puzzle={puzzle} results={results} />}
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
    <div className="w-full rounded-lg bg-neutral-900/92 p-2.5 text-left text-white shadow-xl ring-1 ring-white/15 backdrop-blur">
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

function Results({ puzzle, results }: { puzzle: Puzzle; results: Result[] }) {
  const [copied, setCopied] = useState(false)
  const total = totalScore(results)
  const text = shareString(puzzle.puzzleNumber, results)

  async function share() {
    if (navigator.share) {
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
          Tap any card on the map to read more.
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
