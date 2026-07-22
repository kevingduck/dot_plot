// DotChart project workspaces: everything learned about a project (dataset,
// event plan, DB sync config, insights) saved as one JSON file under
// ~/.dotchart/projects/, keyed by the project's path. Switching projects in
// the UI is a file load — never a re-analysis.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = path.join(os.homedir(), '.dotchart', 'projects')

function slugFor(projectPath) {
  const base = path
    .basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const hash = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 8)
  return `${base || 'project'}-${hash}`
}

export function saveWorkspace(ws) {
  if (!ws || typeof ws.path !== 'string' || !ws.path) throw new Error('Workspace needs a project path')
  fs.mkdirSync(DIR, { recursive: true })
  const slug = slugFor(ws.path)
  const record = { ...ws, slug, savedAt: Date.now() }
  fs.writeFileSync(path.join(DIR, `${slug}.json`), JSON.stringify(record))
  return { slug, savedAt: record.savedAt }
}

export function listWorkspaces() {
  let files
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const f of files) {
    try {
      const ws = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
      out.push({
        slug: ws.slug ?? f.replace(/\.json$/, ''),
        name: String(ws.name ?? path.basename(ws.path ?? f)).replace(/^local:/, ''),
        path: ws.path ?? '',
        savedAt: ws.savedAt ?? 0,
        users: ws.dataset?.users?.length ?? 0,
        events: ws.dataset?.events?.length ?? 0,
        hasPlan: Boolean(ws.plan),
        planKeys: (ws.plan?.events ?? []).map((e) => e.key),
        hasInsights: Boolean(ws.insights),
      })
    } catch {
      /* skip corrupt file */
    }
  }
  out.sort((a, b) => b.savedAt - a.savedAt)
  return out
}

// Event keys of the built-in demo dataset (fictional music app)
const DEMO_KEYS = new Set(['played_song', 'created_playlist', 'shared_song', 'searched'])

/**
 * Self-healing migration: workspaces saved by older builds could contain the
 * demo dataset (or demo + real mixed). Scrub on load: keep real events,
 * discard fiction; rebuild the registry from the plan. Persists the cleaned
 * version so the scrub runs once.
 */
function sanitizeWorkspace(ws, file) {
  const ds = ws.dataset
  if (!ds || !String(ds.source ?? '').startsWith('Sample data')) return ws
  const real = (ds.events ?? []).filter((e) => !DEMO_KEYS.has(e.event))
  if (real.length === 0) {
    ws.dataset = null
  } else {
    real.sort((a, b) => a.ts - b.ts)
    const platformOf = (e) => (e?.os && e?.browser ? `${e.os} · ${e.browser}` : e?.os || e?.browser || '—')
    const uaByUser = new Map()
    for (const e of real) if (!uaByUser.has(e.userId) && (e.os || e.browser)) uaByUser.set(e.userId, e)
    const users = [...new Set(real.map((e) => e.userId))].map((id) => ({
      id,
      name: id.startsWith('anon_') ? `Visitor ${id.slice(5, 11)}` : id,
      platform: platformOf(uaByUser.get(id)),
      plan: '—',
      country: '—',
    }))
    const present = new Set(real.map((e) => e.event))
    let ordered = []
    if (ws.plan?.events?.length) {
      const core = ws.plan.core_event
      const keys = ws.plan.events.map((e) => e.key)
      ordered = [core, ...keys.filter((k) => k !== core)].filter((k) => present.has(k))
    }
    if (ordered.length === 0) {
      const freq = new Map()
      for (const e of real) freq.set(e.event, (freq.get(e.event) ?? 0) + 1)
      ordered = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    }
    const labels = new Map((ws.plan?.events ?? []).map((e) => [e.key, e.label]))
    const shapes = ['circle', 'square', 'diamond', 'triangle']
    const registry = ordered.slice(0, 4).map((key, i) => ({
      key,
      label: labels.get(key) ?? key,
      shape: shapes[i],
      slot: i,
      core: i === 0,
    }))
    if ([...present].some((k) => !ordered.slice(0, 4).includes(k))) {
      registry.push({ key: '__other__', label: 'Other', shape: 'dot', slot: -1, core: false })
    }
    ws.dataset = { users, events: real, registry, source: `${ws.name ?? 'project'} (live tracked events)` }
  }
  try {
    fs.writeFileSync(file, JSON.stringify(ws))
  } catch {
    /* scrub still applies for this load */
  }
  return ws
}

/** Cosmetic normalization: the internal 'local:' key prefix must never show as a name. */
function normalizeWorkspace(ws, file) {
  let changed = false
  if (typeof ws.name === 'string' && ws.name.startsWith('local:')) {
    ws.name = ws.name.slice(6)
    changed = true
  }
  if (ws.dataset?.source && String(ws.dataset.source).startsWith('local:')) {
    ws.dataset.source = String(ws.dataset.source).slice(6)
    changed = true
  }
  if (changed) {
    try {
      fs.writeFileSync(file, JSON.stringify(ws))
    } catch {
      /* display fix still applies */
    }
  }
  return ws
}

export function loadWorkspace(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad workspace id')
  const file = path.join(DIR, `${slug}.json`)
  if (!fs.existsSync(file)) throw new Error('Workspace not found')
  return normalizeWorkspace(sanitizeWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')), file), file)
}

export function deleteWorkspace(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad workspace id')
  try {
    fs.rmSync(path.join(DIR, `${slug}.json`))
  } catch {
    /* already gone */
  }
}
