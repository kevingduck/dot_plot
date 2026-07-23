// DotChart instrumentation: turn an accepted event plan into reviewable code
// edits, then apply ONLY user-approved edits on a fresh git branch.
//
// Safety model:
//   - prepare() never touches the repo — it returns proposed edits + the SDK
//     file for review. Every edit is exact-string, additive, and pre-validated
//     against the file on disk (unique match required).
//   - apply() refuses to run on a dirty working tree or outside a git repo,
//     creates a new dotchart/* branch from HEAD, writes the approved changes,
//     commits, and returns to the original branch — the user's checkout is
//     left exactly as it was; the changes exist only on the branch.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { aiLabel, resolveAi, runStructured } from './llm.mjs'

function git(repo, args, opts = {}) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', ...opts }).trim()
}

function sdkTemplate(isTs, isCjs) {
  const types = isTs ? ': Record<string, unknown>' : ''
  const idType = isTs ? ': string | number | null | undefined' : ''
  const sigTypes = isTs
    ? '(userId: string | number | null | undefined, event: string, props: Record<string, unknown> = {})'
    : '(userId, event, props = {})'
  const declTrack = isCjs ? `function track${sigTypes}` : `export function track${sigTypes}`
  const declIdentify = isCjs ? `function identify(userId${idType})` : `export function identify(userId${idType})`
  const exports = isCjs ? `\nmodule.exports = { track, identify }\n` : `\nexport default { track, identify }\n`
  return `// DotChart tracking client. Safe no-op unless DOTCHART_INGEST_URL is set
// (env var on the server, window.DOTCHART_INGEST_URL in the browser).
// Fire-and-forget: never throws, never blocks, never breaks the host app.
//
// Identity is handled for you: pass a user id when one is in scope, or null
// when it isn't. In the browser, null resolves to the identify()'d user —
// call identify(user.id) once at login — or a stable per-visitor id, so every
// person gets their own row either way.

let _uid${isTs ? ': string | null' : ''} = null

/** Remember who the current user is (call once at login/session restore). */
${declIdentify} {
  try {
    _uid = userId == null || userId === '' ? null : String(userId)
    if (_uid && typeof localStorage !== 'undefined') localStorage.setItem('dotchart_uid', _uid)
  } catch {
    // analytics must never take the app down
  }
}

${declTrack} {
  try {
    const url =
      (typeof process !== 'undefined' && process.env && process.env.DOTCHART_INGEST_URL) ||
      (typeof window !== 'undefined' && (window${isTs ? ' as unknown as { DOTCHART_INGEST_URL?: string }' : ''}).DOTCHART_INGEST_URL) ||
      ''
    if (!url || !event) return
    let id = userId == null || userId === '' || userId === 'anonymous' ? _uid : String(userId)
    // Browser with no known user: stable per-visitor id, one row per person
    if (!id && typeof localStorage !== 'undefined') {
      let uid = localStorage.getItem('dotchart_uid')
      if (!uid) {
        uid = 'anon_' + Math.random().toString(36).slice(2, 10)
        localStorage.setItem('dotchart_uid', uid)
      }
      id = uid
    }
    if (!id) return // server-side with no identity: nothing to attribute
    const payload${types} = {
      user_id: String(id),
      event: event,
      timestamp: new Date().toISOString(),
      props: props,
    }
    if (typeof fetch === 'function') {
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // analytics must never take the app down
  }
}
${exports}`
}

function detectModuleStyle(root, sampleFiles) {
  const isTs = fs.existsSync(path.join(root, 'tsconfig.json'))
  if (isTs) return { isTs: true, isCjs: false }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (pkg.type === 'module') return { isTs: false, isCjs: false }
  } catch {
    /* no package.json */
  }
  // No ESM signal — if the code uses require(), emit a CommonJS SDK
  const usesRequire = sampleFiles.some((f) => /\brequire\s*\(/.test(f.content))
  const usesImport = sampleFiles.some((f) => /^\s*import\s/m.test(f.content))
  return { isTs: false, isCjs: usesRequire && !usesImport }
}

