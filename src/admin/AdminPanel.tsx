import { useEffect, useState } from 'react'
import { DEFAULTS, validateConfig, type Config } from '../game/config'
import { decodePuzzle, type Puzzle } from '../data/loadPuzzle'
import { roundScore, setScoring } from '../game/scoring'
import { puzzleDate } from '../game/date'

/**
 * Operator surface for the handful of settings that change without a deploy.
 *
 * Reached at /?admin, and the URL is not the security boundary -- the token is.
 * Anyone can open this page; nothing they type has any effect until a write is
 * accepted by the endpoint, which checks ADMIN_TOKEN. So the panel is free to
 * be a plain route rather than something hidden.
 *
 * The token lives in sessionStorage, not localStorage: it is a credential, and
 * it should not outlive the tab it was typed into.
 */

const TOKEN_KEY = 'nycmap:admin-token'

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
  const [status, setStatus] = useState('Loading…')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((body: { version: number; config: unknown }) => {
        setConfig(validateConfig(body.config).config)
        setVersion(body.version)
        setStatus('')
      })
      .catch(() => setStatus('Could not load the current config.'))
  }, [])

  // The preview scores through the real function, so what it shows is what
  // players get -- a reimplementation here would drift from the game silently.
  useEffect(() => setScoring(config.scoring), [config.scoring])

  async function save() {
    setSaving(true)
    setStatus('')
    sessionStorage.setItem(TOKEN_KEY, token)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(config),
      })
      const body = await res.json()
      if (res.ok) {
        setVersion(body.version)
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

        <Section title="Beta access" note="Changing the code locks out every device holding the old one, which is what makes rotation work.">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-xs text-neutral-400">code</span>
              <input
                value={config.beta.code}
                onChange={(e) => patch({ beta: { ...config.beta, code: e.target.value } })}
                className="mt-1 w-full rounded-lg bg-neutral-900 px-3 py-2 ring-1 ring-white/10"
              />
            </label>
            <Num
              label="days ahead"
              value={config.beta.daysAhead}
              onChange={(v) => patch({ beta: { ...config.beta, daysAhead: v } })}
            />
          </div>
        </Section>

        <Locations config={config} patch={patch} />

        <Section title="Save" note="Nothing above has any effect until this succeeds.">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="admin token"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg bg-neutral-900 px-3 py-2 ring-1 ring-white/10"
            />
            <button
              onClick={save}
              disabled={saving || !token}
              className="rounded-lg bg-white px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {status && <p className="mt-3 text-sm text-neutral-300">{status}</p>}
        </Section>
      </div>
    </div>
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
}: {
  config: Config
  patch: (p: Partial<Config>) => void
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
    fetch(`/puzzles/${date}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('none'))))
      .then((raw) => setPuzzle(decodePuzzle(raw)))
      .catch(() => setError(`No puzzle authored for ${date}.`))
  }, [date])

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
