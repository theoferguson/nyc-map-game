import { useEffect, useRef, useState } from 'react'
import { MapView, type MapHandle } from './map/MapView'
import { loadPuzzle, puzzleQueue, layoutOf, type Puzzle } from './data/loadPuzzle'
import type { LngLat } from './game/scoring'
import { scoreGuess, type Result } from './game/round'
import { MULTIPLIERS, totalScore } from './game/share'
import { track, flush, consent, setConsent, type Consent } from './game/telemetry'
import { loadConfig, config, configVersion, verifyBetaCode, tallyComplete } from './game/api'
import { setScoring } from './game/scoring'
import { Landing } from './screens/Landing'
import { Results } from './screens/Results'
import { SettingsPanel } from './screens/SettingsPanel'
import { Centered } from './ui/Centered'
import { Floating } from './ui/Floating'
import { imageryVariant } from './map/tiles'
import { puzzleDate, shiftDate, daysBetween } from './game/date'
import {
  loadProgress,
  saveProgress,
  recordGame,
  loadStats,
  loadSettings,
  saveSettings,
  betaUnlocked,
  betaCode,
  lockBeta,
  type Stats,
  type Settings,
} from './game/storage'

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [started, setStarted] = useState(false)
  /**
   * Forces the landing screen back up after a finished game.
   *
   * The day picker lives there, so without a way back a tester who enters a
   * beta code from the results panel has unlocked something they cannot reach
   * until tomorrow. A reload into a finished game still goes straight to the
   * recap -- that is `over` doing its job, and this is deliberately a separate
   * flag rather than a change to it.
   */
  const [home, setHome] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  // Null until the config resolves. The whole app waits on it -- see the loader
  // below -- because scoring, the beta code and the day's locations all depend
  // on it, and starting a round on the defaults only to swap curves a moment
  // later would score two rounds of the same game differently.
  const [ready, setReady] = useState(false)
  const [beta, setBeta] = useState(false)
  const [queue, setQueue] = useState<string[]>([])

  /**
   * The day chosen from the beta picker, or null for the ordinary daily game.
   *
   * Any picked day is a beta play and is ephemeral: nothing is saved and
   * nothing is recorded. Progress and stats are keyed by date, so a tester
   * burning five days in a sitting would otherwise manufacture a five-day
   * streak, and the progress pruner -- which deliberately keeps only the
   * current day -- would delete the real game they had in flight.
   */
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const ephemeral = pickedDate !== null

  const [dataConsent, setDataConsent] = useState<Consent>(consent)
  function answerConsent(granted: boolean) {
    setConsent(granted)
    setDataConsent(granted ? 'granted' : 'denied')
    // Send what this session already buffered rather than making them play a
    // second game before anything is learned.
    if (granted) void flush()
  }


  function updateSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    track('settings_changed', patch)
  }
  const [stats, setStats] = useState<Stats>(loadStats)
  // Captured once, deliberately. Recomputed per render, a player crossing New
  // York midnight mid-game would have the loader swap in tomorrow's puzzle while
  // their round, results and current reveal all still referred to today's --
  // saving their guesses under the wrong date and scoring the wrong locations.
  // Rollover is handled explicitly instead, by the countdown, and only when no
  // game is in progress.
  const [today] = useState(puzzleDate)
  const [current, setCurrent] = useState<Result | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const map = useRef<MapHandle>(null)
  // Time-to-guess is the clearest signal of whether a round is fun-hard or
  // unfair-hard, and it cannot be reconstructed after the fact.
  const roundStarted = useRef(0)
  const gameStarted = useRef(0)

  // Whatever last session ended holding. Fire and forget: a failed flush puts
  // the events back, and nothing in the game waits on it.
  useEffect(() => {
    void flush()
  }, [])

  useEffect(() => {
    // Never rejects: it falls back to the cached config, then to the shipped
    // defaults. The game must start even when this endpoint does not answer.
    void loadConfig().then((cfg) => {
      setScoring(cfg.scoring)
      // Optimistic: a stored code counts as unlocked immediately, so a returning
      // tester is not made to wait on a round trip. The check below revokes only
      // on an actual rejection -- a failed request leaves them alone.
      setBeta(betaUnlocked())
      setReady(true)

      const held = betaCode()
      if (held) {
        void verifyBetaCode(held).then((ok) => {
          if (ok === false) {
            lockBeta()
            setBeta(false)
          }
        })
      }
    })
  }, [])

  useEffect(() => {
    if (!beta) return
    // The server decides the window from the code; this only bounds what the
    // picker offers, so a wider server answer cannot silently widen the UI.
    const ahead = config().beta.daysAhead
    puzzleQueue(betaCode()).then((dates) =>
      setQueue(dates.filter((d) => d <= shiftDate(today, ahead))),
    )
  }, [beta, today])

  useEffect(() => {
    if (!ready) return
    // Cached only for the ordinary daily game -- see loadPuzzle. A beta pick is
    // ephemeral and is fetched against a revocable code.
    const load = loadPuzzle(pickedDate ?? today, config().locations, betaCode(), !pickedDate)
    load
      .then((p) => {
        setPuzzle(p)
        gameStarted.current = Date.now()
        roundStarted.current = Date.now()

        // Replay the saved taps through the live scoring rules rather than
        // restoring stored numbers, so a resumed game and a fresh one can never
        // disagree about what a guess was worth. A beta day never resumes:
        // it was never saved, which is also what lets a past day be replayed.
        const saved = pickedDate ? null : loadProgress(p.date, layoutOf(p))
        if (saved) {
          const replayed = saved.guesses
            .slice(0, p.locations.length)
            .map((guess, i) => scoreGuess(guess, p.locations[i]))
          setResults(replayed)
          setRound(replayed.length)
          // Rounds already done, not the round being resumed at: a reload into
          // a finished board has no next round, and `replayed.length + 1`
          // reported round 6 of a five-round game.
          track('game_resumed', { roundsDone: replayed.length, date: p.date })
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
  }, [today, pickedDate, ready])

  const over = !!puzzle && round >= puzzle.locations.length
  // One path into the recap, whether the fifth round just ended or the page was
  // reloaded on a finished game. Running it from `next` as well would add a
  // second set of pins over the first.
  const recorded = useRef(false)
  useEffect(() => {
    if (!puzzle || !over || recorded.current) return
    recorded.current = true
    // A beta play never counts: five days burned in a sitting would fabricate a
    // five-day streak, and maxStreak is permanent.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!pickedDate) setStats(recordGame(puzzle.date, totalScore(results)))
  }, [puzzle, over, results, pickedDate])

  const recapShown = useRef(false)
  useEffect(() => {
    // `mapReady` is load-bearing on a reload into a finished game: the map is
    // built behind an async tile probe, so without it this fires first and the
    // answer pins are silently never added. Kept separate from recording the
    // result, which must not depend on the map coming up at all.
    if (!puzzle || !over || !mapReady || recapShown.current) return
    recapShown.current = true
    map.current?.showAllAnswers(puzzle.locations.map((l) => ({ lng: l.lng, lat: l.lat })))
  }, [puzzle, over, mapReady])

  if (error) return <Centered>{error}</Centered>
  if (!ready || !puzzle) return <Centered>Loading…</Centered>

  if (home || (!started && !over)) {
    return (
      <>
        <Landing
          puzzle={puzzle}
          stats={stats}
          resuming={results.length > 0}
          onPlay={() => {
            // Starting the game is the opt-in the notice beside this button
            // describes. Only from `unset`: a player who turned it off in
            // Settings must not be re-enrolled by pressing Play.
            if (dataConsent === 'unset') answerConsent(true)
            setHome(false)
            setStarted(true)
            roundStarted.current = Date.now()
            gameStarted.current = Date.now()
          }}
          onSettings={() => setShowSettings(true)}
          consent={dataConsent}
          queue={beta ? queue : []}
          picked={pickedDate}
          onPick={(date) => {
            // Landing back on today is the ordinary daily game, not a beta
            // play -- otherwise the picker would offer "Today" and refuse to
            // save it, which reads as a bug rather than a rule.
            // Switching day restarts cleanly: a half-played board belongs to
            // the day it was played on.
            setPickedDate(date === today ? null : date)
            setResults([])
            setRound(0)
            setCurrent(null)
            recorded.current = false
            recapShown.current = false
            map.current?.clearPins()
          }}
        />
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            onClose={() => setShowSettings(false)}
            consent={dataConsent}
            onConsent={answerConsent}
            beta={beta}
            onBeta={(unlocked) => {
              setBeta(unlocked)
              if (!unlocked) setPickedDate(null)
            }}
          />
        )}
      </>
    )
  }

  const location = puzzle.locations[round]
  // The day actually being played, which in development is the head of the
  // queue rather than the calendar date. All storage keys off this.
  const activeDate = puzzle.date

  function place(guess: LngLat) {
    // The reveal is showing; taps must not overwrite a committed answer.
    if (current || over) return
    const answer = { lng: location.lng, lat: location.lat }
    const result = scoreGuess(guess, location)
    const { distanceM, score } = result
    setCurrent(result)
    map.current?.revealAnswer(guess, answer)

    // Written on commit, not on Next. A refresh during the reveal must not cost
    // the player the round they have already played. Beta days are not saved at
    // all -- see `ephemeral`.
    if (!ephemeral) {
      saveProgress(activeDate, {
        guesses: [...results.map((r) => r.guess), guess],
        layout: layoutOf(puzzle!),
      })
    }

    track('round_complete', {
      round: round + 1,
      locationId: location.id,
      class: location.class,
      borough: location.borough,
      difficulty: location.difficulty,
      tags: location.tags,
      configVersion: configVersion(),
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
        beta: ephemeral || undefined,
        dayOffset: ephemeral ? daysBetween(today, puzzle!.date) : undefined,
        puzzleNumber: puzzle!.puzzleNumber,
        total: totalScore(finished),
        scores: finished.map((r) => r.score),
        avgDistanceM: Math.round(
          finished.reduce((sum, r) => sum + r.distanceM, 0) / finished.length,
        ),
        durationMs: Date.now() - gameStarted.current,
      })
      void flush()
      // Counted for every player, not only those who opted into telemetry --
      // otherwise "games completed today" measures consent rather than play.
      if (!ephemeral) tallyComplete(puzzle!.date)
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
        carefulMode={settings.carefulMode}
        holdMs={settings.holdMs}
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

      {over && <Results
          puzzle={puzzle}
          results={results}
          stats={stats}
          colorblind={settings.colorblind}
          onSettings={() => setShowSettings(true)}
          onHome={() => setHome(true)}
          beta={beta}
          onFocus={(i, inset) =>
            map.current?.focusLocation(
              { lng: puzzle.locations[i].lng, lat: puzzle.locations[i].lat },
              inset,
            )
          }
        />}

      <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
        <p className="pointer-events-none rounded-full bg-neutral-900/75 px-2.5 py-1 text-[10px] font-medium tracking-wide text-neutral-300">
          {imageryVariant().label}
        </p>
        {/* Reachable during play, not just from the landing screen: a player who
            realises on round 1 that they need careful mode would otherwise be
            stuck without it for the rest of the game. */}
        <button
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
          className="rounded-full bg-neutral-900/75 px-2 py-1 text-[11px] text-neutral-300"
        >
          ⚙
        </button>
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          consent={dataConsent}
          onConsent={answerConsent}
          beta={beta}
          onBeta={setBeta}
        />
      )}
    </div>
  )
}