function pickSdkPath(root, style) {
  const ext = style.isTs ? 'ts' : 'js'
  for (const dir of ['src/lib', 'src', 'lib', 'app/lib', 'app']) {
    if (fs.existsSync(path.join(root, dir))) return `${dir}/dotchart.${ext}`
  }
  return `dotchart.${ext}`
}

const EDITS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['edits', 'notes'],
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['event_key', 'file', 'old_string', 'new_string', 'explanation'],
        properties: {
          event_key: { type: 'string' },
          file: { type: 'string', description: 'Repo-relative path of the file being edited' },
          old_string: { type: 'string', description: 'EXACT text copied verbatim from the file, unique within it' },
          new_string: { type: 'string', description: 'The same text with the tracking call (and import, if part of this edit) added' },
          explanation: { type: 'string', description: 'One sentence: what this edit adds and where' },
        },
      },
    },
    notes: { type: 'string', description: 'Anything skipped or worth flagging to the reviewer; empty string if none' },
  },
}

const INSTRUMENT_SYSTEM = `You generate minimal, additive code edits that insert analytics tracking calls into an existing codebase. The edits will be shown to the developer as diffs for approval, then applied by exact string replacement.

Hard rules:
- old_string MUST be copied character-for-character from the provided file content (including whitespace/indentation) and MUST appear exactly once in that file. Include enough surrounding lines to make it unique.
- new_string must contain the same code with ONLY additions — never delete, reorder, or rewrite existing logic. Match the file's indentation, quote style, and semicolon conventions.
- Insert the track call at the point where the action has SUCCEEDED (after the successful write/response, not before validation).
- Each file that gains a track call also needs the import added once — do that as its own separate edit near the file's other imports (skip if the file already imports it).
- Use the SDK exactly as: track(userId, 'event_key', { ...small useful props }). Derive userId from what's actually PROVABLY in scope in that code. If no user identifier is in scope, pass null — the SDK resolves identity itself (an identify()'d user, else a stable per-browser visitor id). NEVER invent an identifier and NEVER pass a placeholder string like 'anonymous'.
- If the codebase has an obvious login/session-restore success point among the provided files, add ONE extra edit there calling identify(<the user id in scope>) so anonymous visitors upgrade to their real id. Skip this if no such point is in the provided files.
- In server-side code with no user identifier in scope, skip that location and explain why in notes (null-id events are dropped server-side by design).
- CRITICAL: every identifier in the props object must be PROVABLY in scope at the exact insertion point (declared in the same function, an enclosing scope, or module level — check, don't assume). A single out-of-scope reference throws at runtime and silently kills the event. When any doubt exists, OMIT the prop — a track call with fewer props always beats one that crashes.
- Only instrument the events and locations provided. If a location can't be instrumented safely, omit it and explain why in notes.
- Never touch package.json, config files, or tests.`

/**
 * Stage 1 — propose edits. Read-only: returns {sdk_file, edits[], notes};
 * each edit pre-validated with status 'ok' | 'no_match' | 'ambiguous'.
 */
