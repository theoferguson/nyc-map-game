import type { Puzzle } from '../data/loadPuzzle'
import type { Stats } from '../game/storage'
import type { Consent } from '../game/telemetry'
import { useCountdown } from '../game/useCountdown'
import { Centered } from '../ui/Centered'

/**
 * The notice, not a question.
 *
 * Starting a game is the consent: the two-button card was walked past by every
 * player who saw it, including the person who built it, and a card nobody
 * answers collects nothing while looking like it asked. This says what happens
 * in one line, next to the only button on the screen, and points at the switch
 * that turns it off.
 *
 * The trade is real and worth naming: an affirmative click on a button labelled
 * *Play* is weaker consent than one on a button labelled *Yes*, and under
 * ePrivacy it is the softer reading. What keeps it defensible is that the
 * notice sits beside the action rather than behind a link, nothing personal is
 * collected, and withdrawal is one tap away in Settings -- where turning it off
 * also deletes the id the device was using.
 */
export function ConsentNotice({ consent }: { consent: Consent }) {
  if (consent !== 'unset') return null
  return (
    <p className="text-[10px] leading-relaxed text-neutral-600">
      Playing shares anonymous scores, so the puzzles can be tuned. No account,
      no ads. Turn it off in Settings.
    </p>
  )
}

export function Landing({
  puzzle,
  stats,
  resuming,
  onPlay,
  onSettings,
  consent,
  queue,
  picked,
  onPick,
}: {
  puzzle: Puzzle
  stats: Stats
  resuming: boolean
  onPlay: () => void
  onSettings: () => void
  consent: Consent
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

        <ConsentNotice consent={consent} />

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
