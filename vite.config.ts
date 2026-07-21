import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-server endpoint that runs the codebase scanner (scanner/scan.mjs) with
// the ANTHROPIC_API_KEY from .env — the key stays server-side, never in the
// browser bundle.
function scannerApi(): Plugin {
  return {
    name: 'dotchart-scanner-api',
    configureServer(server) {
      const log = (s: string) => server.config.logger.info(`[dotchart] ${s}`)

      const readBody = (req: import('http').IncomingMessage): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            try {
              resolve(JSON.parse(body || '{}'))
            } catch {
              reject(new Error('Invalid JSON body'))
            }
          })
        })

      // JSON endpoint helper
      const json = (handler: (body: Record<string, unknown>) => Promise<unknown>) =>
        async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
          res.setHeader('content-type', 'application/json')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ error: 'POST only' }))
            return
          }
          try {
            res.end(JSON.stringify(await handler(await readBody(req))))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log(`ERROR: ${msg}`)
            res.statusCode = 500
            res.end(JSON.stringify({ error: msg }))
          }
        }

      // NDJSON streaming endpoint helper (status lines, then done/error)
      const ndjson = (
        handler: (body: Record<string, unknown>, onStatus: (s: string) => void) => Promise<unknown>,
      ) =>
        async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
          res.setHeader('content-type', 'application/x-ndjson')
          res.setHeader('cache-control', 'no-cache')
          const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n')
          try {
            const result = await handler(await readBody(req), (s) => {
              log(s)
              send({ status: s })
            })
            send({ done: true, result })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log(`FAILED: ${msg}`)
            send({ error: msg })
          }
          res.end()
        }

      // Does the dev server have its own API key? (UI shows key field if not)
      server.middlewares.use(
        '/api/keycheck',
        json(async () => {
          const { hasServerKey } = await import('./scanner/scan.mjs')
          return { hasServerKey: hasServerKey() }
        }),
      )

      // Folder picker: list directories on this machine
      server.middlewares.use(
        '/api/fs/list',
        json(async (body) => {
          const { path: targetPath } = body as { path?: string }
          const { listDirectory } = await import('./scanner/connect.mjs')
          return listDirectory(targetPath || undefined)
        }),
      )

      // Clone (or refresh) a GitHub repo locally; token used once, never stored
      server.middlewares.use(
        '/api/github/clone',
        ndjson(async (body, onStatus) => {
          const { url, token } = body as { url?: string; token?: string }
          if (!url) throw new Error('Body must be {"url": "https://github.com/owner/repo"}')
          const { cloneGithubRepo } = await import('./scanner/connect.mjs')
          return cloneGithubRepo(url, token || undefined, { onStatus })
        }),
      )

      // Connect wizard: fast local discovery (no AI)
      server.middlewares.use(
        '/api/connect/discover',
        json(async (body) => {
          const { path: targetPath } = body as { path?: string }
          if (!targetPath) throw new Error('Body must be {"path": "..."}')
          const { discoverProject } = await import('./scanner/connect.mjs')
          return discoverProject(targetPath)
        }),
      )

      // Connect wizard: unified code + schema analysis (streams progress)
      server.middlewares.use(
        '/api/connect/analyze',
        ndjson(async (body, onStatus) => {
          const { path: targetPath, connectionString, model, apiKey } = body as {
            path?: string
            connectionString?: string
            model?: string
            apiKey?: string
          }
          if (!targetPath) throw new Error('Body must be {"path": "...", "connectionString?": "..."}')
          const { analyzeProject } = await import('./scanner/connect.mjs')
          return analyzeProject(targetPath, connectionString || undefined, { onStatus, model, apiKey })
        }),
      )

      // Propose instrumentation edits (read-only; streams progress)
      server.middlewares.use(
        '/api/instrument/prepare',
        ndjson(async (body, onStatus) => {
          const { path: targetPath, events, model, apiKey } = body as {
            path?: string
            events?: unknown[]
            model?: string
            apiKey?: string
          }
          if (!targetPath || !Array.isArray(events) || events.length === 0) {
            throw new Error('Body must be {"path": "...", "events": [...accepted plan events]}')
          }
          const { prepareInstrumentation } = await import('./scanner/instrument.mjs')
          const prep = await prepareInstrumentation(targetPath, events, { onStatus, model, apiKey })
          onStatus(`Prepared ${prep.edits.length} edits (${prep.edits.filter((e: { status: string }) => e.status === 'ok').length} clean)`)
          return prep
        }),
      )

      // Apply approved edits on a new git branch
      server.middlewares.use(
        '/api/instrument/apply',
        json(async (body) => {
          const { path: targetPath, sdkFile, edits } = body as {
            path?: string
            sdkFile?: { path: string; content: string }
            edits?: unknown[]
          }
          if (!targetPath || !Array.isArray(edits)) throw new Error('Body must be {"path", "sdkFile", "edits"}')
          const { applyInstrumentation } = await import('./scanner/instrument.mjs')
          const result = applyInstrumentation(targetPath, { sdkFile, edits })
          log(`Instrumentation branch ${result.branch} created (${result.applied.length} edits, base ${result.baseBranch})`)
          return result
        }),
      )

      // Read-only DB schema scan → suggested table→event mappings
      server.middlewares.use(
        '/api/db/scan',
        json(async (body) => {
          const { connectionString } = body as { connectionString?: string }
          if (!connectionString) throw new Error('Body must be {"connectionString": "postgres://…"}')
          const { scanDatabase } = await import('./scanner/dbscan.mjs')
          log('DB scan (read-only) starting…')
          const out = await scanDatabase(connectionString)
          log(`DB scan done: ${out.tables.length} tables (${out.tables.filter((t: { eligible: boolean }) => t.eligible).length} eligible)`)
          return out
        }),
      )

      // Read-only event import for approved mappings
      server.middlewares.use(
        '/api/db/import',
        json(async (body) => {
          const { connectionString, mappings, days } = body as {
            connectionString?: string
            mappings?: unknown[]
            days?: number
          }
          if (!connectionString || !Array.isArray(mappings) || mappings.length === 0) {
            throw new Error('Body must be {"connectionString", "mappings": [...]}')
          }
          const { importFromDatabase } = await import('./scanner/dbscan.mjs')
          const out = await importFromDatabase(connectionString, mappings, { days: days ?? 90 })
          log(`DB import: ${out.events.length} events from ${mappings.length} tables`)
          return out
        }),
      )

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
            const { path: targetPath, model, apiKey } = JSON.parse(body || '{}')
            if (!targetPath || typeof targetPath !== 'string') {
              send({ error: 'Body must be {"path": "/path/to/codebase"}' })
              res.end()
              return
            }
            const { scanCodebase } = await import('./scanner/scan.mjs')
            const plan = await scanCodebase(targetPath, {
              model,
              apiKey,
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
