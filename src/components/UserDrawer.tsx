import { useEffect, useMemo } from 'react'
import type { Dataset, EventType, GridRow } from '../types'
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

export function UserDrawer({ row, dataset, registry, colors, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeByKey = useMemo(() => new Map(registry.map((t) => [t.key, t])), [registry])

  // All-time log for this user, grouped by day then event, newest first
  const log = useMemo(() => {
    const byDay = new Map<string, { ts: number; counts: Map<string, number> }>()
    for (const e of dataset.events) {
      if (e.userId !== row.user.id) continue
      const key = dayKey(e.ts)
      let entry = byDay.get(key)
      if (!entry) {
        entry = { ts: e.ts, counts: new Map() }
        byDay.set(key, entry)
      }
      const norm = typeByKey.has(e.event) ? e.event : '__other__'
      entry.counts.set(norm, (entry.counts.get(norm) ?? 0) + 1)
    }
    return [...byDay.entries()].sort((a, b) => b[1].ts - a[1].ts)
  }, [dataset, row.user.id, typeByKey])

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
        <table className="drawer-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {log.map(([key, entry]) => (
              <tr key={key}>
                <td className="log-date">
                  {new Date(key + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {key === row.firstSeenKey && <span className="log-first"> · first day</span>}
                </td>
                <td>
                  {registry
                    .filter((t) => (entry.counts.get(t.key) ?? 0) > 0)
                    .map((t) => (
                      <span className="log-event" key={t.key}>
                        <ShapeIcon shape={t.shape} color={seriesColor(colors, t.slot)} size={10} />
                        <span className="log-count">{entry.counts.get(t.key)}</span> {t.label.toLowerCase()}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </>
  )
}
