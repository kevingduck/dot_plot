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

export function createApiHandler({ log = () => {}, hosted = false, password = '', authMode = false } = {}) {
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

  // ctx = { user, req, res } — user is set in account mode (DOTCHART_AUTH=1)
  const json = (handler) => async (req, res, ctx) => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'POST only' }))
      return
    }
    try {
      const out = await handler(await readBody(req), ctx)
      if (out && typeof out === 'object' && out._setCookie) {
        res.setHeader('set-cookie', out._setCookie)
        delete out._setCookie
      }
      res.end(JSON.stringify(out))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`ERROR: ${msg}`)
      res.statusCode = 500
      res.end(JSON.stringify({ error: msg }))
    }
  }

  const ndjson = (handler) => async (req, res, ctx) => {
    res.setHeader('content-type', 'application/x-ndjson')
    res.setHeader('cache-control', 'no-cache')
    const send = (obj) => res.write(JSON.stringify(obj) + '\n')
    try {
      const result = await handler(
        await readBody(req),
        (s) => {
          log(s)
          send({ status: s })
        },
        ctx,
      )
      send({ done: true, result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`FAILED: ${msg}`)
      send({ error: msg })
    }
    res.end()
  }

  /** In account mode the server's env API keys are reserved for the instance owner (first account). */
  const allowEnvKeyFor = async (ctx) => {
    if (!authMode) return true
    if (!ctx?.user) return false
    const { firstUserId } = await import('./auth.mjs')
    return ctx.user.id === firstUserId()
  }

  const effectiveServerKeys = async (ctx) => {
    const { serverKeys } = await import('./llm.mjs')
    return (await allowEnvKeyFor(ctx)) ? serverKeys() : { anthropic: false, openai: false }
  }

  /** Workspace dir for this request: the user's own in account mode, legacy otherwise. */
  const projectsDirOf = async (ctx) => {
    if (!authMode || !ctx?.user) return undefined // module default (legacy shared dir)
    const { userProjectsDir } = await import('./auth.mjs')
    return userProjectsDir(ctx.user.id)
  }

  const routes = {
    '/api/mode': json(async (_body, ctx) => {
      const keys = await effectiveServerKeys(ctx)
      return {
        hosted,
        authRequired: Boolean(password) && !authMode,
        authMode,
        user: ctx?.user ? { email: ctx.user.email } : null,
        githubOauth: authMode && Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        hasServerKey: keys.anthropic,
        serverKeys: keys,
      }
    }),

    '/api/auth/signup': json(async (body) => {
      if (!authMode) throw new Error('Accounts are not enabled on this DotChart')
      const { signup, sessionCookie } = await import('./auth.mjs')
      const user = signup(body.email, body.password)
      return { user, _setCookie: sessionCookie(user.id) }
    }),

    '/api/auth/login': json(async (body) => {
      if (!authMode) throw new Error('Accounts are not enabled on this DotChart')
      const { login, sessionCookie } = await import('./auth.mjs')
      const user = login(body.email, body.password)
      return { user, _setCookie: sessionCookie(user.id) }
    }),

    '/api/auth/logout': json(async () => {
      const { clearSessionCookie } = await import('./auth.mjs')
      return { ok: true, _setCookie: clearSessionCookie() }
    }),

    '/api/keycheck': json(async (_body, ctx) => {
      const keys = await effectiveServerKeys(ctx)
      return { hasServerKey: keys.anthropic, serverKeys: keys }
    }),

    // Validate a provider config without a paid call: key check for
    // Anthropic/OpenAI (their free models endpoints), reachability + model
    // list for Ollama. The wizard and Settings both use this.
    '/api/keytest': json(async (body) => {
      const { testProvider } = await import('./llm.mjs')
      return testProvider({ provider: body.provider ?? 'anthropic', apiKey: body.apiKey, baseUrl: body.baseUrl })
    }),

    // Browser-side LLM transport (hosted mode + the user's local Ollama):
    // prepare returns the exact request the server would have sent; the
    // browser runs it against localhost Ollama; finish post-processes the raw
    // output into the same result the server-side path produces.
    '/api/ai/prepare': ndjson(async (body, onStatus) => {
      if (body.task === 'insights') {
        if (!body.summary) throw new Error('insights prepare needs a summary')
        const { buildInsightsRequest } = await import('./insights.mjs')
        return { request: buildInsightsRequest(body.summary), ctx: {} }
      }
      if (body.task === 'connect') {
        const { buildAnalysisRequest } = await import('./connect.mjs')
        const { path: targetPath, connectionString, digest } = body
        if (digest) {
          if (!digest.name || typeof digest.digest !== 'string' || !digest.digest) {
            throw new Error('Digest upload must include {name, digest, included, skipped}')
          }
          return buildAnalysisRequest(null, connectionString || undefined, { onStatus, prebuilt: digest })
        }
        if (!targetPath) throw new Error('connect prepare needs a path or a digest')
        assertHostedPathAllowed(hosted, targetPath)
        return buildAnalysisRequest(targetPath, connectionString || undefined, { onStatus })
      }
      throw new Error(`Unknown AI task: ${body.task}`)
    }),

    '/api/ai/finish': json(async (body) => {
      const { task, output, ctx, model, provider, usage } = body
      let object = output
      if (typeof output === 'string') {
        try {
          object = JSON.parse(output)
        } catch {
          throw new Error('The local model did not return valid JSON — try a larger model or a cloud provider')
        }
      }
      const meta = { model: String(model ?? ''), provider: String(provider ?? 'ollama'), usage }
      if (task === 'insights') {
        const { finishInsights } = await import('./insights.mjs')
        return finishInsights(object, meta)
      }
      if (task === 'connect') {
        const { finishAnalysis } = await import('./connect.mjs')
        return finishAnalysis(object, ctx ?? {}, meta)
      }
      throw new Error(`Unknown AI task: ${task}`)
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

    '/api/connect/analyze': ndjson(async (body, onStatus, ctx) => {
      const { analyzeProject } = await import('./connect.mjs')
      const { path: targetPath, connectionString, model, apiKey, provider, baseUrl, digest } = body
      const aiOpts = { onStatus, model, apiKey, provider, baseUrl, allowEnvKey: await allowEnvKeyFor(ctx) }
      if (digest) {
        // Browser-side digest (hosted local-folder flow)
        if (!digest.name || typeof digest.digest !== 'string' || !digest.digest) {
          throw new Error('Digest upload must include {name, digest, included, skipped}')
        }
        return analyzeProject(null, connectionString || undefined, { ...aiOpts, prebuilt: digest })
      }
      if (!targetPath) throw new Error('Body must include a path or a digest')
      assertHostedPathAllowed(hosted, targetPath)
      return analyzeProject(targetPath, connectionString || undefined, aiOpts)
    }),

    '/api/instrument/prepare': ndjson(async (body, onStatus, ctx) => {
      const { path: targetPath, events, model, apiKey, provider, baseUrl } = body
      if (!targetPath || !Array.isArray(events) || events.length === 0) {
        throw new Error('Body must be {"path": "...", "events": [...accepted plan events]}')
      }
      assertHostedPathAllowed(hosted, targetPath)
      const { prepareInstrumentation } = await import('./instrument.mjs')
      const prep = await prepareInstrumentation(targetPath, events, { onStatus, model, apiKey, provider, baseUrl, allowEnvKey: await allowEnvKeyFor(ctx) })
      onStatus(`Prepared ${prep.edits.length} edits (${prep.edits.filter((e) => e.status === 'ok').length} clean)`)
      return prep
    }),

    '/api/instrument/apply': json(async (body) => {
      const { path: targetPath, sdkFile, edits, pushToken } = body
      if (!targetPath || !Array.isArray(edits)) throw new Error('Body must be {"path", "sdkFile", "edits"}')
      const { applyInstrumentation, pushBranch } = await import('./instrument.mjs')
      if (hosted) {
        // Hosted CAN create branches for GitHub-connected projects: the clone
        // lives on this server; the branch is pushed with a one-time token.
        assertHostedPathAllowed(hosted, targetPath)
        if (!pushToken) {
          throw new Error('A GitHub token with write access to the repo is needed to push the branch (used once, never stored)')
        }
        const result = applyInstrumentation(targetPath, { sdkFile, edits })
        const { compareUrl } = pushBranch(targetPath, result.branch, result.baseBranch, pushToken)
        log(`Instrumentation branch ${result.branch} pushed to GitHub (${result.applied.length} edits)`)
        return { ...result, pushed: true, compareUrl }
      }
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

    '/api/projects/save': json(async (body, ctx) => {
      const { saveWorkspace } = await import('./projects.mjs')
      const out = saveWorkspace(body, await projectsDirOf(ctx))
      if (authMode) (await import('./auth.mjs')).invalidateTokenCache()
      return out
    }),
    '/api/projects/list': json(async (_body, ctx) => {
      const { listWorkspaces } = await import('./projects.mjs')
      return { projects: listWorkspaces(await projectsDirOf(ctx)) }
    }),
    '/api/projects/load': json(async (body, ctx) => {
      const { loadWorkspace } = await import('./projects.mjs')
      return loadWorkspace(String(body.slug ?? ''), await projectsDirOf(ctx))
    }),
    '/api/projects/delete': json(async (body, ctx) => {
      const { deleteWorkspace } = await import('./projects.mjs')
      deleteWorkspace(String(body.slug ?? ''), await projectsDirOf(ctx))
      return { ok: true }
    }),

    '/api/insights': json(async (body, ctx) => {
      if (!body.summary) throw new Error('Body must include a usage summary')
      const { findInsights } = await import('./insights.mjs')
      const out = await findInsights(body.summary, { model: body.model, apiKey: body.apiKey, provider: body.provider, baseUrl: body.baseUrl, allowEnvKey: await allowEnvKeyFor(ctx) })
      log(`insights: ${out.insights.length} found (${out.meta.usage.input_tokens} in / ${out.meta.usage.output_tokens} out tokens)`)
      return out
    }),

    '/api/store/events': json(async (body, ctx) => {
      const { readEvents, storeInfo } = await import('./store.mjs')
      // Account mode: a project's own token stream + the adopted legacy
      // stream (key-scoped client-side, same as before accounts)
      const files = []
      if (authMode && ctx?.user) {
        const { projectEventsFile, userRoot } = await import('./auth.mjs')
        const path = await import('node:path')
        const slug = String(body.project ?? '')
        if (/^[a-z0-9-]+$/.test(slug)) files.push(projectEventsFile(ctx.user.id, slug))
        files.push(path.default.join(userRoot(ctx.user.id), 'events-legacy.jsonl'))
      } else {
        files.push(undefined) // legacy shared store
      }
      if (body.countOnly) {
        const infos = files.map((f) => storeInfo(f))
        return {
          count: infos.reduce((n, i) => n + i.count, 0),
          lastReceived: infos.map((i) => i.lastReceived).filter(Boolean).sort().pop() ?? null,
        }
      }
      const events = files
        .flatMap((f) => readEvents(f))
        .sort((a, b) => a.ts - b.ts)
        .map((e) => ({ userId: e.user_id, event: e.event, ts: e.ts, os: e.os, browser: e.browser, device: e.device }))
      return { events, count: events.length }
    }),
    '/api/store/clear': json(async (body, ctx) => {
      const { clearStore } = await import('./store.mjs')
      if (authMode && ctx?.user) {
        const { projectEventsFile, userRoot, invalidateTokenCache } = await import('./auth.mjs')
        const path = await import('node:path')
        const slug = String(body.project ?? '')
        if (/^[a-z0-9-]+$/.test(slug)) clearStore(projectEventsFile(ctx.user.id, slug))
        clearStore(path.default.join(userRoot(ctx.user.id), 'events-legacy.jsonl'))
        invalidateTokenCache()
      } else {
        clearStore()
      }
      log('store cleared')
      return { ok: true }
    }),

    '/api/scan': ndjson(async (body, onStatus, ctx) => {
      const { path: targetPath, model, apiKey, provider, baseUrl } = body
      if (!targetPath || typeof targetPath !== 'string') throw new Error('Body must be {"path": "/path/to/codebase"}')
      assertHostedPathAllowed(hosted, targetPath)
      const { scanCodebase } = await import('./scan.mjs')
      return scanCodebase(targetPath, { model, apiKey, provider, baseUrl, onStatus, allowEnvKey: await allowEnvKeyFor(ctx) })
    }),
  }

  /** Handle the request if it's ours; returns true when handled. */
  return async function handle(req, res) {
    const url = (req.url ?? '').split('?')[0]

    // Account mode: resolve the session before anything else
    let user = null
    if (authMode) {
      const { sessionUser } = await import('./auth.mjs')
      user = sessionUser(req.headers.cookie)
    }
    const ctx = { user, req, res }

    // GitHub OAuth (GET redirects; only when accounts + env creds exist)
    if (authMode && req.method === 'GET' && (url === '/api/auth/github' || url === '/api/auth/github/callback')) {
      await handleGithubOauth(url, req, res, log)
      return true
    }

    // Documentation pages — always open (no user data), rendered from docs/*.md
    if (url === '/docs' || url.startsWith('/docs/')) {
      if (req.method !== 'GET') return false
      const { renderDocsPage } = await import('./docs.mjs')
      const html = renderDocsPage(url === '/docs' ? '' : decodeURIComponent(url.slice('/docs/'.length)))
      res.statusCode = html ? 200 : 404
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(html ?? '<!doctype html><title>Not found</title><p>No such docs page — <a href="/docs">index</a>')
      return true
    }

    if (url === '/health') {
      const { storeInfo } = await import('./store.mjs')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, service: 'dotchart', hosted, events_stored: storeInfo().count }))
      return true
    }

    if (url === '/ingest' || url.startsWith('/ingest/')) {
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
        // Account mode routes by per-project token (/ingest/<token>); a
        // tokenless POST falls back to the first account's legacy stream so
        // pre-accounts pipelines keep flowing after the switch.
        let file // undefined = legacy shared store
        if (authMode) {
          const { resolveIngestToken, projectEventsFile, firstUserId, userRoot } = await import('./auth.mjs')
          const token = url.startsWith('/ingest/') ? url.slice('/ingest/'.length) : ''
          if (token) {
            const target = resolveIngestToken(token)
            if (!target) {
              res.statusCode = 404
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ error: 'Unknown ingest token — copy the ingest URL from your project in DotChart' }))
              return true
            }
            file = projectEventsFile(target.userId, target.slug)
          } else {
            const uid = firstUserId()
            if (!uid) {
              res.statusCode = 400
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ error: 'This DotChart uses per-project ingest URLs — sign up, then copy your project ingest URL' }))
              return true
            }
            const path = await import('node:path')
            file = path.default.join(userRoot(uid), 'events-legacy.jsonl')
          }
        }
        const body = await readBody(req)
        const { normalizeEvent, appendEvents } = await import('./store.mjs')
        const { parseUserAgent } = await import('./ua.mjs')
        // Browser-sent events carry the end user's device for free
        const ua = parseUserAgent(req.headers['user-agent'])
        const raw = Array.isArray(body.events) ? body.events : [body]
        const valid = raw.slice(0, 1000).map((e) => normalizeEvent(e, ua)).filter(Boolean)
        const n = appendEvents(valid, file)
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

    if (authMode) {
      // Accounts supersede the shared password: everything except the open
      // routes and the auth endpoints needs a session
      if (!user && !OPEN_ROUTES.has(url) && !url.startsWith('/api/auth/')) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Log in to use this DotChart', authRequired: 'account' }))
        return true
      }
    } else if (password && !OPEN_ROUTES.has(url)) {
      const provided = req.headers['x-dotchart-key']
      if (provided !== password) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Password required — set it under ⚙ Settings', authRequired: true }))
        return true
      }
    }

    await route(req, res, ctx)
    return true
  }
}

