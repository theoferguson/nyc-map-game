import { test, expect, beforeEach, vi } from 'vitest'

// jsdom is not installed; a minimal localStorage is all telemetry touches.
const store = new Map<string, string>()
const workingStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
vi.stubGlobal('localStorage', workingStorage)
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
vi.stubGlobal('document', { referrer: '' })
vi.stubGlobal('window', { location: { search: '?utm_source=twitter&utm_medium=social' } })
vi.stubGlobal('navigator', { language: 'en-US' })

const { track, drain } = await import('./telemetry')
const { loadProgress, saveProgress, loadStats, recordGame, loadSettings, saveSettings, HOLD_OPTIONS } =
  await import('./storage')
const { imageryVariant, VARIANTS } = await import('../map/tiles')

// Two tests below break storage and crypto on purpose; restore them each time
// so the damage cannot leak into whichever test happens to run next.
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', workingStorage)
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
})

test('imagery assignment is sticky, or the experiment measures nothing', () => {
  const first = imageryVariant()
  for (let i = 0; i < 20; i++) expect(imageryVariant().id).toBe(first.id)
  expect(VARIANTS.map((v) => v.id)).toContain(first.id)
})

test('every event carries the install id and which survey was served', () => {
  track('round_complete', { score: 82 })
  const [event] = drain()
  expect(event.installId).toBe('test-uuid')
  expect(VARIANTS.map((v) => v.id)).toContain(event.imagery)
  expect(event.props.score).toBe(82)
  expect(event.ts).toBeGreaterThan(0)
})

test('first-touch attribution is captured once, on game_start only', () => {
  track('game_start', { puzzleNumber: 1 })
  track('round_complete', { score: 10 })
  const [start, round] = drain()
  expect(start.props.utm_source).toBe('twitter')
  expect(start.props.referrer).toBe('direct')
  // A later round must not restate attribution, and a second session must not
  // overwrite where the player originally came from.
  expect(round.props.utm_source).toBeUndefined()
})

test('game_start carries a coarse region, and no raw IP or precise location', () => {
  track('game_start', { puzzleNumber: 1 })
  const [start] = drain()
  expect(start.props.timezone).toBeTruthy()
  expect(start.props.locale).toBe('en-US')
  // Coarse only: nothing that pins the player to an address.
  expect(start.props).not.toHaveProperty('ip')
  expect(start.props).not.toHaveProperty('lat')
  expect(start.props).not.toHaveProperty('lng')
})

test('drain empties the queue so events cannot be sent twice', () => {
  track('a')
  track('b')
  expect(drain()).toHaveLength(2)
  expect(drain()).toHaveLength(0)
})

test('the queue is capped so a daily player cannot fill their own storage', async () => {
  for (let i = 0; i < 600; i++) track('round_complete', { i })
  const events = drain()
  expect(events.length).toBeLessThanOrEqual(400)
  // Newest survive, not oldest.
  expect(events[events.length - 1].props.i).toBe(599)
})

test('a browser that refuses storage does not break the game', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('SecurityError') },
  })
  expect(() => track('game_start', {})).not.toThrow()
  expect(() => imageryVariant()).not.toThrow()
})

test('corrupted storage does not permanently break the game', () => {
  // Anyone can hand-edit localStorage, and a quota error can truncate it. An
  // unguarded parse would then throw on every load, and the only fix available
  // to the player would be clearing site data.
  store.set('nycmap:events', '{not json')
  store.set('nycmap:attribution', 'null}')
  expect(() => track('game_start', { puzzleNumber: 1 })).not.toThrow()
  expect(drain()).toHaveLength(1)
})

test('an install id is still issued without a secure context', () => {
  // crypto.randomUUID is absent over plain http and on Safari before 15.4.
  vi.stubGlobal('crypto', {})
  store.clear()
  expect(() => track('game_start', {})).not.toThrow()
  expect(drain()[0].installId).toMatch(/^anon-/)
})

/* ------------------------------------------------------- progress & stats */

test('a mid-game refresh resumes with every earlier guess intact', () => {
  const guesses = [
    { lng: -73.98, lat: 40.75 },
    { lng: -73.92, lat: 40.83 },
    { lng: -73.97, lat: 40.57 },
  ]
  saveProgress('2026-08-19', { guesses })
  expect(loadProgress('2026-08-19')?.guesses).toEqual(guesses)
  // A different day is a different puzzle, never a partial resume.
  expect(loadProgress('2026-08-20')).toBeNull()
})

