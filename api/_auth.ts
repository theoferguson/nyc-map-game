import { timingSafeEqual } from 'node:crypto'

/**
 * The admin token check, in one place. It was copied into three routes, which
 * meant a fix to the comparison had three chances to be missed.
 *
 * Constant-time, so a wrong token cannot be narrowed down by how quickly it is
 * rejected. An unset ADMIN_TOKEN refuses everything rather than allowing it --
 * the failure direction matters more here than anywhere else in the codebase.
 */
export function adminTokenMatches(supplied: string | null): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
