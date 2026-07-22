#!/usr/bin/env node
// dotchart CLI — the `npx dotchart-analytics` entry point.
//
//   npx dotchart-analytics              start on a free port and open the browser
//   npx dotchart-analytics --port 8080  pick the port
//   npx dotchart-analytics --no-open    don't open the browser
//
// The published package ships a prebuilt dist/, so this starts instantly:
// no clone, no install, no build.

import net from 'node:net'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = createRequire(import.meta.url)(path.join(ROOT, 'package.json'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

if (has('--help') || has('-h')) {
  console.log(`dotchart v${pkg.version} — see what your users are actually doing

Usage: npx dotchart-analytics [options]

Options:
  --port <n>       listen port (default: first free port from 5300)
  --no-open        don't open the browser
  --password <pw>  require this password for the dashboard (sets DOTCHART_PASSWORD)
  --hosted         hosted mode: disable machine-local features (sets DOTCHART_HOSTED=1)
  -v, --version    print version
  -h, --help       this help

AI analysis needs a provider: paste a Claude/OpenAI key under ⚙ Settings in
the UI (or set ANTHROPIC_API_KEY / OPENAI_API_KEY before starting), or run
local models free via Ollama. Everything else works without AI.`)
  process.exit(0)
}
if (has('--version') || has('-v')) {
  console.log(pkg.version)
  process.exit(0)
}

/** First free port at or after `start` (a busy port means another app, or another DotChart). */
async function freePort(start) {
  for (let p = start; p < start + 50; p++) {
    const ok = await new Promise((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.listen(p, () => srv.close(() => resolve(true)))
    })
    if (ok) return p
  }
  throw new Error(`No free port found between ${start} and ${start + 49}`)
}

const requested = Number(val('--port') || process.env.PORT || 5300)
const port = Number(val('--port')) ? requested : await freePort(requested)

process.env.PORT = String(port)
if (has('--hosted')) process.env.DOTCHART_HOSTED = '1'
if (val('--password')) process.env.DOTCHART_PASSWORD = val('--password')

await import(path.join(ROOT, 'server.mjs'))

// Wait for the server to answer, then open the browser.
const url = `http://localhost:${port}`
const ready = await new Promise((resolve) => {
  const deadline = Date.now() + 10_000
  const poll = () => {
    http
      .get(`${url}/health`, (res) => {
        res.resume()
        res.statusCode === 200 ? resolve(true) : retry()
      })
      .on('error', retry)
  }
  const retry = () => (Date.now() > deadline ? resolve(false) : setTimeout(poll, 150))
  poll()
})

if (ready) {
  console.log(`
  DotChart is running:   ${url}
  Ingest endpoint:       ${url}/ingest
  Docs:                  ${url}/docs
`)
  if (!has('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    spawn(opener, [url], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref()
  }
} else {
  console.error('[dotchart] server did not become ready within 10s — try opening the URL manually')
}
