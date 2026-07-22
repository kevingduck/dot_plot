// DotChart event store: append-only JSONL at ~/.dotchart/events.jsonl.
// Receives what instrumented apps send via track() → POST /ingest; the UI
// merges it into the grid. Simple by design — one file, one machine, no DB.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = path.join(os.homedir(), '.dotchart')
const FILE = path.join(DIR, 'events.jsonl')

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

export function appendEvents(events) {
  if (events.length === 0) return 0
  fs.mkdirSync(DIR, { recursive: true })
  const lines = events.map((e) => JSON.stringify({ ...e, received_at: Date.now() })).join('\n') + '\n'
  fs.appendFileSync(FILE, lines)
  return events.length
}

export function readEvents() {
  let text
  try {
    text = fs.readFileSync(FILE, 'utf8')
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

export function storeInfo() {
  const events = readEvents()
  return {
    count: events.length,
    file: FILE,
    lastReceived: events.length ? Math.max(...events.map((e) => e.received_at ?? e.ts)) : null,
  }
}

export function clearStore() {
  try {
    fs.rmSync(FILE)
  } catch {
    /* already gone */
  }
}
