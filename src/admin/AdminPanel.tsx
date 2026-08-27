import { useEffect, useState } from 'react'
import { DEFAULTS, validateConfig, type Config } from '../game/config'
import { PinMap } from './PinMap'
import { validateDay, BOROUGHS, CLASSES, type DayLocation } from '../data/validateDay'
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

        <Content token={token} />

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
 * Full content editor for one day.
 *
 * Reads through /api/admin rather than /api/puzzle, so any authored day can be
 * audited -- including the ones the public gate refuses, which are the only
 * ones a wrong pin can still be fixed on before anybody plays them.
 *
 * Edits are written back to the puzzle itself rather than layered as config
 * overrides. Overrides were right for an emergency correction; they are the
 * wrong shape for routine editing, where two sources of truth for the same
 * field is how the two drift apart.
 */
function Content({ token }: { token: string }) {
  const [dates, setDates] = useState<{ date: string; number: number }[]>([])
  const [date, setDate] = useState(puzzleDate)
  const [locations, setLocations] = useState<DayLocation[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const call = (body: Record<string, unknown>) =>
    fetch('/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify(body),
    })

  useEffect(() => {
    call({ action: 'dates' })
      .then((r) => r.json())
      .then((b: { dates?: { date: string; number: number }[] }) => setDates(b.dates ?? []))
      .catch(() => setDates([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setLocations(null)
    setSelected(0)
    setDirty(false)
    setStatus('')
    call({ action: 'day', date })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('none'))))
      .then((b: { locations: DayLocation[] }) => setLocations(b.locations))
      .catch(() => setStatus(`No day authored for ${date}.`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, token])

  const problems = locations ? validateDay(locations) : []

  function edit(index: number, patch: Partial<DayLocation>) {
    setLocations((ls) => ls && ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))
    setDirty(true)
    setStatus('')
  }

  async function save() {
    if (!locations) return
    setSaving(true)
    try {
      const res = await call({ action: 'save', date, locations })
      const body = await res.json()
      if (res.ok) {
        setDirty(false)
        setStatus('Saved. Live within five minutes.')
      } else {
        setStatus(body.problems?.join(' · ') ?? body.error ?? 'Save failed.')
      }
    } catch {
      setStatus('Save failed — network.')
    } finally {
      setSaving(false)
    }
  }

  const current = locations?.[selected]
  const number = dates.find((d) => d.date === date)?.number

  return (
    <Section
      title="Content"
      note="Edits go straight to the puzzle, not to an override — so what you see here is what the day actually is."
    >
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg bg-neutral-900 px-3 py-2 ring-1 ring-white/10"
        >
          {dates.map((d) => (
            <option key={d.date} value={d.date}>
              {d.date} · #{d.number}
            </option>
          ))}
        </select>
        {number !== undefined && (
          <span className="text-xs text-neutral-500">
            {date < puzzleDate() ? 'past' : date === puzzleDate() ? 'live today' : 'not yet published'}
          </span>
        )}
      </div>

      {status && <p className="mt-3 text-sm text-neutral-300">{status}</p>}

      {locations && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {locations.map((l, i) => (
              <button
                key={l.id + i}
                onClick={() => setSelected(i)}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  i === selected ? 'bg-amber-400 font-medium text-neutral-900' : 'bg-neutral-900 text-neutral-300'
                }`}
              >
                {i + 1}. {l.prompt || '(untitled)'}
              </button>
            ))}
          </div>

          <PinMap
            locations={locations}
            selected={selected}
            onMove={(lat, lng) => edit(selected, { lat, lng })}
          />

          {current && (
            <div className="space-y-3 rounded-xl bg-neutral-900 p-4 ring-1 ring-white/10">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="prompt (what the player sees)" value={current.prompt}
                  onChange={(v) => edit(selected, { prompt: v })} />
                <Field label="name" value={current.name} onChange={(v) => edit(selected, { name: v })} />
                <Field label="id" value={current.id} onChange={(v) => edit(selected, { id: v })} />
                <Field label="tags (comma separated)" value={current.tags.join(', ')}
                  onChange={(v) => edit(selected, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="lat" value={String(current.lat)} mono
                  onChange={(v) => edit(selected, { lat: Number(v) })} />
                <Field label="lng" value={String(current.lng)} mono
                  onChange={(v) => edit(selected, { lng: Number(v) })} />
                <Choice label="class" value={current.class} options={[...CLASSES]}
                  onChange={(v) => edit(selected, { class: v })} />
                <Choice label="borough" value={current.borough} options={[...BOROUGHS]}
                  onChange={(v) => edit(selected, { borough: v })} />
              </div>

              <Choice label="difficulty" value={String(current.difficulty)}
                options={['1', '2', '3', '4', '5']}
                onChange={(v) => edit(selected, { difficulty: Number(v) })} />

              <label className="block">
                <span className="block text-xs text-neutral-400">fact</span>
                <textarea
                  value={current.factShort}
                  onChange={(e) => edit(selected, { factShort: e.target.value })}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg bg-neutral-950 p-3 text-sm ring-1 ring-white/10"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="source URL" value={current.sourceUrl}
                  onChange={(v) => edit(selected, { sourceUrl: v })} />
                <Field label="source attribution" value={current.sourceAttribution}
                  onChange={(v) => edit(selected, { sourceAttribution: v })} />
              </div>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-300">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <button
            onClick={save}
            disabled={saving || !dirty || problems.length > 0}
            className="rounded-lg bg-white px-5 py-2 font-semibold text-neutral-900 disabled:opacity-30"
          >
            {saving ? 'Saving…' : dirty ? 'Save this day' : 'No changes'}
          </button>
        </div>
      )}
    </Section>
  )
}

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-xs text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={`mt-1 w-full rounded-lg bg-neutral-950 px-3 py-2 text-sm ring-1 ring-white/10 ${
          mono ? 'font-mono tabular-nums' : ''
        }`}
      />
    </label>
  )
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-xs text-neutral-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-neutral-950 px-3 py-2 text-sm ring-1 ring-white/10"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
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
