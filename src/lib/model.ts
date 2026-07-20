import type { Dataset, DayCol, GridModel, GridRow, SortKey } from '../types'

const DAY = 86_400_000

export function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface DateRange {
  lastDays?: number // preset: N most recent days of data (0/undefined = all)
  from?: string // custom range, YYYY-MM-DD (local)
  to?: string
}

export interface ModelOptions {
  range: DateRange
  platform: string // 'all' or value
  plan: string
  search: string
  enabledEvents: Set<string>
  sortBy: SortKey
  registryKeys: string[] // event keys in cell-display priority order (rarest first)
}

/** First event timestamp per user across the ENTIRE dataset (pre-filter), used for onboarding rings + cohorts. */
export function firstSeenByUser(ds: Dataset): Map<string, number> {
  const first = new Map<string, number>()
  for (const e of ds.events) {
    if (!first.has(e.userId)) first.set(e.userId, e.ts) // events are sorted by ts
  }
  return first
}

export function buildModel(ds: Dataset, opts: ModelOptions): GridModel {
  if (ds.events.length === 0) return { days: [], rows: [] }

  const dataEnd = startOfDay(ds.events[ds.events.length - 1].ts)
  const dataStart = startOfDay(ds.events[0].ts)
  let rangeStart = dataStart
  let rangeEnd = dataEnd
  const { lastDays, from, to } = opts.range
  if (from || to) {
    if (to) {
      const t = startOfDay(new Date(to + 'T00:00:00').getTime())
      if (!Number.isNaN(t)) rangeEnd = Math.min(Math.max(t, dataStart), dataEnd)
    }
    if (from) {
      const f = startOfDay(new Date(from + 'T00:00:00').getTime())
      if (!Number.isNaN(f)) rangeStart = Math.min(Math.max(f, dataStart), rangeEnd)
    }
  } else if (lastDays && lastDays > 0) {
    rangeStart = Math.max(dataStart, rangeEnd - (lastDays - 1) * DAY)
  }
  const numDays = Math.round((rangeEnd - rangeStart) / DAY) + 1

  const days: DayCol[] = []
  let prevMonth = -1
  for (let i = 0; i < numDays; i++) {
    const date = new Date(rangeStart + i * DAY)
    const dow = date.getDay()
    days.push({
      date,
      key: dayKey(date.getTime()),
      weekend: dow === 0 || dow === 6,
      monthStart: date.getMonth() !== prevMonth,
    })
    prevMonth = date.getMonth()
  }

  const firstSeen = firstSeenByUser(ds)
  const known = new Set(opts.registryKeys)
  const normalize = (event: string) => (known.has(event) ? event : '__other__')

  const search = opts.search.trim().toLowerCase()
  const eligible = new Map<string, GridRow>()
  for (const u of ds.users) {
    if (opts.platform !== 'all' && u.platform !== opts.platform) continue
    if (opts.plan !== 'all' && u.plan !== opts.plan) continue
    if (search && !u.name.toLowerCase().includes(search) && !u.id.toLowerCase().includes(search)) continue
    const fs = firstSeen.get(u.id)
    if (fs === undefined) continue
    eligible.set(u.id, {
      user: u,
      cells: new Map(),
      firstSeenKey: dayKey(fs),
      activeDays: 0,
      totalEvents: 0,
      lastActiveIdx: -1,
      maxStreak: 0,
    })
  }

  const priority = new Map(opts.registryKeys.map((k, i) => [k, i]))
  for (const e of ds.events) {
    const row = eligible.get(e.userId)
    if (!row) continue
    const key = normalize(e.event)
    if (!opts.enabledEvents.has(key)) continue
    const dayTs = startOfDay(e.ts)
    if (dayTs < rangeStart || dayTs > rangeEnd) continue
    const idx = Math.round((dayTs - rangeStart) / DAY)
    let cell = row.cells.get(idx)
    if (!cell) {
      cell = { total: 0, counts: {}, primary: key }
      row.cells.set(idx, cell)
    }
    cell.total++
    cell.counts[key] = (cell.counts[key] ?? 0) + 1
    if ((priority.get(key) ?? 99) < (priority.get(cell.primary) ?? 99)) cell.primary = key
  }

  const rows: GridRow[] = []
  for (const row of eligible.values()) {
    if (row.cells.size === 0) continue
    row.activeDays = row.cells.size
    let streak = 0
    let best = 0
    for (let i = 0; i < numDays; i++) {
      const cell = row.cells.get(i)
      if (cell) {
        row.totalEvents += cell.total
        row.lastActiveIdx = i
        streak++
        if (streak > best) best = streak
      } else streak = 0
    }
    row.maxStreak = best
    rows.push(row)
  }

  const byFirstSeen = (a: GridRow, b: GridRow) => a.firstSeenKey.localeCompare(b.firstSeenKey) || a.user.name.localeCompare(b.user.name)
  switch (opts.sortBy) {
    case 'firstSeen':
      rows.sort(byFirstSeen)
      break
    case 'activeDays':
      rows.sort((a, b) => b.activeDays - a.activeDays || byFirstSeen(a, b))
      break
    case 'lastActive':
      rows.sort((a, b) => b.lastActiveIdx - a.lastActiveIdx || byFirstSeen(a, b))
      break
    case 'streak':
      rows.sort((a, b) => b.maxStreak - a.maxStreak || byFirstSeen(a, b))
      break
  }

  return { days, rows }
}

export interface Stats {
  users: number
  activeLastDay: number
  coreEvents: number
  oneAndDone: number // fraction 0..1, users whose only active day was their first
}

export function computeStats(model: GridModel, coreKey: string | null): Stats {
  const lastIdx = model.days.length - 1
  let activeLastDay = 0
  let coreEvents = 0
  let oneAndDone = 0
  for (const row of model.rows) {
    if (row.cells.has(lastIdx)) activeLastDay++
    if (row.activeDays === 1) {
      const [idx] = row.cells.keys()
      if (model.days[idx]?.key === row.firstSeenKey) oneAndDone++
    }
    if (coreKey) {
      for (const cell of row.cells.values()) coreEvents += cell.counts[coreKey] ?? 0
    } else {
      coreEvents += row.totalEvents
    }
  }
  return {
    users: model.rows.length,
    activeLastDay,
    coreEvents,
    oneAndDone: model.rows.length > 0 ? oneAndDone / model.rows.length : 0,
  }
}
