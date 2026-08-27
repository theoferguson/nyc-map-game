import { useEffect, useState } from 'react'
import { HOLD_OPTIONS, saveBetaCode, lockBeta, type Settings } from '../game/storage'
import { queued, type Consent } from '../game/telemetry'
import { verifyBetaCode, config } from '../game/api'

export function SettingsPanel({
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
                  Play any past day, or up to {config().beta.daysAhead} days ahead. Beta games do
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
              onSubmit={async (e) => {
                e.preventDefault()
                // Checked by the server, so a wrong code and an unreachable
                // server are both simply "not accepted" from here.
                const ok = await verifyBetaCode(code)
                setRejected(ok !== true)
                if (ok === true) {
                  saveBetaCode(code)
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
