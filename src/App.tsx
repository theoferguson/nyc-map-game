import { useEffect, useRef, useState } from 'react'
import { MapView, type MapHandle } from './map/MapView'
import { loadPuzzle, puzzleQueue, type Puzzle, type PuzzleLocation } from './data/loadPuzzle'
import { haversine, roundScore, describeMiss, type LngLat } from './game/scoring'
import { MULTIPLIERS, MAX_TOTAL, totalScore, shareString } from './game/share'
import { track, flush, consent, setConsent, queued, type Consent } from './game/telemetry'
import { imageryVariant } from './map/tiles'
import {
  puzzleDate,
  msUntilRollover,
  formatCountdown,
  shiftDate,
  daysBetween,
} from './game/date'
import {
  loadProgress,
  saveProgress,
  recordGame,
  loadStats,
  loadSettings,
  saveSettings,
  HOLD_OPTIONS,
  betaUnlocked,
  tryBetaCode,
  lockBeta,
  BETA_DAYS_AHEAD,
  type Stats,
  type Settings,
} from './game/storage'

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
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [beta, setBeta] = useState(betaUnlocked)
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
    if (!beta) return
    puzzleQueue().then((dates) => setQueue(dates.filter((d) => d <= shiftDate(today, BETA_DAYS_AHEAD))))
  }, [beta, today])

  useEffect(() => {
    const load = loadPuzzle(pickedDate ?? today)
    load
      .then((p) => {
        setPuzzle(p)
        gameStarted.current = Date.now()
        roundStarted.current = Date.now()

        // Replay the saved taps through the live scoring rules rather than
        // restoring stored numbers, so a resumed game and a fresh one can never
        // disagree about what a guess was worth. A beta day never resumes:
        // it was never saved, which is also what lets a past day be replayed.
        const saved = pickedDate ? null : loadProgress(p.date)
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
  }, [today, pickedDate])

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
  if (!puzzle) return <Centered>Loading…</Centered>

  if (!started && !over) {
    return (
      <>
        <Landing
          puzzle={puzzle}
          stats={stats}
          resuming={results.length > 0}
          onPlay={() => {
            setStarted(true)
            roundStarted.current = Date.now()
            gameStarted.current = Date.now()
          }}
          onSettings={() => setShowSettings(true)}
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
      saveProgress(activeDate, { guesses: [...results.map((r) => r.guess), guess] })
    }

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
          consent={dataConsent}
          onConsent={answerConsent}
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

/**
 * Ticks once a second, but only where a countdown is actually on screen -- which
 * is never mid-game. That matters: reaching zero reloads to pick up the new
 * day's puzzle, and a player who started before midnight must be left alone to
 * finish the day they started rather than have it pulled out from under them.
 */
function useCountdown(): string {
  const [ms, setMs] = useState(msUntilRollover)
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = msUntilRollover()
      if (remaining <= 0) window.location.reload()
      setMs(remaining)
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return formatCountdown(ms)
}

function Landing({
  puzzle,
  stats,
  resuming,
  onPlay,
  onSettings,
  queue,
  picked,
  onPick,
}: {
  puzzle: Puzzle
  stats: Stats
  resuming: boolean
  onPlay: () => void
  onSettings: () => void
  queue: string[]
  picked: string | null
  onPick: (date: string | null) => void
}) {
  const countdown = useCountdown()
  const at = queue.indexOf(puzzle.date)
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

        {queue.length > 1 && (
          <div className="rounded-xl bg-white/5 p-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPick(queue[Math.max(0, at - 1)])}
                disabled={at <= 0}
                aria-label="Earlier day"
                className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-neutral-400 disabled:opacity-25"
              >
                ‹
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-xs font-medium">
                  {picked === null ? 'Today' : `#${puzzle.puzzleNumber} · ${puzzle.date}`}
                </p>
                <p className="text-[10px] text-neutral-500">
                  {picked === null ? 'counts towards your streak' : 'beta play — nothing is saved'}
                </p>
              </div>
              <button
                onClick={() => onPick(queue[Math.min(queue.length - 1, at + 1)])}
                disabled={at < 0 || at >= queue.length - 1}
                aria-label="Later day"
                className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-neutral-400 disabled:opacity-25"
              >
                ›
              </button>
            </div>
            {picked !== null && (
              <button
                onClick={() => onPick(null)}
                className="mt-1 w-full text-center text-[10px] text-neutral-500 underline underline-offset-4"
              >
                back to today
              </button>
            )}
          </div>
        )}

        <button
          onClick={onPlay}
          className="w-full rounded-xl bg-white py-3 font-semibold text-neutral-900 active:bg-neutral-200"
        >
          {resuming ? 'Resume' : picked !== null ? 'Play this day' : 'Play'}
        </button>

        {stats.played > 0 && (
          <p className="text-xs text-neutral-500">
            {stats.played} played · {stats.streak} day streak · best{' '}
            {stats.maxStreak}
          </p>
        )}
        <p className="text-xs text-neutral-600">Next puzzle in {countdown}</p>

        <button
          onClick={onSettings}
          className="text-xs text-neutral-400 underline underline-offset-4"
        >
          Settings
        </button>
      </div>
    </Centered>
  )
}

/**
 * The recap steps through one answer at a time rather than pinning all five to
 * the map at once.
 *
 * Five cards at readable size need about a thousand vertical pixels and a phone
 * has eight hundred, so anchored cards buried the score and the Share button --
 * the share loop broken at exactly the point it should fire. One panel at a
 * time fits any screen, and the map flying to each answer does the work the
 * leader lines were doing: showing which place is being talked about.
 */
function Results({
  puzzle,
  results,
  stats,
  colorblind,
  onFocus,
  consent,
  onConsent,
}: {
  puzzle: Puzzle
  results: Result[]
  stats: Stats
  colorblind: boolean
  onFocus: (index: number, bottomInset: number) => void
  consent: Consent
  onConsent: (granted: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [step, setStep] = useState(0)
  const [expanded, setExpanded] = useState(true)
  const panel = useRef<HTMLDivElement>(null)
  const countdown = useCountdown()
  const location = puzzle.locations[step]
  const result = results[step]

  // Wraps rather than disabling at the ends: five items is short enough that
  // cycling past the last is friendlier than a dead arrow.
  const go = (delta: number) => {
    const next = (step + delta + puzzle.locations.length) % puzzle.locations.length
    setStep(next)
    onFocus(next, panel.current?.offsetHeight ?? 0)
  }

  // Re-frames on open and whenever the panel changes height. Collapsing frees
  // map, but the camera has to move into it -- the pin does not rise on its own.
  // Only this component can measure the panel, which is why the focus call
  // lives here rather than in the recap effect.
  const focus = useRef(onFocus)
  focus.current = onFocus
  useEffect(() => {
    focus.current(step, panel.current?.offsetHeight ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])
  const total = totalScore(results)
  const text = shareString(puzzle.puzzleNumber, results, colorblind)

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
      <div
        ref={panel}
        className="space-y-3 rounded-2xl bg-neutral-900/90 p-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <div className="-mx-2 space-y-1.5 rounded-xl bg-white/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              aria-label="Previous location"
              className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-neutral-400 active:bg-white/10"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold leading-tight">{location.name}</p>
              <p className="text-[10px] tabular-nums text-neutral-500">
                {step + 1} of {puzzle.locations.length}
              </p>
            </div>
            <button
              onClick={() => go(1)}
              aria-label="Next location"
              className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-neutral-400 active:bg-white/10"
            >
              ›
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-neutral-400">{result?.copy}</span>
            <span className="shrink-0 font-semibold tabular-nums text-amber-400">
              {result?.score ?? 0}
            </span>
          </div>

          {expanded && (
            <>
              <p className="text-[11px] leading-snug text-neutral-200">{location.factShort}</p>
              <p className="text-[9px] text-neutral-500">{location.sourceAttribution}</p>
            </>
          )}

          {/* Collapsing keeps the arrows and the score, so the player can still
              step between answers while watching the map rather than the text. */}
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Collapse fact' : 'Expand fact'}
            aria-expanded={expanded}
            className="mx-auto block w-full pt-0.5 text-center text-[10px] leading-none text-neutral-500 active:text-neutral-300"
          >
            {expanded ? '⌃' : '⌄'}
          </button>
        </div>

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

        {/* Asked here, not on the landing screen, where it sat under the Play
            button and every player walked straight past it -- and where a
            finished game never renders at all, so anyone who had already played
            could not reach it. The game is over by this point, there is no
            button they are trying to get past, and "help tune the puzzles"
            means something to someone who has just been beaten by one. */}
        {consent === 'unset' && (
          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-neutral-400">
              Share anonymous play data to help tune the puzzles? No account, no
              ads, no third parties.
            </p>
            <button
              onClick={() => onConsent(true)}
              className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium active:bg-white/20"
            >
              Sure
            </button>
            <button
              onClick={() => onConsent(false)}
              className="shrink-0 px-1 py-1.5 text-xs text-neutral-500 active:text-neutral-300"
            >
              No
            </button>
          </div>
        )}
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
      className={`pointer-events-none absolute inset-x-3 z-30 mx-auto max-w-md ${className}`}
      style={{
        marginBottom: 'env(safe-area-inset-bottom)',
        marginTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="pointer-events-auto">{children}</div>
    </div>
  )
}

function SettingsPanel({
  settings,
  onChange,
  onClose,
  consent,
  onConsent,
  beta,
  onBeta,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  consent: Consent
  onConsent: (granted: boolean) => void
  beta: boolean
  onBeta: (unlocked: boolean) => void
}) {
  const [code, setCode] = useState('')
  const [rejected, setRejected] = useState(false)

  // Polled rather than read once: granting consent starts a flush that settles
  // after this panel has rendered, and a count frozen at "15 waiting" a second
  // after they all sent is worse than no count at all.
  const [waiting, setWaiting] = useState(queued)
  useEffect(() => {
    const id = setInterval(() => setWaiting(queued()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-neutral-900 p-5 text-white ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-sm text-neutral-400">
            Done
          </button>
        </div>

        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Careful mode</span>
            <span className="block text-xs text-neutral-400">
              Press and hold to place, instead of a single tap. Let go early to cancel.
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.carefulMode}
            onChange={(e) => onChange({ carefulMode: e.target.checked })}
            className="mt-1 size-5 shrink-0 accent-amber-400"
          />
        </label>

        {settings.carefulMode && (
          <div>
            <p className="text-sm font-medium">Hold for</p>
            <div className="mt-2 flex gap-2">
              {HOLD_OPTIONS.map((ms) => (
                <button
                  key={ms}
                  onClick={() => onChange({ holdMs: ms })}
                  className={`flex-1 rounded-lg py-2 text-sm ${
                    settings.holdMs === ms
                      ? 'bg-white font-semibold text-neutral-900'
                      : 'bg-neutral-800 text-neutral-300'
                  }`}
                >
                  {ms / 1000}s
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-start justify-between gap-4 border-t border-white/10 pt-4">
          <span>
            <span className="block text-sm font-medium">Share anonymous play data</span>
            <span className="block text-xs text-neutral-400">
              Scores and distances, to find puzzles that are too hard. Turning this
              off also deletes the anonymous id this device was using.
            </span>
          </span>
          <input
            type="checkbox"
            checked={consent === 'granted'}
            onChange={(e) => onConsent(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-amber-400"
          />
        </label>

        <p className="-mt-3 text-xs text-neutral-500">
          {consent === 'denied'
            ? 'Nothing is being recorded.'
            : waiting === 0
              ? consent === 'granted'
                ? 'Everything sent.'
                : 'Nothing recorded yet.'
              : `${waiting} event${waiting === 1 ? '' : 's'} on this device, ${
                  consent === 'granted' ? 'waiting to send' : 'not sent'
                }.`}
        </p>

        <div className="border-t border-white/10 pt-4">
          {beta ? (
            <div className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Beta access</span>
                <span className="block text-xs text-neutral-400">
                  Play any past day, or up to {BETA_DAYS_AHEAD} days ahead. Beta games do
                  not count towards streaks.
                </span>
              </span>
              <button
                onClick={() => {
                  lockBeta()
                  onBeta(false)
                }}
                className="shrink-0 text-xs text-neutral-500 underline underline-offset-4"
              >
                Turn off
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const ok = tryBetaCode(code)
                setRejected(!ok)
                if (ok) {
                  setCode('')
                  onBeta(true)
                }
              }}
            >
              <label className="block text-sm font-medium" htmlFor="beta-code">
                Beta code
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="beta-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setRejected(false)
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none placeholder:text-neutral-600"
                  placeholder="if you have one"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-neutral-900"
                >
                  Enter
                </button>
              </div>
              {rejected && <p className="mt-1.5 text-xs text-amber-400">That code did not work.</p>}
            </form>
          )}
        </div>

        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Colourblind squares</span>
            <span className="block text-xs text-neutral-400">
              Shapes as well as colour in the shared result.
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.colorblind}
            onChange={(e) => onChange({ colorblind: e.target.checked })}
            className="mt-1 size-5 shrink-0 accent-amber-400"
          />
        </label>
      </div>
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
