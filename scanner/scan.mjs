// DotChart codebase scanner: reads a repo, asks Claude to propose the analytics
// events worth tracking, and writes dotchart.events.json for review in the UI.
//
//   node scanner/scan.mjs [path-to-codebase] [--out dotchart.events.json]
//
// Auth: ANTHROPIC_API_KEY env var, or a .env file in this project's root.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_MODEL = 'claude-sonnet-5'
export const ALLOWED_MODELS = ['claude-sonnet-5', 'claude-opus-4-8']
const MAX_TOTAL_BYTES = 400_000 // ~100k tokens of code digest, well within 1M context
const MAX_FILE_BYTES = 24_000

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.cache', 'scratchpad'])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php', '.swift', '.vue', '.svelte', '.html'])
const DOC_FILES = new Set(['readme.md', 'package.json', 'pyproject.toml', 'gemfile', 'go.mod', 'cargo.toml', 'composer.json'])
const SKIP_FILE_RE = /\.(test|spec|stories|min)\.|\.d\.ts$|\.lock$|-lock\./i

// Files whose names suggest user-facing surface get read first.
function priorityOf(relPath) {
  const p = relPath.toLowerCase()
  if (DOC_FILES.has(path.basename(p))) return 0
  if (/(routes?|router|pages?|views?|controllers?|handlers?|api|endpoints?)\b/.test(p)) return 1
  if (/(app|main|index|server)\.[a-z]+$/.test(p)) return 2
  if (/(components?|features?|screens?|actions?|mutations?|services?|models?)\b/.test(p)) return 3
  return 4
}

export function collectFiles(root) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 8) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1)
      } else if (e.isFile()) {
        const rel = path.relative(root, full)
        const ext = path.extname(e.name).toLowerCase()
        const isDoc = DOC_FILES.has(e.name.toLowerCase())
        if (!isDoc && !CODE_EXT.has(ext)) continue
        if (SKIP_FILE_RE.test(e.name)) continue
        let size
        try {
          size = fs.statSync(full).size
        } catch {
          continue
        }
        if (size === 0 || size > 400_000) continue
        files.push({ rel, full, size, priority: priorityOf(rel) })
      }
    }
  }
  walk(root, 0)
  files.sort((a, b) => a.priority - b.priority || a.size - b.size)
  return files
}

