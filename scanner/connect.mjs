// DotChart Connect: the one-pointer setup flow.
//   discoverProject(path)  — fast, no AI: project name, file count, database
//                            connection strings found in the repo's env files
//   analyzeProject(path, connectionString?, onStatus) — one Claude pass over
//                            the code digest AND the live DB schema (if
//                            consented), returning a unified event proposal:
//                            each event either maps to an existing table
//                            (importable now) or needs instrumentation.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildDigest, extractTrackedKeys, reconcilePlanWithExistingKeys } from './scan.mjs'
import { aiLabel, resolveAi, runStructured } from './llm.mjs'
import { scanDatabase } from './dbscan.mjs'

const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'go.mod', 'Gemfile', 'Cargo.toml', 'composer.json', '.git']

/** Directory listing for the in-app folder picker. Local tool: browses the user's own machine. */
export function listDirectory(targetPath) {
  const home = os.homedir()
  const p = targetPath ? path.resolve(targetPath) : home
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`Not a directory: ${p}`)
  const dirs = []
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(p, e.name)
    let isProject = false
    try {
      isProject = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(full, m)))
    } catch {
      /* permission */
    }
    dirs.push({ name: e.name, path: full, isProject })
  }
  dirs.sort((a, b) => Number(b.isProject) - Number(a.isProject) || a.name.localeCompare(b.name))
  const parent = path.dirname(p)
  const isCurrentProject = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(p, m)))
  return {
    path: p,
    parent: parent !== p ? parent : null,
    home,
    isProject: isCurrentProject,
    shortcuts: [
      { name: 'Home', path: home },
      { name: 'Desktop', path: path.join(home, 'Desktop') },
      { name: 'Documents', path: path.join(home, 'Documents') },
    ].filter((s2) => fs.existsSync(s2.path)),
    dirs: dirs.slice(0, 200),
  }
}

function sanitize(text, token) {
  return token ? String(text).split(token).join('••••') : String(text)
}