test('only the current day is kept, so saves cannot pile up forever', () => {
  saveProgress('2026-08-17', { guesses: [{ lng: -74, lat: 40.7 }] })
  saveProgress('2026-08-18', { guesses: [{ lng: -74, lat: 40.7 }] })
  saveProgress('2026-08-19', { guesses: [{ lng: -74, lat: 40.7 }] })
  expect([...store.keys()].filter((k) => k.startsWith('nycmap:progress:'))).toEqual([
    'nycmap:progress:2026-08-19',
  ])
})

test('corrupt or hand-edited progress resumes as a fresh game', () => {
  store.set('nycmap:progress:2026-08-19', '{"guesses": "not an array"}')
  expect(loadProgress('2026-08-19')).toBeNull()
  store.set('nycmap:progress:2026-08-19', '{"guesses":[{"lng":"x","lat":null}]}')
  expect(loadProgress('2026-08-19')).toBeNull()
})

test('streaks continue across consecutive days and reset after a gap', () => {
  expect(recordGame('2026-08-17', 700).streak).toBe(1)
  expect(recordGame('2026-08-18', 800).streak).toBe(2)
  expect(recordGame('2026-08-19', 900).streak).toBe(3)
  // Skipped the 20th.
  const after = recordGame('2026-08-21', 600)
  expect(after.streak).toBe(1)
  expect(after.maxStreak).toBe(3)
  expect(after.played).toBe(4)
})

test('replaying the results screen does not inflate the streak', () => {
  recordGame('2026-08-19', 855)
  const again = recordGame('2026-08-19', 855)
  expect(again.played).toBe(1)
  expect(again.streak).toBe(1)
  expect(again.totalScore).toBe(855)
})

test('score distribution buckets every total including a perfect game', () => {
  recordGame('2026-08-15', 0)
  recordGame('2026-08-16', 1000)
  const stats = loadStats()
  expect(stats.distribution[0]).toBe(1)
  expect(stats.distribution[4]).toBe(1)
  expect(stats.distribution.reduce((a, b) => a + b, 0)).toBe(2)
})

/* ------------------------------------------- regressions from code review */

test('a stats key holding the string "null" does not blank the page', () => {
  // "null" parses cleanly to null rather than throwing, so the parse guard lets
  // it through. loadStats runs during render, so this surfaced as a blank page
  // that only clearing site data could fix.
  store.set('nycmap:stats', 'null')
  expect(() => loadStats()).not.toThrow()
  expect(loadStats().played).toBe(0)

  store.set('nycmap:stats', '{"distribution":"not an array"}')
  expect(loadStats().distribution).toHaveLength(5)
})

test('a corrupt guess truncates the resume rather than shifting later ones', () => {
  // Guess N is scored against location N. Filtering the bad entry out would
  // compact the array and score guess 3 against location 2 -- wrong distance,
  // wrong score, wrong copy, and nothing to show anything had gone wrong.
  store.set(
    'nycmap:progress:2026-08-19',
    JSON.stringify({
      guesses: [
        { lng: -73.98, lat: 40.75 },
        { lng: 'x', lat: null },
        { lng: -73.86, lat: 40.75 },
      ],
    }),
  )
  expect(loadProgress('2026-08-19')?.guesses).toEqual([{ lng: -73.98, lat: 40.75 }])
})

test('NaN coordinates are rejected, not stored as numbers', () => {
  store.set(
    'nycmap:progress:2026-08-19',
    JSON.stringify({ guesses: [{ lng: null, lat: 40.75 }] }),
  )
  expect(loadProgress('2026-08-19')).toBeNull()
})

test('settings fall back sanely, including a hold duration off the menu', () => {
  expect(loadSettings()).toEqual({ carefulMode: false, holdMs: 800, colorblind: false })

  saveSettings({ carefulMode: true, holdMs: 1500, colorblind: true })
  expect(loadSettings().holdMs).toBe(1500)

  // Hand-edited to something that would make the game unplayable.
  store.set('nycmap:settings', JSON.stringify({ carefulMode: true, holdMs: 999_999 }))
  expect(loadSettings().holdMs).toBe(HOLD_OPTIONS[0])
  expect(loadSettings().carefulMode).toBe(true)

  store.set('nycmap:settings', 'null')
  expect(() => loadSettings()).not.toThrow()
})