export async function prepareInstrumentation(targetPath, events, { onStatus = () => {}, model, apiKey, provider, baseUrl, allowEnvKey } = {}) {
  const ai = resolveAi({ provider, model, apiKey, baseUrl, allowEnvKey })
  const root = path.resolve(targetPath)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`)

  // Gather the target files referenced by the accepted instrumentation points
  const wanted = []
  const missing = []
  const seen = new Set()
  for (const ev of events) {
    for (const p of ev.instrumentation ?? []) {
      if (seen.has(p.file)) continue
      seen.add(p.file)
      const full = path.join(root, p.file)
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        wanted.push({ rel: p.file, content: fs.readFileSync(full, 'utf8') })
      } else {
        missing.push(p.file)
      }
    }
  }
  if (wanted.length === 0) throw new Error('None of the instrumentation files exist in the target repo — re-scan the codebase first')
  onStatus(`Reading ${wanted.length} target file${wanted.length === 1 ? '' : 's'}${missing.length ? ` (${missing.length} referenced files not found)` : ''}…`)

  const style = detectModuleStyle(root, wanted)
  const sdk = { rel: pickSdkPath(root, style), isTs: style.isTs, isCjs: style.isCjs }
  onStatus(`SDK will be added at ${sdk.rel} (${style.isTs ? 'TypeScript' : style.isCjs ? 'CommonJS' : 'ES module'})`)

  const eventsBrief = events.map((e) => ({
    key: e.key,
    label: e.label,
    points: (e.instrumentation ?? []).filter((p) => !missing.includes(p.file)),
  }))

  const importName = path.basename(sdk.rel).replace(/\.(ts|js)$/, '')
  const fileBlobs = wanted.map((f) => `===== FILE: ${f.rel} =====\n${f.content}`).join('\n\n')
  const userPrompt = `The DotChart SDK will be created at "${sdk.rel}" as a ${sdk.isTs ? 'TypeScript ES module' : sdk.isCjs ? 'CommonJS module (use const { track } = require(...))' : 'ES module (use import { track } from ...)'}.
Compute the correct relative path from each edited file's location; omit the file extension${sdk.isTs ? '' : ' or keep .js if the project uses explicit extensions'}. Match each file's existing import style.

Events to instrument (with suggested locations from a prior scan — verify them against the real code below and correct if the suggestion is off):
${JSON.stringify(eventsBrief, null, 2)}

Files:

${fileBlobs}`

  onStatus(`Asking ${aiLabel(ai)} to draft the edits…`)
  let drafted = 0
  const { object: raw, usage } = await runStructured(ai, {
    system: INSTRUMENT_SYSTEM,
    prompt: userPrompt,
    schema: EDITS_SCHEMA,
    maxTokens: 32000,
    onStatus,
    onText: (snapshot) => {
      const n = (snapshot.match(/"old_string"/g) || []).length
      if (n > drafted) {
        drafted = n
        onStatus(`Drafting edits — ${n} so far…`)
      }
    },
  })
  if (!raw || !Array.isArray(raw.edits)) throw new Error('The model did not return edits')

  // Pre-validate every edit against the file on disk
  const fileCache = new Map(wanted.map((f) => [f.rel, f.content]))
  const edits = raw.edits.map((e, i) => {
    let status = 'ok'
    let reason = ''
    const content = fileCache.get(e.file)
    if (content === undefined) {
      status = 'no_match'
      reason = 'file was not part of the scan'
    } else {
      const count = content.split(e.old_string).length - 1
      if (e.old_string.length < 8 || e.old_string === e.new_string) {
        status = 'no_match'
        reason = 'degenerate edit'
      } else if (count === 0) {
        status = 'no_match'
        reason = 'old_string not found in file'
      } else if (count > 1) {
        status = 'ambiguous'
        reason = `old_string appears ${count} times`
      } else if (!e.new_string.includes('track')) {
        // import-only edits also mention the sdk name; require some signal
        if (!e.new_string.includes(importName)) {
          status = 'no_match'
          reason = 'edit does not reference the SDK'
        }
      }
    }
    return { id: `edit_${i}`, ...e, status, reason }
  })

  return {
    sdk_file: { path: sdk.rel, content: sdkTemplate(sdk.isTs, sdk.isCjs) },
    edits,
    notes: [raw.notes, missing.length ? `Files referenced by the plan but not found: ${missing.join(', ')}` : '']
      .filter(Boolean)
      .join(' '),
    meta: {
      target: root,
      model: ai.model,
      provider: ai.provider,
      usage,
    },
  }
}

/**
 * Push a dotchart/* branch to the repo's GitHub origin with a one-time
 * token (hosted flow: the clone lives on the server, the review happens on
 * GitHub). The token goes only into this single git invocation.
 */
export function pushBranch(targetPath, branch, baseBranch, token) {
  const root = path.resolve(targetPath)
  const origin = git(root, ['remote', 'get-url', 'origin'])
  const m = origin.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
  if (!m) throw new Error('This repository has no GitHub origin to push to')
  const slug = m[1]
  try {
    git(root, ['push', `https://x-access-token:${encodeURIComponent(token)}@github.com/${slug}.git`, `${branch}:${branch}`])
  } catch (err) {
    const detail = String(err.stderr || err.message || '').split(token).join('••••')
    if (/403|permission|denied|authentication/i.test(detail)) {
      throw new Error('GitHub rejected the push — the token needs Contents: read & write access to this repository')
    }
    throw new Error(`Push failed: ${detail.slice(0, 300)}`)
  }
  return { compareUrl: `https://github.com/${slug}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1` }
}

