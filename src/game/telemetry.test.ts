import { test, expect, beforeEach, vi } from 'vitest'

// jsdom is not installed; a minimal localStorage is all telemetry touches.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
})
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
vi.stubGlobal('document', { referrer: '' })
vi.stubGlobal('window', { location: { search: '?utm_source=twitter&utm_medium=social' } })
vi.stubGlobal('navigator', { language: 'en-US' })

const { track, drain } = await import('./telemetry')
const { imageryVariant, VARIANTS } = await import('../map/tiles')

beforeEach(() => store.clear())

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