export function parseGithubUrl(url) {
  const m = url.trim().match(/(?:github\.com[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/)
  if (!m) throw new Error('Could not read that as a GitHub repo URL (expected github.com/owner/repo)')
  return { owner: m[1], repo: m[2] }
}

/** Shallow-clone (or refresh) a GitHub repo into ~/.dotchart/repos. Tokens are used once and never persisted. */
export function cloneGithubRepo(url, token, { onStatus = () => {} } = {}) {
  const { owner, repo } = parseGithubUrl(url)
  const dest = path.join(os.homedir(), '.dotchart', 'repos', `${owner}__${repo}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const cleanUrl = `https://github.com/${owner}/${repo}.git`
  const authUrl = token ? `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git` : cleanUrl
  const run = (args, timeout = 300000) => execFileSync('git', args, { stdio: 'pipe', timeout, encoding: 'utf8' })
  if (fs.existsSync(path.join(dest, '.git'))) {
    onStatus(`Refreshing existing copy of ${owner}/${repo}…`)
    try {
      run(['-C', dest, 'remote', 'set-url', 'origin', authUrl])
      run(['-C', dest, 'fetch', '--depth', '1', 'origin'], 120000)
      run(['-C', dest, 'reset', '--hard', 'FETCH_HEAD'])
    } catch {
      onStatus('Refresh failed — using the existing copy as-is')
    } finally {
      try {
        run(['-C', dest, 'remote', 'set-url', 'origin', cleanUrl])
      } catch {
        /* ignore */
      }
    }
  } else {
    onStatus(`Cloning ${owner}/${repo}${token ? ' (authenticated)' : ''}… this can take a minute for big repos`)
    try {
      run(['clone', '--depth', '1', authUrl, dest])
    } catch (err) {
      const detail = sanitize(err.stderr || err.message || '', token)
      if (/authentication|403|404|could not read/i.test(detail)) {
        throw new Error(
          `Could not access ${owner}/${repo}. If it's private, paste a GitHub personal access token (github.com → Settings → Developer settings → Fine-grained tokens, with read access to this repo).`,
        )
      }
      throw new Error(`Clone failed: ${detail.slice(0, 300)}`)
    }
    try {
      run(['-C', dest, 'remote', 'set-url', 'origin', cleanUrl])
    } catch {
      /* ignore */
    }
  }
  onStatus('Repository ready')
  return { path: dest, owner, repo }
}

export function redactConnString(conn) {
  return conn.replace(/:\/\/([^:@/]+):[^@]+@/, '://$1:••••@')
}

/** Fast, local-only discovery. Reads env files but sends nothing anywhere. */
export function discoverProject(targetPath) {
  const root = path.resolve(targetPath)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`)

  let name = path.basename(root)
  let framework = ''
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (pkg.name) name = pkg.name
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    framework =
      ['next', 'nuxt', 'react', 'vue', 'svelte', 'express', 'fastify', 'rails']
        .filter((f) => deps?.[f])
        .join(' + ') || ''
    if (deps?.['@prisma/client'] || deps?.prisma) framework += (framework ? ' + ' : '') + 'prisma'
  } catch {
    /* not a node project */
  }

  // Look for database connection strings in env files (values stay local;
  // only a redacted form is shown in the UI)
  const databases = []
  const envFiles = ['.env', '.env.local', '.env.development', '.env.development.local', 'config/database.yml']
  for (const f of envFiles) {
    const full = path.join(root, f)
    if (!fs.existsSync(full)) continue
    let text
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z0-9_]*(?:DATABASE|POSTGRES|PG)[A-Z0-9_]*)\s*=\s*["']?(postgres(?:ql)?:\/\/[^"'\s]+)["']?/gim)) {
      if (!databases.some((d) => d.connectionString === m[2])) {
        databases.push({ envFile: f, varName: m[1], connectionString: m[2], redacted: redactConnString(m[2]) })
      }
    }
  }

  const { included, skipped, totalFiles } = (() => {
    try {
      const d = buildDigest(root)
      return { included: d.included, skipped: d.skipped, totalFiles: d.totalFiles }
    } catch {
      return { included: 0, skipped: 0, totalFiles: 0 }
    }
  })()

  return { root, name, framework, files: { included, skipped, total: totalFiles }, databases }
}

const CONNECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_summary', 'core_event', 'events'],
  properties: {
    product_summary: { type: 'string', description: 'Two or three sentences: what this product does and who its users are' },
    core_event: { type: 'string', description: 'Key of the single event that best represents core value delivered' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'description', 'tier', 'confidence', 'rationale', 'instrumentation', 'db_mapping'],
        properties: {
          key: { type: 'string', description: 'snake_case past-tense event key' },
          label: { type: 'string' },
          description: { type: 'string' },
          tier: { type: 'string', enum: ['core', 'activation', 'feature', 'noise'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string' },
          instrumentation: {
            type: 'array',
            description: 'Where a track() call would go in the code (always provide, even for db-backed events)',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'location', 'snippet'],
              properties: {
                file: { type: 'string' },
                location: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
          db_mapping: {
            type: 'object',
            additionalProperties: false,
            required: ['table', 'user_column', 'timestamp_column'],
            description:
              'If rows in an existing database table ALREADY record this event, name the table and columns; use empty strings when the event is not derivable from the database',
            properties: {
              table: { type: 'string' },
              user_column: { type: 'string' },
              timestamp_column: { type: 'string' },
            },
          },
        },
      },
    },
  },
}

const CONNECT_SYSTEM = `You are DotChart's project analyzer. DotChart shows a per-user, per-day dot plot of product usage. Given a codebase (and, when provided, the live database schema), propose the analytics events the team should track.

Principles:
- Prefer VALUE events (user got what they came for) over vanity events (opened app, signed in). Vanity events get tier "noise" with an explanation.
- Exactly one core event; a few "activation" (aha moments predicting retention) and "feature" events. 4-10 total.
- Keys are snake_case past-tense verbs.
- WHEN A DATABASE SCHEMA IS PROVIDED: for each event, check whether an existing table already records it (a row insert = the event happening). If so, fill db_mapping with that table and its user/timestamp columns chosen from the schema — the event can then be charted from existing data with zero code changes. Use EXACT table and column names from the schema. If no table records it, leave db_mapping fields as empty strings.
- Always also provide instrumentation points (real files/functions from the code, with a one-line dotchart.track(userId, 'key', props) snippet) — even db-backed events benefit from live tracking later.
- The instrumentation snippets must reference real code locations from the provided files.`

/**
 * Assemble everything the LLM call needs (prompt, schema) plus the context
 * required to post-process its answer. Split out so the call itself can run
 * either server-side (runStructured) or in the user's browser (local Ollama
 * against a hosted DotChart) — see /api/ai/prepare + /api/ai/finish.
 */
export async function buildAnalysisRequest(targetPath, connectionString, { onStatus = () => {}, prebuilt } = {}) {
  const root = prebuilt ? `local:${prebuilt.name}` : path.resolve(targetPath)

  let digest, included, skipped, trackedKeys
  if (prebuilt) {
    // Digest built in the user's browser (hosted mode) — cap defensively
    digest = String(prebuilt.digest).slice(0, 600_000)
    included = Number(prebuilt.included) || 0
    skipped = Number(prebuilt.skipped) || 0
    trackedKeys = Array.isArray(prebuilt.trackedKeys) ? prebuilt.trackedKeys.filter((k) => typeof k === 'string').slice(0, 100) : undefined
    onStatus(`Received ${included} source files (~${Math.round(digest.length / 1024)} KB) from your browser`)
  } else {
    onStatus('Reading the codebase…')
    ;({ digest, included, skipped, trackedKeys } = buildDigest(root))
    onStatus(`Read ${included} source files (~${Math.round(digest.length / 1024)} KB${skipped ? `, ${skipped} skipped by size budget` : ''})`)
  }

  let schema = null
  if (connectionString) {
    onStatus('Introspecting the database (read-only)…')
    try {
      schema = await scanDatabase(connectionString)
      onStatus(`Found ${schema.tables.length} tables (${schema.tables.filter((t) => t.eligible).length} look like event streams)`)
    } catch (err) {
      onStatus(`Database introspection failed (${err.message}) — continuing with code only`)
      schema = null
    }
  }

  const schemaBlock = schema
    ? `\n\nLIVE DATABASE SCHEMA (public):\n${schema.tables
        .map((t) => `${t.table} (~${t.approx_rows} rows): ${t.columns.join(', ')}`)
        .join('\n')}`
    : ''

  // Existing instrumentation is the source of truth for event names
  const existingKeys = trackedKeys ?? extractTrackedKeys(digest)
  const existingNote = existingKeys.length
    ? `\n\nIMPORTANT — this codebase ALREADY contains DotChart tracking calls with these exact event keys: ${existingKeys.join(', ')}. When proposing those events, adopt these keys VERBATIM (never rename, pluralize, or invent variants — live data already uses these names). Invent new keys only for actions that are not yet instrumented.`
    : ''
  if (existingKeys.length) onStatus(`Found ${existingKeys.length} existing tracking calls — keeping their exact event keys`)

  return {
    request: {
      system: CONNECT_SYSTEM,
      prompt: `Analyze this product and propose its analytics event plan.${existingNote}${schemaBlock}\n\nCODEBASE:\n\n${digest}`,
      schema: CONNECT_SCHEMA,
      maxTokens: 32000,
    },
    ctx: {
      root,
      included,
      skipped,
      existingKeys,
      db_connected: Boolean(schema),
      knownTables: (schema?.tables ?? []).map((t) => ({ table: t.table, columns: t.columns })),
    },
  }
}

/** Post-process a raw plan from any provider into the final, trustworthy one. */
export function finishAnalysis(plan, ctx, { model, provider, usage, onStatus = () => {} } = {}) {
  if (!plan || !Array.isArray(plan.events)) throw new Error('The model did not return an event plan')

  // Validate db mappings against the real schema; downgrade invalid ones to
  // instrumentation-only so the import step can trust every mapping blindly.
  const known = new Map((ctx.knownTables ?? []).map((t) => [t.table, new Set(t.columns)]))
  for (const e of plan.events) {
    const m = e.db_mapping
    const valid =
      m && m.table && known.has(m.table) && known.get(m.table).has(m.user_column) && known.get(m.table).has(m.timestamp_column)
    if (!valid) e.db_mapping = { table: '', user_column: '', timestamp_column: '' }
  }
  const { renamed, added } = reconcilePlanWithExistingKeys(plan, ctx.existingKeys ?? [], { withDbMapping: true })
  if (renamed.length) onStatus(`Aligned ${renamed.length} event key${renamed.length === 1 ? '' : 's'} with existing instrumentation (${renamed.join('; ')})`)
  if (added.length) onStatus(`Added ${added.length} already-instrumented event${added.length === 1 ? '' : 's'} the analysis missed (${added.join(', ')})`)
  const dbBacked = plan.events.filter((e) => e.db_mapping.table).length
  onStatus(`Proposal ready: ${plan.events.length} events, ${dbBacked} already in your database`)

  return {
    ...plan,
    meta: {
      scanned_path: ctx.root,
      files_included: ctx.included,
      files_skipped: ctx.skipped,
      model,
      provider,
      generated_at: new Date().toISOString(),
      db_connected: ctx.db_connected,
      usage,
    },
  }
}

export async function analyzeProject(targetPath, connectionString, { onStatus = () => {}, model, apiKey, provider, baseUrl, allowEnvKey, prebuilt } = {}) {
  const ai = resolveAi({ provider, model, apiKey, baseUrl, allowEnvKey })
  const { request, ctx } = await buildAnalysisRequest(targetPath, connectionString, { onStatus, prebuilt })

  onStatus(`Asking ${aiLabel(ai)} to analyze the product…`)
  let drafted = 0
  const { object: plan, usage } = await runStructured(ai, {
    ...request,
    onStatus,
    onText: (snapshot) => {
      const n = (snapshot.match(/"key"\s*:/g) || []).length
      if (n > drafted) {
        drafted = n
        onStatus(`Drafting the event plan — ${n} event${n === 1 ? '' : 's'}…`)
      }
    },
  })
  return finishAnalysis(plan, ctx, { model: ai.model, provider: ai.provider, usage, onStatus })
}
