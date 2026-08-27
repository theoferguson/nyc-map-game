import { useEffect, useState } from 'react'
import { DEFAULTS, validateConfig, type Config } from '../game/config'
import { decodePuzzle, type Puzzle } from '../data/loadPuzzle'
import { roundScore, setScoring } from '../game/scoring'
import { puzzleDate } from '../game/date'

/**
 * Operator surface for the handful of settings that change without a deploy.
 *
 * Reached at /?admin, and nothing is rendered until the token is accepted. The
 * gate is real rather than cosmetic: the panel has no config to display until
 * `POST /api/admin` returns one, and that endpoint checks ADMIN_TOKEN. A visitor
 * without the token sees a prompt and can learn nothing else from the page.
 *
 * The URL is still not a secret and is not treated as one. Hiding the path would
 * put it in browser history, referrer headers and screenshots while adding
 * nothing the token does not already do.
 *
 * The token lives in sessionStorage, not localStorage: it is a credential, and
 * it should not outlive the tab it was typed into.
 */

const TOKEN_KEY = 'nycmap:admin-token'

/**
 * Codes are said out loud and typed on phones, so they are two plain words and
 * two digits rather than anything random-looking. Nothing here is a secret --
 * the code gates early puzzles, not an account -- but ~40,000 combinations is
 * enough that nobody stumbles onto it.
 */
const WORDS = [
  'bodega', 'subway', 'bridge', 'harbor', 'uptown', 'midtown', 'borough',
  'transit', 'avenue', 'skyline', 'ferry', 'tunnel', 'station', 'corner',
  'island', 'river', 'tower', 'market', 'lantern', 'signal',
]

function newCode(): string {
  const pick = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  return `${WORDS[pick(WORDS.length)]}${WORDS[pick(WORDS.length)]}${10 + pick(90)}`
}

