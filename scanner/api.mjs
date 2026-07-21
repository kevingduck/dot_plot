// DotChart API router — the single implementation behind both entry points:
// the Vite dev server (local mode) and server.mjs (hosted mode, e.g. Render).
//
// Modes:
//   local  — everything enabled (filesystem browsing, local repos, local git)
//   hosted — machine-local features are disabled or restricted:
//            · /api/fs/list off (would browse the server container)
//            · analyze/instrument paths restricted to ~/.dotchart/repos
//              (GitHub clones made by this server)
//            · instrument/apply off (a branch in a server clone helps no one)
//            · Connect uses browser-side folder digests instead
//
// Auth: when a password is configured, every /api/* route except /api/mode
// requires the x-dotchart-key header. /ingest and /health are always open —
// ingest is designed for public, validated, capped writes.

import os from 'node:os'
import path from 'node:path'

const OPEN_ROUTES = new Set(['/api/mode', '/ingest', '/health'])

function reposRoot() {
  return path.join(os.homedir(), '.dotchart', 'repos')
}

function assertHostedPathAllowed(hosted, targetPath) {
  if (!hosted) return
  const resolved = path.resolve(String(targetPath ?? ''))
  if (!resolved.startsWith(reposRoot() + path.sep)) {
    throw new Error('Hosted mode can only analyze repositories connected via GitHub')
  }
}

