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
        name: ws.name ?? path.basename(ws.path ?? f),
        path: ws.path ?? '',
        savedAt: ws.savedAt ?? 0,
        users: ws.dataset?.users?.length ?? 0,
        events: ws.dataset?.events?.length ?? 0,
        hasPlan: Boolean(ws.plan),
        hasInsights: Boolean(ws.insights),
      })
    } catch {
      /* skip corrupt file */
    }
  }
  out.sort((a, b) => b.savedAt - a.savedAt)
  return out
}

export function loadWorkspace(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad workspace id')
  const file = path.join(DIR, `${slug}.json`)
  if (!fs.existsSync(file)) throw new Error('Workspace not found')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function deleteWorkspace(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad workspace id')
  try {
    fs.rmSync(path.join(DIR, `${slug}.json`))
  } catch {
    /* already gone */
  }
}
