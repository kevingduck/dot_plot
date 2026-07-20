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
          res.setHeader('content-type', 'application/json')
          try {
            const { path: targetPath } = JSON.parse(body || '{}')
            if (!targetPath || typeof targetPath !== 'string') {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be {"path": "/path/to/codebase"}' }))
              return
            }
            const { scanCodebase } = await import('./scanner/scan.mjs')
            const plan = await scanCodebase(targetPath, {
              onStatus: (s: string) => server.config.logger.info(`[dotchart scan] ${s}`),
            })
            res.end(JSON.stringify(plan))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), scannerApi()],
})
