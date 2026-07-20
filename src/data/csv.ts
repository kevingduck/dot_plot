import type { Dataset, EventType, RawEvent, Shape, User } from './../types'

// CSV import: required columns user_id, event, timestamp (ISO 8601 or epoch
// seconds/ms). Optional: name, platform, plan, country. Event types are
// derived from the data: top 4 by frequency get a slot + shape (most frequent
// is treated as the core event), the rest fold into "other".

const SHAPES: Shape[] = ['circle', 'square', 'diamond', 'triangle']

function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function parseTs(raw: string): number {
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return n < 1e12 ? n * 1000 : n // epoch seconds vs ms
  }
  const t = Date.parse(trimmed)
  return Number.isNaN(t) ? NaN : t
}

export function labelFromKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function parseCsv(text: string, fileName: string): Dataset {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row')

  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const iUser = col('user_id')
  const iEvent = col('event')
  const iTs = col('timestamp')
  if (iUser < 0 || iEvent < 0 || iTs < 0) {
    throw new Error('CSV must have columns: user_id, event, timestamp (optional: name, platform, plan, country)')
  }
  const iName = col('name')
  const iPlatform = col('platform')
  const iPlan = col('plan')
  const iCountry = col('country')

  const users = new Map<string, User>()
  const events: RawEvent[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    const userId = (cells[iUser] ?? '').trim()
    const event = (cells[iEvent] ?? '').trim()
    const ts = parseTs(cells[iTs] ?? '')
    if (!userId || !event || Number.isNaN(ts)) {
      skipped++
      continue
    }
    if (!users.has(userId)) {
      users.set(userId, {
        id: userId,
        name: (iName >= 0 && cells[iName]?.trim()) || userId,
        platform: (iPlatform >= 0 && cells[iPlatform]?.trim()) || '—',
        plan: (iPlan >= 0 && cells[iPlan]?.trim()) || '—',
        country: (iCountry >= 0 && cells[iCountry]?.trim()) || '—',
      })
    }
    events.push({ userId, event, ts })
  }

  if (events.length === 0) throw new Error('No valid rows found (check timestamp format)')

  const freq = new Map<string, number>()
  for (const e of events) freq.set(e.event, (freq.get(e.event) ?? 0) + 1)
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)

  const registry: EventType[] = ranked.slice(0, 4).map((key, i) => ({
    key,
    label: labelFromKey(key),
    shape: SHAPES[i],
    slot: i,
    core: i === 0,
  }))
  if (ranked.length > 4) {
    registry.push({ key: '__other__', label: `Other (${ranked.length - 4} types)`, shape: 'dot', slot: -1, core: false })
  }

  events.sort((a, b) => a.ts - b.ts)
  const suffix = skipped > 0 ? `, ${skipped} rows skipped` : ''
  return { users: [...users.values()], events, registry, source: `${fileName}${suffix}` }
}

export function toCsv(ds: Dataset): string {
  const userById = new Map(ds.users.map((u) => [u.id, u]))
  const rows = ['user_id,event,timestamp,name,platform,plan,country']
  for (const e of ds.events) {
    const u = userById.get(e.userId)
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    rows.push([e.userId, e.event, new Date(e.ts).toISOString(), esc(u?.name ?? ''), u?.platform ?? '', u?.plan ?? '', u?.country ?? ''].join(','))
  }
  return rows.join('\n')
}
