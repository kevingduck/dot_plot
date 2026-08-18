import { useEffect, useMemo, useState } from 'react'
import type { Dataset, EventType, GridRow, Shape } from '../types'
import type { ThemeColors } from '../theme'
import { seriesColor } from '../theme'
import { dayKey } from '../lib/model'
import { ShapeIcon } from './ShapeIcon'

interface Props {
  row: GridRow
  dataset: Dataset
  registry: EventType[]
  colors: ThemeColors
  onClose: () => void
}

interface LogLine {
  key: string
  label: string
  shape: Shape
  slot: number
  n: number
  first: number // ts of the first firing that day
  last: number // ts of the last
}

interface DayLog {
  ts: number // first event of the day, for ordering
  lines: LogLine[]
  hits: { key: string; ts: number }[] // every event, chronological
}

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * "2:14 PM" for one firing, "1:31 – 2:10 PM" for several. The meridiem (or
 * whatever trailing token the locale uses) is printed once when both ends
 * share it — repeating it eats the drawer's width for no information.
 */
function timeSpan(first: number, last: number): string {
  const a = fmtTime(first)
  const b = fmtTime(last)
  if (a === b) return a
  const tailA = a.slice(a.lastIndexOf(' ') + 1)
  const tailB = b.slice(b.lastIndexOf(' ') + 1)
  const head = tailA === tailB && a.includes(' ') ? a.slice(0, a.lastIndexOf(' ')) : a
  return `${head} – ${b}`
}

export function UserDrawer({ row, dataset, registry, colors, onClose }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeByKey = useMemo(() => new Map(registry.map((t) => [t.key, t])), [registry])

  // All-time log for this user, grouped by day then event, newest first.
  // Lines keep the RAW event names — the grid may fold long-tail events
  // into "Other", but the whole point of this drawer is the detail.
  const log = useMemo(() => {
    const byDay = new Map<string, DayLog>()
    for (const e of dataset.events) {
      if (e.userId !== row.user.id) continue
      const key = dayKey(e.ts)
      let day = byDay.get(key)
      if (!day) {
        day = { ts: e.ts, lines: [], hits: [] }
        byDay.set(key, day)
      }
      day.hits.push({ key: e.event, ts: e.ts })
    }
    // dataset.events is sorted by ts, so each day's hits already are too.
    for (const day of byDay.values()) {
      const seen = new Map<string, LogLine>()
      for (const hit of day.hits) {
        let line = seen.get(hit.key)
        if (!line) {
          const t = typeByKey.get(hit.key)
          line = {
            key: hit.key,
            label: t && t.key !== '__other__' ? t.label.toLowerCase() : hit.key.replace(/_/g, ' '),
            shape: t?.shape ?? 'dot',
            slot: t?.slot ?? -1,
            n: 0,
            first: hit.ts,
            last: hit.ts,
          }
          seen.set(hit.key, line)
        }
        line.n++
        line.last = hit.ts
      }
      // Registry order first (matching the legend), then long-tail events.
      const known = registry.filter((t) => t.key !== '__other__' && seen.has(t.key)).map((t) => seen.get(t.key)!)
      const rest = [...seen.values()].filter((l) => !typeByKey.has(l.key)).sort((a, b) => b.n - a.n)
      day.lines = [...known, ...rest]
      day.ts = day.hits[0].ts
    }
    return [...byDay.entries()].sort((a, b) => b[1].ts - a[1].ts)
  }, [dataset, registry, typeByKey, row.user.id])

  const labelFor = (key: string) => {
    const t = typeByKey.get(key)
    return t && t.key !== '__other__' ? t.label.toLowerCase() : key.replace(/_/g, ' ')
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const firstSeenDate = new Date(row.firstSeenKey + 'T00:00:00')

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" aria-label={`Details for ${row.user.name}`}>
        <div className="drawer-head">
          <div>
            <div className="drawer-name">{row.user.name}</div>
            <div className="drawer-id">{row.user.id}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="chip-row">
          <span className="chip">{row.user.platform}</span>
          <span className="chip">{row.user.plan}</span>
          <span className="chip">{row.user.country}</span>
        </div>
        <div className="drawer-stats">
          <div>
            <div className="stat-label">First seen</div>
            <div className="drawer-stat-value">{firstSeenDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          </div>
          <div>
            <div className="stat-label">Active days</div>
            <div className="drawer-stat-value">{row.activeDays}</div>
          </div>
          <div>
            <div className="stat-label">Events</div>
            <div className="drawer-stat-value">{row.totalEvents.toLocaleString()}</div>
          </div>
          <div>
            <div className="stat-label">Best streak</div>
            <div className="drawer-stat-value">{row.maxStreak}d</div>
          </div>
        </div>
        <div className="drawer-log-title">Event log (all time)</div>
        <div className="drawer-log-hint">Times are in your local timezone — click a day for the exact sequence.</div>
        {log.map(([key, day]) => {
          const open = expanded.has(key)
          return (
            <div className="log-day" key={key}>
              <button className="log-day-head" onClick={() => toggle(key)} aria-expanded={open}>
                <span className={`log-caret${open ? ' is-open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                <span className="log-date">
                  {new Date(key + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {key === row.firstSeenKey && <span className="log-first"> · first day</span>}
                </span>
                {day.lines.length > 1 && (
                  // With one event type the per-line span already says this.
                  <span className="log-day-span">{timeSpan(day.ts, day.hits[day.hits.length - 1].ts)}</span>
                )}
              </button>
              <div className="log-lines">
                {day.lines.map((line) => (
                  <div className={`log-event${line.slot < 0 ? ' log-event-other' : ''}`} key={line.key}>
                    <ShapeIcon shape={line.shape} color={seriesColor(colors, line.slot)} size={10} />
                    <span className="log-count">{line.n}</span>
                    <span className="log-label">{line.label}</span>
                    <span className="log-time">{timeSpan(line.first, line.last)}</span>
                  </div>
                ))}
              </div>
              {open && (
                <ol className="log-trace">
                  {day.hits.map((hit, i) => {
                    const t = typeByKey.get(hit.key)
                    return (
                      <li key={i}>
                        <span className="log-trace-time">{fmtTime(hit.ts)}</span>
                        <ShapeIcon shape={t?.shape ?? 'dot'} color={seriesColor(colors, t?.slot ?? -1)} size={8} />
                        <span className="log-trace-name">{labelFor(hit.key)}</span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )
        })}
      </aside>
    </>
  )
}
