import { haversine, roundScore, describeMiss, type LngLat } from './scoring'
import type { PuzzleLocation } from '../data/loadPuzzle'

export type Result = { guess: LngLat; distanceM: number; score: number; copy: string }

/**
 * The one place a guess becomes a result. Resume replays saved taps through
 * this, so a restored game and a live one cannot drift apart.
 */
export function scoreGuess(guess: LngLat, location: PuzzleLocation): Result {
  const answer = { lng: location.lng, lat: location.lat }
  const distanceM = haversine(guess, answer)
  return {
    guess,
    distanceM,
    score: roundScore(distanceM, location.class),
    copy: describeMiss(guess, answer),
  }
}
