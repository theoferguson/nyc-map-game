import { useEffect, useRef, useState } from 'react'
import { MapView, type MapHandle } from './map/MapView'
import { loadPuzzle, type Puzzle } from './data/loadPuzzle'
import { haversine, roundScore, describeMiss, type LngLat } from './game/scoring'

type Result = { guess: LngLat; distanceM: number; score: number; copy: string }

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const map = useRef<MapHandle>(null)

  // M4 replaces this with the America/New_York puzzle date.
  useEffect(() => {
    loadPuzzle('2026-08-19').then(setPuzzle).catch((e) => setError(String(e)))
  }, [])

  if (error) return <Centered>{error}</Centered>
  if (!puzzle) return <Centered>Loading…</Centered>

  const location = puzzle.locations[round]
  const done = round >= puzzle.locations.length

  function place(guess: LngLat) {
    // The reveal is showing; taps must not overwrite a committed answer.
    if (result || done) return
    const answer = { lng: location.lng, lat: location.lat }
    const distanceM = haversine(guess, answer)

    setResult({
      guess,
      distanceM,
      score: roundScore(distanceM, location.class),
      copy: describeMiss(guess, answer),
    })
    map.current?.showGuess(guess)
    map.current?.revealAnswer(guess, answer)
  }

  function next() {
    map.current?.clearPins()
    map.current?.resetCamera()
    setResult(null)
    setRound((r) => r + 1)
  }

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <MapView ref={map} onPlace={place} />

      {done ? (
        <Centered>
          <p className="text-lg">That is all five.</p>
          <p className="mt-2 text-sm text-neutral-400">
            Scoring multipliers, the results screen and the share string land in M3.
          </p>
        </Centered>
      ) : (
        <>
          <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 pb-10 text-white">
            <div>
              <p className="text-xs uppercase tracking-widest text-neutral-300">
                Find
              </p>
              <h1 className="text-xl font-semibold leading-tight">
                {location.prompt}
              </h1>
            </div>
            <p className="shrink-0 pt-4 text-sm tabular-nums text-neutral-300">
              {round + 1}/{puzzle.locations.length}
            </p>
          </header>

          {result && (
            <div className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-neutral-900/95 p-5 text-white shadow-2xl backdrop-blur">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-lg font-medium">{result.copy}</p>
                <p className="shrink-0 text-2xl font-semibold tabular-nums">
                  {result.score}
                </p>
              </div>

              <p className="text-sm leading-relaxed text-neutral-300">
                <span className="font-medium text-white">{location.name}.</span>{' '}
                {location.factShort}
              </p>

              <button
                onClick={next}
                className="w-full rounded-xl bg-white py-3 font-semibold text-neutral-900 active:bg-neutral-200"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
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