/** Distances the preview is scored at, chosen to span the shape of the curve. */
const PREVIEW = [
  { label: '1 block', m: 80 },
  { label: '5 blocks', m: 400 },
  { label: '15 blocks', m: 1200 },
  { label: '1.5 miles', m: 2400 },
  { label: '3 miles', m: 4830 },
  { label: 'wrong borough', m: 10_000 },
]

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [config, setConfig] = useState<Config>(DEFAULTS)
  const [version, setVersion] = useState<number | null>(null)
  // Blank, not "Loading…": with no token held there is nothing to load and the
  // prompt should say so by saying nothing.
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  /**
   * The code as the server has it. Handing someone the value in the input
   * before it is saved gives them a code that does not work yet, which is a
   * confusing thing to debug over a text message.
   */
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(false)

  /** Proves the token and loads the config in one call. */
  async function unlock(candidate: string): Promise<void> {
    setStatus('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'x-admin-token': candidate },
      })
      if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY)
        setStatus('Token rejected.')
        return
      }
      if (!res.ok) {
        setStatus('Could not load the config.')
        return
      }
      const body = (await res.json()) as { version: number; config: unknown }
      const loaded = validateConfig(body.config).config
      setConfig(loaded)
      setSavedCode(loaded.beta.code)
      setVersion(body.version)
      sessionStorage.setItem(TOKEN_KEY, candidate)
      setUnlocked(true)
    } catch {
      setStatus('Could not reach the server.')
    }
  }

  // A token already in this tab's session skips the prompt.
  useEffect(() => {
    const held = sessionStorage.getItem(TOKEN_KEY)
    // `unlock` sets state, but only after an await -- this is a fetch on mount,
    // which is exactly what an effect is for.
    // oxlint-disable-next-line react/set-state-in-effect
    if (held) void unlock(held)
    // Runs once. `unlock` is recreated every render and listing it here would
    // re-prompt on each one.
    // oxlint-disable-next-line exhaustive-deps
  }, [])

  // The preview scores through the real function, so what it shows is what
  // players get -- a reimplementation here would drift from the game silently.
  useEffect(() => setScoring(config.scoring), [config.scoring])

  if (!unlocked) {
    return (
      <div className="flex min-h-full items-center justify-center bg-neutral-950 p-6 text-white">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void unlock(token)
          }}
          className="w-full max-w-xs space-y-4"
        >
          <h1 className="text-lg font-semibold">Admin</h1>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="token"
            autoComplete="off"
            autoFocus
            className="w-full rounded-lg bg-neutral-900 px-3 py-2 ring-1 ring-white/10"
          />
          <button
            type="submit"
            disabled={!token}
            className="w-full rounded-lg bg-white py-2 font-semibold text-neutral-900 disabled:opacity-30"
          >
            Unlock
          </button>
          {status && <p className="text-sm text-neutral-400">{status}</p>}
        </form>
      </div>
    )
  }

  async function save() {
    setSaving(true)
    setStatus('')
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(config),
      })
      const body = await res.json()
      if (res.ok) {
        setVersion(body.version)
        setSavedCode(config.beta.code)
        setStatus(`Saved. Version ${body.version} — live within a minute.`)
      } else if (res.status === 401) {
        setStatus('Token rejected.')
      } else {
        setStatus(body.problems?.join(' · ') ?? body.error ?? 'Save failed.')
      }
    } catch {
      setStatus('Save failed — network.')
    } finally {
      setSaving(false)
    }
  }

  const patch = (p: Partial<Config>) => setConfig((c) => ({ ...c, ...p }))
  const patchScoring = (p: Partial<Config['scoring']>) =>
    patch({ scoring: { ...config.scoring, ...p } })

  return (
    <div className="min-h-full bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">NYC Daily — admin</h1>
          <p className="text-xs text-neutral-500">
            {version === null ? 'not loaded' : version === 0 ? 'defaults (nothing saved yet)' : `version ${version}`}
          </p>
        </header>

        <Section title="Scoring" note="Applies to every player from their next load. Rounds already played keep the score they were given.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(['area', 'landmark', 'venue'] as const).map((cls) => (
              <Num
                key={cls}
                label={`λ ${cls}`}
                value={config.scoring.lambda[cls]}
                onChange={(v) =>
                  patchScoring({ lambda: { ...config.scoring.lambda, [cls]: v } })
                }
              />
            ))}
            <Num label="falloff" step={0.1} value={config.scoring.falloff} onChange={(v) => patchScoring({ falloff: v })} />
            <Num label="bullseye m" value={config.scoring.bullseyeM} onChange={(v) => patchScoring({ bullseyeM: v })} />
          </div>

          {/* Numbers alone are unreadable -- 3600 means nothing until you see
              that it makes a 1.5-mile miss worth 58. */}
          <table className="mt-5 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-1 font-medium">miss</th>
                <th className="py-1 font-medium">area</th>
                <th className="py-1 font-medium">landmark</th>
                <th className="py-1 font-medium">venue</th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW.map((row) => (
                <tr key={row.label} className="border-t border-white/5">
                  <td className="py-1 text-neutral-400">{row.label}</td>
                  {(['area', 'landmark', 'venue'] as const).map((cls) => (
                    <td key={cls} className="py-1">{roundScore(row.m, cls)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Beta
          config={config}
          patch={patch}
          savedCode={savedCode}
        />

        <Traffic token={token} />

        <Locations config={config} patch={patch} betaCode={config.beta.code} />

        <Section title="Save" note="Nothing above has any effect until this succeeds.">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-white px-6 py-2 font-semibold text-neutral-900 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {status && <p className="mt-3 text-sm text-neutral-300">{status}</p>}
        </Section>
      </div>
    </div>
  )
}

/**
 * Loads and completions, counted server-side without consent.
 *
 * The number that matters here is the gap between "played" and "consented":
 * telemetry only ever sees the second, so reading `events` alone answers
 * "how many people opted in" while looking like it answers "how many played".
 */
function Traffic({ token }: { token: string }) {
  const [days, setDays] = useState<
    { date: string; loads: number; completes: number; consented: number }[] | null
  >(null)

  useEffect(() => {
    fetch('/api/stats', { method: 'POST', headers: { 'x-admin-token': token } })
      .then((r) => r.json())
      .then((b: { days?: typeof days }) => setDays(b.days ?? []))
      .catch(() => setDays([]))
  }, [token])

  return (
    <Section
      title="Traffic"
      note="Counted for every player. Loads are a floor — a cached or offline replay never reaches the server."
    >
      {days === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing counted yet.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-1 font-medium">day</th>
              <th className="py-1 font-medium">loads</th>
              <th className="py-1 font-medium">finished</th>
              <th className="py-1 font-medium">opted in</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-white/5">
                <td className="py-1 text-neutral-400">{d.date}</td>
                <td className="py-1">{d.loads ?? 0}</td>
                <td className="py-1">{d.completes ?? 0}</td>
                <td className="py-1 text-neutral-500">{d.consented ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function Beta({
  config,
  patch,
  savedCode,
}: {
  config: Config
  patch: (p: Partial<Config>) => void
  savedCode: string | null
}) {
  const [copied, setCopied] = useState(false)
  const code = config.beta.code
  const dirty = savedCode !== null && code !== savedCode

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard needs a secure context and can be refused outright. The code
      // is on screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <Section
      title="Beta access"
      note="Renewing locks out every device holding the old code — that is what makes rotation actually revoke, rather than just adding a second working code."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="block text-xs text-neutral-400">code</span>
          <input
            value={code}
            onChange={(e) => patch({ beta: { ...config.beta, code: e.target.value } })}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg bg-neutral-900 px-3 py-2 font-mono text-lg ring-1 ring-white/10"
          />
        </label>
        <button
          onClick={copy}
          disabled={dirty}
          title={dirty ? 'Save before handing this out' : 'Copy to clipboard'}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium disabled:opacity-30"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => patch({ beta: { ...config.beta, code: newCode() } })}
          className="rounded-lg px-3 py-2 text-sm text-neutral-400 ring-1 ring-white/10"
        >
          Renew
        </button>
        <div className="w-28">
          <Num
            label="days ahead"
            value={config.beta.daysAhead}
            onChange={(v) => patch({ beta: { ...config.beta, daysAhead: v } })}
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        {dirty
          ? 'Unsaved — this code does not work yet. Save, then copy.'
          : savedCode === null
            ? ''
            : 'Testers enter this under Settings → Beta code.'}
      </p>
    </Section>
  )
}

/**
 * Facts are edited against a real day rather than typed as bare ids, because
 * nobody knows a location id by heart and a typo in one is a silent no-op --
 * an override for an id that does not exist looks saved and does nothing.
 */
function Locations({
  config,
  patch,
  betaCode,
}: {
  config: Config
  patch: (p: Partial<Config>) => void
  betaCode: string
}) {
  const [date, setDate] = useState(puzzleDate)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // Cleared before the fetch so a slow load cannot show the previous day's
    // locations under the new date.
    // oxlint-disable-next-line react/set-state-in-effect
    setError('')
    setPuzzle(null)
    // Deliberately unpatched: the panel edits the authored content, so it has
    // to show what was authored rather than what the overrides already say.
    // Through the same gate as everyone else, with the live beta code as the
    // key -- the panel has no privileged path to content, so a day beyond the
    // beta window cannot be edited here either.
    fetch(`/api/puzzle?date=${date}&code=${encodeURIComponent(betaCode)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('none'))))
      .then((raw) => setPuzzle(decodePuzzle(raw)))
      .catch(() => setError(`No puzzle available for ${date}.`))
  }, [date, betaCode])

  const set = (id: string, next: { factShort?: string; hidden?: boolean }) => {
    const locations = { ...config.locations }
    const merged = { ...locations[id], ...next }
    if (!merged.factShort && !merged.hidden) delete locations[id]
    else locations[id] = merged
    patch({ locations })
  }

  return (
    <Section title="Content corrections" note="Overrides are keyed by location, so a fix applies wherever that place appears.">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-lg bg-neutral-900 px-3 py-2 ring-1 ring-white/10"
      />
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      <div className="mt-4 space-y-4">
        {puzzle?.locations.map((l) => {
          const override = config.locations[l.id] ?? {}
          return (
            <div key={l.id} className="rounded-xl bg-neutral-900 p-4 ring-1 ring-white/10">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{l.prompt}</p>
                  <p className="text-[11px] text-neutral-500">{l.id} · {l.class} · {l.borough}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={override.hidden === true}
                    onChange={(e) => set(l.id, { hidden: e.target.checked || undefined })}
                    className="size-4 accent-amber-400"
                  />
                  hide
                </label>
              </div>
              <textarea
                value={override.factShort ?? l.factShort}
                onChange={(e) =>
                  set(l.id, { factShort: e.target.value === l.factShort ? undefined : e.target.value })
                }
                rows={3}
                className="mt-3 w-full resize-y rounded-lg bg-neutral-950 p-3 text-sm ring-1 ring-white/10"
              />
              {override.factShort && (
                <button
                  onClick={() => set(l.id, { factShort: undefined })}
                  className="mt-2 text-xs text-neutral-500 underline underline-offset-4"
                >
                  revert to the authored fact
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/5 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mt-1 mb-4 text-xs leading-relaxed text-neutral-400">{note}</p>}
      {children}
    </section>
  )
}

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
}) {
  return (
    <label className="block">
      <span className="block text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        className="mt-1 w-full rounded-lg bg-neutral-900 px-3 py-2 tabular-nums ring-1 ring-white/10"
      />
    </label>
  )
}
