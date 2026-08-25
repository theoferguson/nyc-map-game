import { test, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
})

const { loadPuzzle } = await import('./loadPuzzle')
const { encodeLocations } = await import('../../scripts/encode.mjs')

const DATE = '2026-09-01'
const LOCATIONS = [
  { id: 'katzs', prompt: "Katz's", lat: 40.7223, lng: -73.9874, factShort: 'A deli.' },
]
const payload = {
  date: DATE,
  puzzleNumber: 7,
  theme: null,
  locations: encodeLocations(LOCATIONS, DATE),
}

const ok = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload })
const failing = (status: number) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) })

beforeEach(() => store.clear())

test('a successful load is kept, and serves the game when the API is down', async () => {
  vi.stubGlobal('fetch', ok())
  expect((await loadPuzzle(DATE, {}, null, true)).puzzleNumber).toBe(7)

  // The database is gone. The player has already loaded today once.
  vi.stubGlobal('fetch', failing(503))
  const offline = await loadPuzzle(DATE, {}, null, true)
  expect(offline.locations[0].id).toBe('katzs')
})

test('a dropped connection falls back too', async () => {
  vi.stubGlobal('fetch', ok())
  await loadPuzzle(DATE, {}, null, true)

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  expect((await loadPuzzle(DATE, {}, null, true)).puzzleNumber).toBe(7)
})

test('a 404 is obeyed, not worked around', async () => {
  vi.stubGlobal('fetch', ok())
  await loadPuzzle(DATE, {}, null, true)

  // A revoked beta code, or a day past the queue. Serving the cached copy over
  // a refusal is precisely how the date gate stops meaning anything.
  vi.stubGlobal('fetch', failing(404))
  await expect(loadPuzzle(DATE, {}, null, true)).rejects.toThrow(/No puzzle/)
})

test('beta days are never written to disk', async () => {
  vi.stubGlobal('fetch', ok())
  await loadPuzzle(DATE, {}, 'somecode', false)
  expect([...store.keys()].filter((k) => k.startsWith('nycmap:puzzle:'))).toEqual([])

  vi.stubGlobal('fetch', failing(503))
  await expect(loadPuzzle(DATE, {}, 'somecode', false)).rejects.toThrow(/No puzzle/)
})

test('only the current day is kept', async () => {
  vi.stubGlobal('fetch', ok())
  await loadPuzzle(DATE, {}, null, true)

  const next = '2026-09-02'
  const later = { ...payload, date: next, locations: encodeLocations(LOCATIONS, next) }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => later }))
  await loadPuzzle(next, {}, null, true)

  expect([...store.keys()].filter((k) => k.startsWith('nycmap:puzzle:'))).toEqual([
    `nycmap:puzzle:${next}`,
  ])
})

test('overrides still apply to a cached day', async () => {
  vi.stubGlobal('fetch', ok())
  await loadPuzzle(DATE, {}, null, true)

  vi.stubGlobal('fetch', failing(503))
  const fixed = await loadPuzzle(DATE, { katzs: { factShort: 'Corrected.' } }, null, true)
  expect(fixed.locations[0].factShort).toBe('Corrected.')
})
