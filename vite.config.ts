import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-server endpoint that runs the codebase scanner (scanner/scan.mjs) with
// the ANTHROPIC_API_KEY from .env — the key stays server-side, never in the
// browser bundle.
function scannerApi(): Plugin {
  return {
    name: 'dotchart-scanner-api',
    configureServer(server) {
      server.middlewares.use('/api/scan', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'POST only' }))
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          const log = (s: string) => server.config.logger.info(`[dotchart scan] ${s}`)
          // NDJSON progress stream: {"status"} lines while working, then one
          // final {"done", "plan"} or {"error"} line.
          res.setHeader('content-type', 'application/x-ndjson')
          res.setHeader('cache-control', 'no-cache')
          const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n')
          try {
            const { path: targetPath } = JSON.parse(body || '{}')
            if (!targetPath || typeof targetPath !== 'string') {
              send({ error: 'Body must be {"path": "/path/to/codebase"}' })
              res.end()
              return
            }
            const { scanCodebase } = await import('./scanner/scan.mjs')
            const plan = await scanCodebase(targetPath, {
              onStatus: (s: string) => {
                log(s)
                send({ status: s })
              },
            })
            log(`Done: ${plan.events.length} events (core: ${plan.core_event}; ${plan.meta.usage.input_tokens} in / ${plan.meta.usage.output_tokens} out tokens)`)
            send({ done: true, plan })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log(`FAILED: ${msg}`)
            send({ error: msg })
          }
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), scannerApi()],
})
