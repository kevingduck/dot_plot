import type { Dataset, GridModel } from '../types'

export interface Insight {
  title: string
  detail: string
  kind: 'churn_risk' | 'activation' | 'pattern' | 'milestone'
  user_ids: string[]
}

/** Compact per-user summary for the pattern spotter — small enough to be cheap. */
export function buildUsageSummary(model: GridModel, dataset: Dataset) {
  const days = model.days
  const lastIdx = days.length - 1
  const users = model.rows.slice(0, 150).map((row) => {
    const counts: Record<string, number> = {}
    let weekday = 0
    let weekend = 0
    for (const [idx, cell] of row.cells) {
      if (days[idx]?.weekend) weekend++
      else weekday++
      for (const [k, n] of Object.entries(cell.counts)) counts[k] = (counts[k] ?? 0) + n
    }
    let recent = ''
    for (let i = Math.max(0, lastIdx - 27); i <= lastIdx; i++) recent += row.cells.has(i) ? '1' : '0'
    return {
      id: row.user.id,
      name: row.user.name !== row.user.id ? row.user.name : undefined,
      first_seen: row.firstSeenKey,
      active_days: row.activeDays,
      best_streak: row.maxStreak,
      days_since_last_active: row.lastActiveIdx >= 0 ? lastIdx - row.lastActiveIdx : null,
      weekday_days: weekday,
      weekend_days: weekend,
      events: counts,
      recent,
    }
  })
  return {
    product: dataset.source,
    date_range: { from: days[0]?.key, to: days[lastIdx]?.key, days: days.length },
    core_event: dataset.registry.find((t) => t.core)?.key ?? null,
    event_labels: Object.fromEntries(dataset.registry.map((t) => [t.key, t.label])),
    users_shown: users.length,
    users_total: model.rows.length,
    users,
  }
}