/** GitHub OAuth: /api/auth/github redirects out; /callback exchanges the code. */
async function handleGithubOauth(url, req, res, log) {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    res.statusCode = 404
    res.end('GitHub login is not configured on this DotChart')
    return
  }
  const crypto = await import('node:crypto')
  const proto = req.headers['x-forwarded-proto'] ?? 'http'
  const origin = `${proto}://${req.headers.host}`

  if (url === '/api/auth/github') {
    const state = crypto.default.randomBytes(16).toString('hex')
    res.setHeader('set-cookie', `dotchart_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`)
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${origin}/api/auth/github/callback`,
      scope: 'user:email',
      state,
    })
    res.statusCode = 302
    res.setHeader('location', `https://github.com/login/oauth/authorize?${q}`)
    res.end()
    return
  }

  // callback
  try {
    const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '')
    const code = params.get('code') ?? ''
    const state = params.get('state') ?? ''
    const cookieState = String(req.headers.cookie ?? '').match(/(?:^|;\s*)dotchart_oauth_state=([^;]+)/)?.[1]
    if (!code || !state || state !== cookieState) throw new Error('OAuth state mismatch — try again')

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
    const token = (await tokenRes.json()).access_token
    if (!token) throw new Error('GitHub did not return an access token')

    const gh = (u) => fetch(`https://api.github.com${u}`, { headers: { authorization: `Bearer ${token}`, 'user-agent': 'dotchart' } }).then((r) => r.json())
    const ghUser = await gh('/user')
    let email = ghUser.email
    if (!email) {
      const emails = await gh('/user/emails')
      email = (Array.isArray(emails) && (emails.find((e) => e.primary)?.email ?? emails[0]?.email)) || ''
    }
    const { githubLogin, sessionCookie } = await import('./auth.mjs')
    const user = githubLogin(String(ghUser.id), email)
    log(`github login: ${user.email}`)
    res.statusCode = 302
    res.setHeader('set-cookie', [sessionCookie(user.id), 'dotchart_oauth_state=; Path=/; Max-Age=0'])
    res.setHeader('location', '/')
    res.end()
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><p>GitHub login failed: ${String(err instanceof Error ? err.message : err).replace(/</g, '&lt;')} — <a href="/">back to DotChart</a>`)
  }
}
