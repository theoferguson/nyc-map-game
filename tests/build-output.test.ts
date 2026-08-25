import { test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The serverless functions are compiled, not bundled, and the compiler emits
 * import specifiers exactly as written. A relative `.ts` import therefore passes
 * `tsc -b`, passes `vercel build`, works under `vercel dev` -- which runs the
 * TypeScript directly -- and then fails in production with
 * FUNCTION_INVOCATION_FAILED, because the file beside it is `.js`.
 *
 * Every layer said yes and production said no. This is the check that would
 * have said no first.
 */
const files = readdirSync('api')
  .filter((f) => f.endsWith('.ts') && f !== 'tsconfig.json')
  .filter((f) => statSync(join('api', f)).isFile())

test.each(files)('%s imports no relative .ts path', (file) => {
  const source = readFileSync(join('api', file), 'utf8')
  const specifiers = [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
  const offenders = specifiers.filter((s) => s.endsWith('.ts'))
  expect(offenders, `use .js under nodenext; the compiler emits it verbatim`).toEqual([])
})
