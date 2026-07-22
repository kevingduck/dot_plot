// Server-rendered documentation pages: GET /docs and /docs/<slug> serve the
// markdown files in docs/ as standalone, theme-aware HTML pages. One source
// of truth for dev, npx, and hosted — and always open (docs hold no user
// data), so they're linkable even on password-protected deployments.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs')

// Reading order for the sidebar
const ORDER = [
  'getting-started',
  'connect-your-project',
  'reading-the-grid',
  'api-keys-and-models',
  'instrumenting-your-code',
  'live-tracking',
  'csv-import',
  'self-hosting',
  'troubleshooting',
]

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// NUL-delimited placeholders keep code spans opaque to the bold/em/link
// passes; NUL can't occur in the (escaped) source text
const NUL = String.fromCharCode(0)

function inline(s) {
  let out = esc(s)
  const codes = []
  out = out.replace(/`([^`]+)`/g, (_, c) => NUL + (codes.push(`<code>${c}</code>`) - 1) + NUL)
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  return out.replace(new RegExp(`${NUL}(\\d+)${NUL}`, 'g'), (_, i) => codes[Number(i)])
}

/** Same minimal markdown dialect the docs are written in — see docs/*.md. */
export function renderMarkdown(md) {
  const lines = md.split('\n')
  const html = []
  const isItem = (s) => /^[-*] /.test(s) || /^\d+\. /.test(s)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = line.match(/^(#{1,3}) (.+)$/)
    if (h) {
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      i++
      continue
    }
    if (isItem(line)) {
      const ordered = /^\d+\. /.test(line)
      const items = []
      while (i < lines.length && (isItem(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length > 0))) {
        if (isItem(lines[i])) items.push(lines[i].replace(/^[-*] /, '').replace(/^\d+\. /, ''))
        else items[items.length - 1] += ' ' + lines[i].trim()
        i++
      }
      const tag = ordered ? 'ol' : 'ul'
      html.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const buf = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^#{1,3} /.test(lines[i]) && !isItem(lines[i])) {
      buf.push(lines[i++])
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return html.join('\n')
}

function loadPages() {
  const bySlug = new Map()
  let files = []
  try {
    files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'))
  } catch {
    return bySlug
  }
  for (const f of files) {
    const slug = f.replace(/\.md$/, '')
    const body = fs.readFileSync(path.join(DOCS_DIR, f), 'utf8')
    const title = body.match(/^# (.+)$/m)?.[1] ?? slug
    bySlug.set(slug, { slug, title, body })
  }
  return bySlug
}

const CSS = `
:root { color-scheme: light dark;
  --plane:#f9f9f7; --surface:#fcfcfb; --text:#0b0b0b; --text2:#52514e; --muted:#898781;
  --border:rgba(11,11,11,.1); --wash:rgba(11,11,11,.05); --accent:#2a78d6; }
@media (prefers-color-scheme: dark) { :root {
  --plane:#0d0d0d; --surface:#1a1a19; --text:#fff; --text2:#c3c2b7; --muted:#898781;
  --border:rgba(255,255,255,.1); --wash:rgba(255,255,255,.07); --accent:#3987e5; } }
* { box-sizing:border-box }
body { margin:0; font-family:system-ui,-apple-system,'Segoe UI',sans-serif; font-size:14px;
  background:var(--plane); color:var(--text); line-height:1.55 }
.topbar { display:flex; align-items:baseline; gap:8px; padding:14px 24px; border-bottom:1px solid var(--border) }
.topbar a.brand { font-weight:700; font-size:16px; color:var(--text); text-decoration:none }
.topbar .crumb { color:var(--muted); font-size:13px }
.topbar .to-app { margin-left:auto; font-size:13px; color:var(--accent); text-decoration:none }
.layout { display:flex; gap:32px; max-width:1000px; margin:0 auto; padding:24px; align-items:flex-start }
nav { flex:0 0 200px; position:sticky; top:20px; display:flex; flex-direction:column; gap:2px }
nav a { padding:6px 10px; border-radius:7px; color:var(--text2); text-decoration:none; font-size:13px }
nav a:hover { background:var(--wash) }
nav a.on { background:var(--wash); color:var(--text); font-weight:600 }
article { flex:1; min-width:0; max-width:68ch }
article h1 { font-size:22px; margin:0 0 12px; letter-spacing:-.01em }
article h2 { font-size:15px; margin:22px 0 6px }
article h3 { font-size:13.5px; margin:16px 0 4px }
article p, article li { color:var(--text2) }
article strong { color:var(--text) }
article a { color:var(--accent) }
article code { font-size:12.5px; background:var(--wash); padding:1px 5px; border-radius:5px }
article pre { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px 12px; overflow-x:auto }
article pre code { background:none; padding:0 }
.pager { display:flex; justify-content:space-between; margin-top:32px; padding-top:14px; border-top:1px solid var(--border); font-size:13px }
.pager a { color:var(--accent); text-decoration:none }
@media (max-width:720px) { .layout { flex-direction:column } nav { position:static; flex-direction:row; flex-wrap:wrap; flex-basis:auto } }
`

/** Full HTML for /docs (index → first page) or /docs/<slug>; null = 404. */
export function renderDocsPage(slug) {
  const bySlug = loadPages()
  const pages = [...ORDER.filter((s) => bySlug.has(s)).map((s) => bySlug.get(s)), ...[...bySlug.values()].filter((p) => !ORDER.includes(p.slug))]
  if (pages.length === 0) return null
  const page = slug ? bySlug.get(slug) : pages[0]
  if (!page) return null
  const idx = pages.findIndex((p) => p.slug === page.slug)
  const prev = idx > 0 ? pages[idx - 1] : null
  const next = idx < pages.length - 1 ? pages[idx + 1] : null
  const nav = pages
    .map((p) => `<a href="/docs/${p.slug}"${p.slug === page.slug ? ' class="on" aria-current="page"' : ''}>${esc(p.title)}</a>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} — DotChart docs</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar"><a class="brand" href="/docs">● DotChart</a><span class="crumb">documentation</span><a class="to-app" href="/">← back to the app</a></div>
<div class="layout">
<nav aria-label="Documentation pages">${nav}</nav>
<article>
${renderMarkdown(page.body)}
<div class="pager">
<span>${prev ? `<a href="/docs/${prev.slug}">← ${esc(prev.title)}</a>` : ''}</span>
<span>${next ? `<a href="/docs/${next.slug}">${esc(next.title)} →</a>` : ''}</span>
</div>
</article>
</div>
</body>
</html>`
}
