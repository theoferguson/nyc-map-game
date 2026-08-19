/** Difficulty climbs across the day, so later rounds are worth more. Max 1000. */
export const MULTIPLIERS = [1, 1, 2, 3, 3]

export const MAX_TOTAL = MULTIPLIERS.reduce((n, m) => n + m * 100, 0)

export type RoundResult = { score: number; distanceM: number }

export function totalScore(results: RoundResult[]): number {
  return results.reduce((sum, r, i) => sum + r.score * (MULTIPLIERS[i] ?? 1), 0)
}

/**
 * Bands are per-round and pre-multiplier, so the squares read as accuracy.
 *
 * The colourblind set is not a recoloured palette but a different encoding: how
 * full the circle is, rather than what colour the square is. Green/yellow/orange
 * is precisely the axis red-green colourblindness collapses, so swapping hues
 * would still leave three of the four bands indistinguishable to the people the
 * setting exists for. Fill survives being seen in greyscale.
 */
const COLOUR = ['⬜', '🟧', '🟨', '🟩']
const SHAPES = ['○', '◔', '◕', '●']

const bandIndex = (score: number) =>
  score >= 80 ? 3 : score >= 50 ? 2 : score >= 20 ? 1 : 0

/**
 * The block line is the one people quote at each other, so it uses the short
 * north-south block (~80m) as a plain unit rather than averaging across two axes
 * of wildly different size.
 */
const SHORT_BLOCK_M = 80

/**
 * Median, not mean. Distances here are wildly skewed -- four good rounds and one
 * guess in the wrong borough is a common shape, and the mean lets that single
 * round define the line. A strong game was printing "855/1000" beside "avg 9.9
 * blocks off", two numbers telling opposite stories about the same play.
 */
function medianBlocks(results: RoundResult[]): number {
  const sorted = results.map((r) => r.distanceM).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return median / SHORT_BLOCK_M
}

export function shareString(
  puzzleNumber: number,
  results: RoundResult[],
  colorblind = false,
): string {
  const blocks = medianBlocks(results)
  const set = colorblind ? SHAPES : COLOUR
  return [
    `NYC Daily #${puzzleNumber} — ${totalScore(results)}/${MAX_TOTAL}`,
    results.map((r) => set[bandIndex(r.score)]).join(''),
    `median ${blocks < 1 ? blocks.toFixed(1) : Math.round(blocks)} blocks off`,
  ].join('\n')
}
