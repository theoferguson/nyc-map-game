import type { Plugin, ViteDevServer } from 'vite'
import { readdirSync } from 'node:fs'

/**
 * Serves `api/*.ts` during `npm run dev`.
 *
 * Without it, Vite matches `/api/puzzle` to the file on disk, transpiles it and
 * returns the serverless function's *source* as JavaScript with a 200. The
 * client's `res.json()` then throws and the player is told "No puzzle for
 * today yet" -- a broken game blaming the content, which was every new
 * contributor's first experience of the project.
 *
 * Development only. In production Vercel compiles each file in `api/` into its
 * own function and this plugin is not part of the build.
 *
 * `DEV_SAMPLE_CONTENT` is set by the `dev` script rather than here: vitest
 * starts its own Vite server, so anything this plugin puts in `process.env`
 * leaks into the test run -- which it did, turning an endpoint's "no database"
 * assertion green for the wrong reason.
 */
export function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const routes = new Set(
        readdirSync('api')
          .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
          .map((f) => f.replace(/\.ts$/, '')),
      )

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const name = url.pathname.replace(/^\/api\//, '')
        if (!url.pathname.startsWith('/api/') || !routes.has(name)) return next()

        try {
          // Loaded through Vite so edits to a handler take effect without a
          // restart, exactly as they do for the client.
          const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<
            string,
            ((req: Request) => Promise<Response>) | undefined
          >
          const handler = mod[req.method ?? 'GET']
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }

          const body =
            req.method === 'GET' || req.method === 'HEAD'
              ? undefined
              : await new Promise<string>((resolve) => {
                  let text = ''
                  req.on('data', (chunk) => (text += chunk))
                  req.on('end', () => resolve(text))
                })

          const response = await handler(
            new Request(`http://localhost${req.url}`, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              body,
            }),
          )

          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
        } catch (e) {
          // Surfaced rather than swallowed: a handler that throws in dev should
          // say so, not fall through to the SPA and look like a routing bug.
          server.config.logger.error(`[dev-api] ${name}: ${(e as Error).stack ?? e}`)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'handler threw', detail: String(e) }))
        }
      })
    },
  }
}
