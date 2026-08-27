import { useEffect, useRef, useState } from 'react'
import type { Puzzle } from '../data/loadPuzzle'
import type { Result } from '../game/round'
import type { Stats } from '../game/storage'
import { maxTotal, totalScore, shareString } from '../game/share'
import { track } from '../game/telemetry'
import { useCountdown } from '../game/useCountdown'
import { Floating } from '../ui/Floating'

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
export function Results({
  puzzle,
  results,
  stats,
  colorblind,
  onSettings,
  onHome,
  beta,
  onFocus,
}: {
  puzzle: Puzzle
  results: Result[]
  stats: Stats
  colorblind: boolean
  onSettings: () => void
  onHome: () => void
  beta: boolean
  onFocus: (index: number, bottomInset: number) => void
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
            <span className="text-base font-normal text-neutral-500">
              /{maxTotal(puzzle.locations.length)}
            </span>
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

        {/* The game is over, so this is the only route left to the beta code --
            and, once entered, to the day picker that makes it useful. */}
        <div className="flex items-center justify-center gap-5">
          <button
            onClick={onSettings}
            className="text-xs text-neutral-400 underline underline-offset-4"
          >
            Settings
          </button>
          <button
            onClick={onHome}
            className="text-xs text-neutral-400 underline underline-offset-4"
          >
            {beta ? 'Play another day' : 'Home'}
          </button>
        </div>
      </div>
    </Floating>
  )
}
