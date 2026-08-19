/** Difficulty climbs across the day, so later rounds are worth more. Max 1000. */
export const MULTIPLIERS = [1, 1, 2, 3, 3]

export const MAX_TOTAL = MULTIPLIERS.reduce((n, m) => n + m * 100, 0)

export type RoundResult = { score: number; distanceM: number }

export function totalScore(results: RoundResult[]): number {
  return results.reduce((sum, r, i) => sum + r.score * (MULTIPLIERS[i] ?? 1), 0)
}

/** Bands are per-round and pre-multiplier, so the squares read as accuracy. */
const band = (score: number) =>
  score >= 80 ? '🟩' : score >= 50 ? '🟨' : score >= 20 ? '🟧' : '⬜'

/**
 * The block average is the line people quote at each other, so it uses the short
 * north-south block (~80m) as a plain unit rather than trying to average across
 * two axes of wildly different size.
 */
const SHORT_BLOCK_M = 80

export function shareString(puzzleNumber: number, results: RoundResult[]): string {
  const avgBlocks =
    results.reduce((sum, r) => sum + r.distanceM, 0) / results.length / SHORT_BLOCK_M

  return [
    `NYC Daily #${puzzleNumber} — ${totalScore(results)}/${MAX_TOTAL}`,
    results.map((r) => band(r.score)).join(''),
    `avg ${avgBlocks.toFixed(1)} blocks off`,
  ].join('\n')
}
