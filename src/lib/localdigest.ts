// Browser-side project digest: in hosted mode the server can't see this
// machine, so the browser walks the picked folder locally (same rules as the
// server-side scanner) and uploads only the filtered code digest.

export interface LocalDigest {
  name: string
  digest: string
  included: number
  skipped: number
  databases: { envFile: string; varName: string; connectionString: string; redacted: string }[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.cache'])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php', '.swift', '.vue', '.svelte', '.html'])
const DOC_FILES = new Set(['readme.md', 'package.json', 'pyproject.toml', 'gemfile', 'go.mod', 'cargo.toml', 'composer.json'])
const ENV_FILES = new Set(['.env', '.env.local', '.env.development', '.env.development.local'])
const SKIP_FILE_RE = /\.(test|spec|stories|min)\.|\.d\.ts$|\.lock$|-lock\./i
const MAX_TOTAL = 400_000
const MAX_FILE = 24_000

function priorityOf(rel: string): number {
  const p = rel.toLowerCase()
  if (DOC_FILES.has(p.split('/').pop() ?? '')) return 0
  if (/(routes?|router|pages?|views?|controllers?|handlers?|api|endpoints?)\b/.test(p)) return 1
  if (/(app|main|index|server)\.[a-z]+$/.test(p)) return 2
  if (/(components?|features?|screens?|actions?|mutations?|services?|models?)\b/.test(p)) return 3
  return 4
}

interface Entry {
  rel: string
  file: File
}

async function walkHandle(dir: FileSystemDirectoryHandle, prefix: string, out: Entry[], depth: number, envs: Entry[]) {
  if (depth > 8 || out.length > 3000) return
  for await (const handle of dir.values()) {
    const rel = prefix ? `${prefix}/${handle.name}` : handle.name
    if (handle.kind === 'directory') {
      if (!SKIP_DIRS.has(handle.name) && !handle.name.startsWith('.')) {
        await walkHandle(handle, rel, out, depth + 1, envs)
      }
    } else {
      if (depth === 0 && ENV_FILES.has(handle.name)) {
        envs.push({ rel, file: await (handle as FileSystemFileHandle).getFile() })
        continue
      }
      const ext = ('.' + handle.name.split('.').pop()).toLowerCase()
      const isDoc = DOC_FILES.has(handle.name.toLowerCase())
      if (!isDoc && !CODE_EXT.has(ext)) continue
      if (SKIP_FILE_RE.test(handle.name)) continue
      const file = await (handle as FileSystemFileHandle).getFile()
      if (file.size === 0 || file.size > 400_000) continue
      out.push({ rel, file })
    }
  }
}

function entriesFromFileList(files: FileList): { name: string; entries: Entry[]; envs: Entry[] } {
  const entries: Entry[] = []
  const envs: Entry[] = []
  let name = 'project'
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    if (parts.length > 1) name = parts[0]
    const rel = parts.slice(1).join('/') || file.name
    const segs = rel.split('/')
    if (segs.some((s) => SKIP_DIRS.has(s) || (s.startsWith('.') && !ENV_FILES.has(s)))) continue
    if (segs.length === 1 && ENV_FILES.has(segs[0])) {
      envs.push({ rel, file })
      continue
    }
    const base = segs[segs.length - 1]
    const ext = ('.' + base.split('.').pop()).toLowerCase()
    if (!DOC_FILES.has(base.toLowerCase()) && !CODE_EXT.has(ext)) continue
    if (SKIP_FILE_RE.test(base)) continue
    if (file.size === 0 || file.size > 400_000) continue
    entries.push({ rel, file })
  }
  return { name, entries, envs }
}

async function buildDigest(name: string, entries: Entry[], envs: Entry[]): Promise<LocalDigest> {
  entries.sort((a, b) => priorityOf(a.rel) - priorityOf(b.rel) || a.file.size - b.file.size)
  const parts: string[] = []
  let total = 0
  let included = 0
  for (const e of entries) {
    if (total > MAX_TOTAL) break
    let text = await e.file.text()
    if (text.includes('\u0000')) continue
    if (text.length > MAX_FILE) text = text.slice(0, MAX_FILE) + `\n… [truncated, ${text.length} chars total]`
    parts.push(`===== FILE: ${e.rel} =====\n${text}`)
    total += text.length
    included++
  }
  const databases: LocalDigest['databases'] = []
  for (const env of envs) {
    const text = await env.file.text()
    for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z0-9_]*(?:DATABASE|POSTGRES|PG)[A-Z0-9_]*)\s*=\s*["']?(postgres(?:ql)?:\/\/[^"'\s]+)["']?/gim)) {
      if (!databases.some((d) => d.connectionString === m[2])) {
        databases.push({
          envFile: env.rel,
          varName: m[1],
          connectionString: m[2],
          redacted: m[2].replace(/:\/\/([^:@/]+):[^@]+@/, '://$1:••••@'),
        })
      }
    }
  }
  return { name, digest: parts.join('\n\n'), included, skipped: entries.length - included, databases }
}

/** Native directory picker (Chrome/Edge). Returns null if unsupported or cancelled. */
export async function pickLocalFolder(): Promise<LocalDigest | null> {
  if (typeof window.showDirectoryPicker !== 'function') return null
  let handle: FileSystemDirectoryHandle
  try {
    handle = await window.showDirectoryPicker({ mode: 'read' })
  } catch {
    return null // user cancelled
  }
  const entries: Entry[] = []
  const envs: Entry[] = []
  await walkHandle(handle, '', entries, 0, envs)
  return buildDigest(handle.name, entries, envs)
}

/** Fallback for browsers without showDirectoryPicker (webkitdirectory input). */
export async function digestFromFileList(files: FileList): Promise<LocalDigest> {
  const { name, entries, envs } = entriesFromFileList(files)
  return buildDigest(name, entries, envs)
}