export function createApiHandler({ log = () => {}, hosted = false, password = '' } = {}) {
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 30_000_000) req.destroy()
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'))
        } catch {
          reject(new Error('Invalid JSON body'))
        }
      })
      req.on('error', reject)
    })

  const json = (handler) => async (req, res) => {
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

  const ndjson = (handler) => async (req, res) => {
    res.setHeader('content-type', 'application/x-ndjson')
    res.setHeader('cache-control', 'no-cache')
    const send = (obj) => res.write(JSON.stringify(obj) + '\n')
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

  const routes = {
    '/api/mode': json(async () => {
      const { hasServerKey } = await import('./scan.mjs')
      return { hosted, authRequired: Boolean(password), hasServerKey: hasServerKey() }
    }),

    '/api/keycheck': json(async () => {
      const { hasServerKey } = await import('./scan.mjs')
      return { hasServerKey: hasServerKey() }
    }),

    '/api/fs/list': json(async (body) => {
      if (hosted) throw new Error('Folder browsing is a local-mode feature')
      const { listDirectory } = await import('./connect.mjs')
      return listDirectory(body.path || undefined)
    }),

    '/api/github/clone': ndjson(async (body, onStatus) => {
      if (!body.url) throw new Error('Body must be {"url": "https://github.com/owner/repo"}')
      const { cloneGithubRepo } = await import('./connect.mjs')
      return cloneGithubRepo(body.url, body.token || undefined, { onStatus })
    }),

    '/api/connect/discover': json(async (body) => {
      if (!body.path) throw new Error('Body must be {"path": "..."}')
      assertHostedPathAllowed(hosted, body.path)
      const { discoverProject } = await import('./connect.mjs')
      return discoverProject(body.path)
    }),

    '/api/connect/analyze': ndjson(async (body, onStatus) => {
      const { analyzeProject } = await import('./connect.mjs')
      const { path: targetPath, connectionString, model, apiKey, digest } = body
      if (digest) {
        // Browser-side digest (hosted local-folder flow)
        if (!digest.name || typeof digest.digest !== 'string' || !digest.digest) {
          throw new Error('Digest upload must include {name, digest, included, skipped}')
        }
        return analyzeProject(null, connectionString || undefined, { onStatus, model, apiKey, prebuilt: digest })
      }
      if (!targetPath) throw new Error('Body must include a path or a digest')
      assertHostedPathAllowed(hosted, targetPath)
      return analyzeProject(targetPath, connectionString || undefined, { onStatus, model, apiKey })
    }),

    '/api/instrument/prepare': ndjson(async (body, onStatus) => {
      const { path: targetPath, events, model, apiKey } = body
      if (!targetPath || !Array.isArray(events) || events.length === 0) {
        throw new Error('Body must be {"path": "...", "events": [...accepted plan events]}')
      }
      assertHostedPathAllowed(hosted, targetPath)
      const { prepareInstrumentation } = await import('./instrument.mjs')
      const prep = await prepareInstrumentation(targetPath, events, { onStatus, model, apiKey })
      onStatus(`Prepared ${prep.edits.length} edits (${prep.edits.filter((e) => e.status === 'ok').length} clean)`)
      return prep
    }),

    '/api/instrument/apply': json(async (body) => {
      if (hosted) throw new Error('Applying branches is a local-mode feature — use Export accepted plan + the local app, or GitHub push (coming)')
      const { path: targetPath, sdkFile, edits } = body
      if (!targetPath || !Array.isArray(edits)) throw new Error('Body must be {"path", "sdkFile", "edits"}')
      const { applyInstrumentation } = await import('./instrument.mjs')
      const result = applyInstrumentation(targetPath, { sdkFile, edits })
      log(`Instrumentation branch ${result.branch} created (${result.applied.length} edits, base ${result.baseBranch})`)
      return result
    }),

    '/api/db/scan': json(async (body) => {
      if (!body.connectionString) throw new Error('Body must be {"connectionString": "postgres://…"}')
      const { scanDatabase } = await import('./dbscan.mjs')
      log('DB scan (read-only) starting…')
      const out = await scanDatabase(body.connectionString)
      log(`DB scan done: ${out.tables.length} tables (${out.tables.filter((t) => t.eligible).length} eligible)`)
      return out
    }),

    '/api/db/import': json(async (body) => {
      const { connectionString, mappings, days } = body
      if (!connectionString || !Array.isArray(mappings) || mappings.length === 0) {
        throw new Error('Body must be {"connectionString", "mappings": [...]}')
      }
      const { importFromDatabase } = await import('./dbscan.mjs')
      const out = await importFromDatabase(connectionString, mappings, { days: days ?? 90 })
      log(`DB import: ${out.events.length} events from ${mappings.length} tables`)
      return out
    }),

    '/api/projects/save': json(async (body) => {
      const { saveWorkspace } = await import('./projects.mjs')
      return saveWorkspace(body)
    }),
    '/api/projects/list': json(async () => {
      const { listWorkspaces } = await import('./projects.mjs')
      return { projects: listWorkspaces() }
    }),
    '/api/projects/load': json(async (body) => {
      const { loadWorkspace } = await import('./projects.mjs')
      return loadWorkspace(String(body.slug ?? ''))
    }),
    '/api/projects/delete': json(async (body) => {
      const { deleteWorkspace } = await import('./projects.mjs')
      deleteWorkspace(String(body.slug ?? ''))
      return { ok: true }
    }),

    '/api/insights': json(async (body) => {
      if (!body.summary) throw new Error('Body must include a usage summary')
      const { findInsights } = await import('./insights.mjs')
      const out = await findInsights(body.summary, { model: body.model, apiKey: body.apiKey })
      log(`insights: ${out.insights.length} found (${out.meta.usage.input_tokens} in / ${out.meta.usage.output_tokens} out tokens)`)
      return out
    }),

    '/api/store/events': json(async (body) => {
      const { readEvents, storeInfo } = await import('./store.mjs')
      if (body.countOnly) return storeInfo()
      const events = readEvents().map((e) => ({ userId: e.user_id, event: e.event, ts: e.ts }))
      return { events, count: events.length }
    }),
    '/api/store/clear': json(async () => {
      const { clearStore } = await import('./store.mjs')
      clearStore()
      log('store cleared')
      return { ok: true }
    }),

    '/api/scan': ndjson(async (body, onStatus) => {
      const { path: targetPath, model, apiKey } = body
      if (!targetPath || typeof targetPath !== 'string') throw new Error('Body must be {"path": "/path/to/codebase"}')
      assertHostedPathAllowed(hosted, targetPath)
      const { scanCodebase } = await import('./scan.mjs')
      return scanCodebase(targetPath, { model, apiKey, onStatus })
    }),
  }

  /** Handle the request if it's ours; returns true when handled. */
  return async function handle(req, res) {
    const url = (req.url ?? '').split('?')[0]

    if (url === '/health') {
      const { storeInfo } = await import('./store.mjs')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, service: 'dotchart', hosted, events_stored: storeInfo().count }))
      return true
    }

    if (url === '/ingest') {
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return true
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return true
      }
      try {
        const body = await readBody(req)
        const { normalizeEvent, appendEvents } = await import('./store.mjs')
        const raw = Array.isArray(body.events) ? body.events : [body]
        const valid = raw.slice(0, 1000).map(normalizeEvent).filter(Boolean)
        const n = appendEvents(valid)
        if (n > 0) log(`ingest: ${n} event${n === 1 ? '' : 's'} received`)
        res.statusCode = 202
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, received: n }))
      } catch (err) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
      return true
    }

    const route = routes[url]
    if (!route) return false

    if (password && !OPEN_ROUTES.has(url)) {
      const provided = req.headers['x-dotchart-key']
      if (provided !== password) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Password required — set it under ⚙ Settings', authRequired: true }))
        return true
      }
    }

    await route(req, res)
    return true
  }
}