/** Event keys already instrumented in the code: second string arg of track() calls. */
export function extractTrackedKeys(digest) {
  const keys = new Set()
  const re = /\btrack\s*\(\s*[^,()\n]{0,80},\s*['"]([A-Za-z][A-Za-z0-9_]{1,63})['"]/g
  let m
  while ((m = re.exec(digest))) keys.add(m[1])
  return [...keys]
}

/**
 * Make the plan speak the language the code actually sends: rename plan
 * events whose keys near-miss an existing instrumented key, and append any
 * instrumented keys the model didn't propose at all.
 */
export function reconcilePlanWithExistingKeys(plan, existingKeys, { withDbMapping = false } = {}) {
  if (!existingKeys.length) return { renamed: [], added: [] }
  const tokens = (x) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const planKeys = new Set(plan.events.map((e) => e.key))
  const unclaimed = existingKeys.filter((k) => !planKeys.has(k))
  const renamed = []
  for (const ev of plan.events) {
    if (existingKeys.includes(ev.key)) continue
    const et = tokens(ev.key)
    let best = null
    let bestScore = 0
    for (const k of unclaimed) {
      const overlap = [...tokens(k)].filter((t) => et.has(t)).length
      const contain = ev.key.includes(k) || k.includes(ev.key) ? 2 : 0
      const score = overlap + contain
      if (score > bestScore) {
        best = k
        bestScore = score
      }
    }
    if (best && bestScore >= 2) {
      renamed.push(`${ev.key} → ${best}`)
      if (plan.core_event === ev.key) plan.core_event = best
      ev.key = best
      unclaimed.splice(unclaimed.indexOf(best), 1)
    }
  }
  const added = []
  for (const k of unclaimed) {
    const label = k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
    const ev = {
      key: k,
      label,
      description: 'Already instrumented — an existing track() call in the code sends this event.',
      tier: 'feature',
      confidence: 'high',
      rationale: 'Detected from existing instrumentation; kept with its exact key so live events match the plan.',
      instrumentation: [],
    }
    if (withDbMapping) ev.db_mapping = { table: '', user_column: '', timestamp_column: '' }
    plan.events.push(ev)
    added.push(k)
  }
  return { renamed, added }
}

export function buildDigest(root) {
  const files = collectFiles(root)
  if (files.length === 0) throw new Error(`No source files found under ${root}`)
  const parts = []
  const trackedKeys = new Set()
  let total = 0
  let included = 0
  for (const f of files) {
    if (total > MAX_TOTAL_BYTES) break
    let text
    try {
      text = fs.readFileSync(f.full, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\u0000')) continue // binary
    // Existing instrumentation must be found in the FULL text — truncation
    // below could hide track() calls deep in large files
    for (const k of extractTrackedKeys(text)) trackedKeys.add(k)
    // HTML: strip style blocks so the budget goes to logic, not CSS
    if (f.rel.endsWith('.html')) {
      text = text.replace(/<style[\s\S]*?<\/style>/gi, '<style>/* styles omitted */</style>')
    }
    if (text.length > MAX_FILE_BYTES) {
      text = text.slice(0, MAX_FILE_BYTES) + `\n… [truncated, ${text.length} chars total]`
    }
    parts.push(`===== FILE: ${f.rel} =====\n${text}`)
    total += text.length
    included++
  }
  const skipped = files.length - included
  return { digest: parts.join('\n\n'), included, skipped, totalFiles: files.length, trackedKeys: [...trackedKeys] }
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_summary', 'core_event', 'events'],
  properties: {
    product_summary: {
      type: 'string',
      description: 'Two or three sentences: what this product does and who its users are',
    },
    core_event: {
      type: 'string',
      description: 'The key of the single event that best represents core value delivered to the user',
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'description', 'tier', 'confidence', 'rationale', 'instrumentation'],
        properties: {
          key: { type: 'string', description: 'snake_case event key, e.g. processed_invoice' },
          label: { type: 'string', description: 'Human-readable label, sentence case' },
          description: { type: 'string', description: 'What user action this captures and what it tells you' },
          tier: {
            type: 'string',
            enum: ['core', 'activation', 'feature', 'noise'],
            description: 'core = value delivered; activation = setup/aha moments; feature = secondary usage; noise = tracked-but-low-signal (opens, page views)',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string', description: 'Why this event matters (or, for noise tier, why to avoid relying on it)' },
          instrumentation: {
            type: 'array',
            description: 'Where to add tracking calls, most important location first',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'location', 'snippet'],
              properties: {
                file: { type: 'string', description: 'Repo-relative path' },
                location: { type: 'string', description: 'Function/handler/component name or line description' },
                snippet: { type: 'string', description: "The tracking call to add, e.g. dotchart.track(userId, 'processed_invoice', { amount })" },
              },
            },
          },
        },
      },
    },
  },
}

const SYSTEM = `You are DotChart's codebase scanner. DotChart is a product-analytics tool built around per-user, per-day dot plots: one row per user, one column per day, a symbol for each day's most notable event. Your job is to read a codebase and propose the analytics events the team should track.

Principles:
- Prefer VALUE events (the user got what they came for: processed an invoice, played a song, published a post) over vanity events (opened app, signed in, viewed page). If you include vanity events, tier them "noise" and say why they're weak.
- Exactly one event should be the core value event; several may be "activation" (first-run/aha moments that predict retention) or "feature" (secondary features whose adoption might drive retention).
- Propose 4-10 events total. Fewer, well-chosen events beat a long list.
- Keys are snake_case verbs in past tense (created_playlist, exported_report).
- Instrumentation points must reference real files and functions from the provided code, with a concrete one-line tracking call using dotchart.track(userId, 'event_key', props).
- If the codebase is a frontend-only or library project, still propose the events its END USERS would generate, instrumented at the closest real code location.`

function loadEnvKey(projectRoot) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const env = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')
    const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch {
    /* no .env */
  }
  return null
}

