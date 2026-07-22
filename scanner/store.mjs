// DotChart event store: append-only JSONL files. Legacy/local mode uses one
// shared ~/.dotchart/events.jsonl; account mode (DOTCHART_AUTH=1) gives each
// project its own file under the owner's namespace, addressed by ingest
// token — see api.mjs. Simple by design: files, one machine, no DB.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DATA_ROOT = path.join(os.homedir(), '.dotchart')
const LEGACY_FILE = path.join(DATA_ROOT, 'events.jsonl')

const EVENT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/

/**
 * Validate + normalize one incoming event; returns null if unusable.
 * `ua` — optional {os, browser, device} classified from the request's
 * User-Agent (browser-sent events only); explicit payload fields win.
 */
export function normalizeEvent(raw, ua = null) {
  if (!raw || typeof raw !== 'object') return null
  const userId = String(raw.user_id ?? raw.userId ?? '').slice(0, 128)
  const event = String(raw.event ?? '').slice(0, 64)
  if (!userId || !EVENT_KEY_RE.test(event)) return null
  let ts = Date.now()
  if (raw.timestamp != null) {
    const t = typeof raw.timestamp === 'number' ? (raw.timestamp < 1e12 ? raw.timestamp * 1000 : raw.timestamp) : Date.parse(raw.timestamp)
    if (!Number.isNaN(t) && t > 0) ts = t
  }
  const out = { user_id: userId, event, ts }
  for (const key of ['os', 'browser', 'device']) {
    const v = raw[key] ?? ua?.[key]
    if (typeof v === 'string' && v) out[key] = v.slice(0, 32)
  }
  if (raw.props && typeof raw.props === 'object') {
    const propsStr = JSON.stringify(raw.props)
    if (propsStr.length <= 2000) out.props = raw.props
  }
  return out
}

export function appendEvents(events, file = LEGACY_FILE) {
  if (events.length === 0) return 0
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = events.map((e) => JSON.stringify({ ...e, received_at: Date.now() })).join('\n') + '\n'
  fs.appendFileSync(file, lines)
  return events.length
}

export function readEvents(file = LEGACY_FILE) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e.user_id && e.event && typeof e.ts === 'number') out.push(e)
    } catch {
      /* skip corrupt line */
    }
  }
  return out
}

export function storeInfo(file = LEGACY_FILE) {
  const events = readEvents(file)
  return {
    count: events.length,
    file,
    lastReceived: events.length ? Math.max(...events.map((e) => e.received_at ?? e.ts)) : null,
  }
}

export function clearStore(file = LEGACY_FILE) {
  try {
    fs.rmSync(file)
  } catch {
    /* already gone */
  }
}
