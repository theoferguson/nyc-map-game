import { test, expect } from 'vitest'
import { validateDay, inBounds, type DayLocation } from '../src/data/validateDay.ts'

const at = (i: number, over: Partial<DayLocation> = {}): DayLocation => ({
  id: `loc-${i}`,
  name: `Place ${i}`,
  prompt: `Place ${i}`,
  lat: 40.75,
  lng: -73.98,
  class: 'landmark',
  borough: i < 2 ? 'brooklyn' : 'manhattan',
  difficulty: i + 1,
  tags: ['a', 'b', 'c'],
  factShort: 'x'.repeat(60),
  sourceUrl: 'https://example.org',
  sourceAttribution: 'Example',
  ...over,
})

const day = (over: Partial<DayLocation>[] = []) =>
  Array.from({ length: 5 }, (_, i) => at(i, over[i] ?? {}))

test('a well-formed day has nothing to say about it', () => {
  expect(validateDay(day())).toEqual([])
})

test('the Staten Island Ferry would not have got through', () => {
  // A real coordinate, in the right city, in open water. Every numeric check
  // passed; only the bounds of New York would have caught it, and it was
  // inside them. This is the case the map exists for -- but the coordinate
  // being outside NYC entirely is still worth refusing outright.
  const problems = validateDay(day([{ lat: 41.5, lng: -74.2 }]))
  expect(problems.join(' ')).toMatch(/outside New York/)
})

test('difficulty has to climb', () => {
  const scrambled = day()
  scrambled[2].difficulty = 1
  expect(validateDay(scrambled).join(' ')).toMatch(/does not climb/)
})

test('a day cannot become all Manhattan', () => {
  expect(validateDay(day([{ borough: 'manhattan' }, { borough: 'manhattan' }])).join(' '))
    .toMatch(/outside Manhattan/)
})

test('the fields a player sees cannot be emptied', () => {
  const problems = validateDay(day([{ prompt: '', factShort: 'too short', tags: ['one'] }]))
  expect(problems.join(' ')).toMatch(/no prompt/)
  expect(problems.join(' ')).toMatch(/fact is too short/)
  expect(problems.join(' ')).toMatch(/3 or more tags/)
})

test('a repeated id would score two rounds against one place', () => {
  const dup = day()
  dup[3].id = dup[1].id
  expect(validateDay(dup).join(' ')).toMatch(/repeated id/)
})

test('bounds match the extent the map clamps to', () => {
  expect(inBounds(40.7484, -73.9857)).toBe(true)   // Empire State
  expect(inBounds(40.6626, -74.0521)).toBe(true)   // the ferry: inside, and wrong
  expect(inBounds(40.75, -74.9)).toBe(false)       // New Jersey
})