export function hasServerKey() {
  const projectRoot = path.dirname(fileURLToPath(import.meta.url)) + '/..'
  return loadEnvKey(path.resolve(projectRoot)) !== null
}

export async function scanCodebase(targetPath, { onStatus = () => {}, model, apiKey: userKey } = {}) {
  const MODEL = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL
  const projectRoot = path.dirname(fileURLToPath(import.meta.url)) + '/..'
  const apiKey = userKey || loadEnvKey(path.resolve(projectRoot))
  if (!apiKey) throw new Error('No API key — add yours in Settings, or put ANTHROPIC_API_KEY in the project .env')

  const root = path.resolve(targetPath)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`)
  }

  onStatus(`Collecting files from ${root}…`)
  const { digest, included, skipped, trackedKeys } = buildDigest(root)
  const kb = Math.round(digest.length / 1024)
  onStatus(`Read ${included} files (~${kb} KB${skipped > 0 ? `, ${skipped} more skipped by size budget` : ''}) — sending to ${MODEL}…`)

  const existingKeys = trackedKeys ?? extractTrackedKeys(digest)
  const existingNote = existingKeys.length
    ? `\n\nIMPORTANT — this codebase ALREADY contains DotChart tracking calls with these exact event keys: ${existingKeys.join(', ')}. When proposing those events, adopt these keys VERBATIM (never rename, pluralize, or invent variants — live data already uses these names). Invent new keys only for actions that are not yet instrumented.`
    : ''
  if (existingKeys.length) onStatus(`Found ${existingKeys.length} existing tracking calls — keeping their exact event keys`)

  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Analyze this codebase and propose the analytics event plan.${existingNote}\n\n${digest}`,
      },
    ],
  })

  // Live progress off the stream: announce when Claude starts reasoning, then
  // count drafted events as the structured JSON streams out.
  let outputText = ''
  let draftedEvents = 0
  let announcedThinking = false
  stream.on('streamEvent', (event) => {
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking' && !announcedThinking) {
      announcedThinking = true
      onStatus('Claude is reading the code and planning…')
    }
  })
  stream.on('text', (delta) => {
    outputText += delta
    const n = (outputText.match(/"key"\s*:/g) || []).length
    if (n > draftedEvents) {
      draftedEvents = n
      onStatus(`Writing the event plan — ${n} event${n === 1 ? '' : 's'} drafted…`)
    }
  })

  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') throw new Error('Model declined the request')
  if (message.stop_reason === 'max_tokens') throw new Error('Response truncated (max_tokens) — try a smaller codebase')
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const plan = JSON.parse(text)
  const { renamed, added } = reconcilePlanWithExistingKeys(plan, existingKeys)
  if (renamed.length) onStatus(`Aligned ${renamed.length} event key${renamed.length === 1 ? '' : 's'} with existing instrumentation (${renamed.join('; ')})`)
  if (added.length) onStatus(`Added ${added.length} already-instrumented event${added.length === 1 ? '' : 's'} (${added.join(', ')})`)
  return {
    ...plan,
    meta: {
      scanned_path: root,
      files_included: included,
      files_skipped: skipped,
      model: MODEL,
      generated_at: new Date().toISOString(),
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
    },
  }
}

// ---- CLI entry ----
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const outFile = outIdx >= 0 ? args[outIdx + 1] : 'dotchart.events.json'
  const target = args.filter((a, i) => a !== '--out' && i !== outIdx + 1)[0] ?? '.'

  scanCodebase(target, { onStatus: (s) => console.error(`[dotchart] ${s}`) })
    .then((plan) => {
      fs.writeFileSync(outFile, JSON.stringify(plan, null, 2))
      console.error(`[dotchart] ${plan.events.length} events proposed (core: ${plan.core_event}) → ${outFile}`)
      console.error(`[dotchart] Import this file in the DotChart UI to review the plan.`)
    })
    .catch((err) => {
      console.error(`[dotchart] Scan failed: ${err.message}`)
      process.exit(1)
    })
}