/**
 * Stage 2 — apply approved edits on a new git branch. The user's current
 * branch and working tree are left untouched.
 */
export function applyInstrumentation(targetPath, { sdkFile, edits, ingestUrl }) {
  const root = path.resolve(targetPath)

  let insideRepo = false
  try {
    insideRepo = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true'
  } catch {
    insideRepo = false
  }
  if (!insideRepo) throw new Error(`${root} is not a git repository — init git first so changes land on a reviewable branch`)
  if (git(root, ['status', '--porcelain']) !== '') {
    throw new Error('Working tree has uncommitted changes — commit or stash them first so the DotChart branch starts clean')
  }

  const baseBranch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  const branch = `dotchart/instrumentation-${stamp}`

  // Re-validate against disk right before applying
  const applied = []
  const skipped = []
  const plans = []
  for (const e of edits) {
    const full = path.join(root, e.file)
    let content
    try {
      content = fs.readFileSync(full, 'utf8')
    } catch {
      skipped.push({ ...e, reason: 'file missing' })
      continue
    }
    const count = content.split(e.old_string).length - 1
    if (count !== 1) {
      skipped.push({ ...e, reason: count === 0 ? 'no longer matches file' : 'match is ambiguous' })
      continue
    }
    plans.push({ ...e, full })
  }
  if (plans.length === 0 && !sdkFile) throw new Error('No edits left to apply')

  git(root, ['checkout', '-b', branch])
  try {
    if (sdkFile) {
      const sdkFull = path.join(root, sdkFile.path)
      fs.mkdirSync(path.dirname(sdkFull), { recursive: true })
      fs.writeFileSync(sdkFull, sdkFile.content)
    }
    // Group edits per file so multiple edits to one file compose
    const byFile = new Map()
    for (const p of plans) {
      if (!byFile.has(p.full)) byFile.set(p.full, [])
      byFile.get(p.full).push(p)
    }
    for (const [full, fileEdits] of byFile) {
      let content = fs.readFileSync(full, 'utf8')
      for (const e of fileEdits) {
        const count = content.split(e.old_string).length - 1
        if (count !== 1) {
          skipped.push({ ...e, reason: 'invalidated by a previous edit in the same file' })
          continue
        }
        content = content.replace(e.old_string, e.new_string)
        applied.push(e)
      }
      fs.writeFileSync(full, content)
    }

    git(root, ['add', '-A'])
    const eventKeys = [...new Set(applied.map((e) => e.event_key))].join(', ')
    git(root, [
      'commit',
      '-m',
      `Add DotChart analytics instrumentation\n\nAdds ${sdkFile ? sdkFile.path + ' (fire-and-forget tracking client) and ' : ''}track() calls for: ${eventKeys || 'no events'}.\nGenerated by DotChart from the accepted event plan; every edit was reviewed before applying.\n\nTo activate after merging, set in the app's environment:\n  DOTCHART_INGEST_URL=${ingestUrl || '<your DotChart URL>/ingest'}\nWith it unset this branch is a complete no-op.`,
    ])
    const commit = git(root, ['rev-parse', '--short', 'HEAD'])
    git(root, ['checkout', baseBranch])
    return {
      branch,
      baseBranch,
      commit,
      applied: applied.map(({ full: _full, ...e }) => e),
      skipped: skipped.map(({ full: _full, ...e }) => e),
      filesChanged: [...new Set([...(sdkFile ? [sdkFile.path] : []), ...applied.map((e) => e.file)])],
    }
  } catch (err) {
    // Roll back: restore the original branch and drop the partial branch
    try {
      git(root, ['checkout', '-f', baseBranch])
      git(root, ['branch', '-D', branch])
    } catch {
      /* leave whatever state we can */
    }
    throw err
  }
}
