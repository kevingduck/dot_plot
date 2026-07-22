// DotChart production server — serves the built UI (dist/) plus the full API.
// This is what runs on Render (or any Node host):
//
//   npm run build && npm start
//
// Environment:
//   PORT               — listen port (Render sets this)
//   DOTCHART_HOSTED=1  — hosted mode: disables machine-local features
//   DOTCHART_PASSWORD  — required for all /api/* routes when set (STRONGLY
//                        recommended for any public deployment)
//   ANTHROPIC_API_KEY  — for AI analysis (users can also bring their own key)

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './scanner/api.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 5300)
const HOSTED = process.env.DOTCHART_HOSTED === '1'
const PASSWORD = process.env.DOTCHART_PASSWORD || ''

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` first')
  process.exit(1)
}
if (HOSTED && !PASSWORD) {
  console.warn('[dotchart] WARNING: hosted mode without DOTCHART_PASSWORD — anyone with the URL can use the API. Set DOTCHART_PASSWORD.')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const handleApi = createApiHandler({
  log: (s) => console.log(`[dotchart] ${s}`),
  hosted: HOSTED,
  password: PASSWORD,
  authMode: process.env.DOTCHART_AUTH === '1',
})

const server = http.createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return
  } catch (err) {
    console.error('[dotchart] unhandled API error:', err)
    if (!res.headersSent) res.statusCode = 500
    res.end(JSON.stringify({ error: 'internal error' }))
    return
  }

  // Static files from dist/ with an SPA fallback to index.html
  const urlPath = (req.url ?? '/').split('?')[0]
  let filePath = path.normalize(path.join(DIST, urlPath === '/' ? 'index.html' : urlPath))
  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403
    res.end()
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST, 'index.html')
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  if (urlPath.startsWith('/assets/')) res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`[dotchart] serving UI + API on http://localhost:${PORT} (${HOSTED ? 'hosted' : 'local'} mode${PASSWORD ? ', password-protected' : ''})`)
})
