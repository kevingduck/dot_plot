// Standalone DotChart ingest server — ONLY the /ingest endpoint, safe to
// expose publicly (e.g. through an ngrok/cloudflared tunnel) so deployed apps
// can send events to the store on this machine. The full dev-server API
// (filesystem, git, database) is deliberately NOT served here.
//
//   npm run ingest          # listens on 5299
//   PORT=6000 npm run ingest

import http from 'node:http'
import { appendEvents, normalizeEvent, storeInfo } from './store.mjs'

const PORT = Number(process.env.PORT || 5299)

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  const url = (req.url ?? '').split('?')[0]

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (url === '/' || url === '/health') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, service: 'dotchart-ingest', events_stored: storeInfo().count }))
    return
  }
  if (url !== '/ingest' || req.method !== 'POST') {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'POST /ingest' }))
    return
  }

  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 1_000_000) req.destroy() // 1MB cap
  })
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    try {
      const parsed = JSON.parse(body || '{}')
      const raw = Array.isArray(parsed.events) ? parsed.events : [parsed]
      const valid = raw.slice(0, 1000).map(normalizeEvent).filter(Boolean)
      const n = appendEvents(valid)
      if (n > 0) console.log(`[dotchart ingest] ${n} event${n === 1 ? '' : 's'} received (${valid.map((e) => e.event).join(', ')})`)
      res.statusCode = 202
      res.end(JSON.stringify({ ok: true, received: n }))
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'invalid JSON' }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[dotchart ingest] listening on http://localhost:${PORT}/ingest`)
  console.log(`[dotchart ingest] events land in ~/.dotchart/events.jsonl and appear on the grid within ~15s`)
})
