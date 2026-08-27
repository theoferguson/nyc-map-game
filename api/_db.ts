import postgres from 'postgres'

/**
 * The one connection factory. Files under `api/` beginning with an underscore
 * are shared modules rather than routes -- Vercel does not turn them into
 * functions, which is verified by there being seven `.func` directories and no
 * `_db.func` among them.
 *
 * `max: 1` because a serverless instance handles one request at a time. A
 * larger pool multiplies connections by instance count and exhausts the
 * server's limit long before it helps.
 *
 * Returns null rather than throwing when there is no database, so each caller
 * decides what that means: 503 for a write, shipped defaults for a read.
 */
/** Re-exported so callers can type a client without importing the driver. */
export type Db = postgres.Sql

let sql: postgres.Sql | null = null

export function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  return sql
}
