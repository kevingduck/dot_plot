import type { Stats } from '../lib/model'

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function StatTiles({ stats, coreLabel }: { stats: Stats; coreLabel: string }) {
  const tiles = [
    { label: 'Users in view', value: compact(stats.users) },
    { label: 'Active on last day', value: compact(stats.activeLastDay) },
    { label: `${coreLabel} events`, value: compact(stats.coreEvents) },
    { label: 'One-and-done users', value: `${Math.round(stats.oneAndDone * 100)}%`, note: 'only active on their first day' },
  ]
  return (
    <div className="stat-row">
      {tiles.map((t) => (
        <div className="stat-tile" key={t.label}>
          <div className="stat-label">{t.label}</div>
          <div className="stat-value">{t.value}</div>
          {t.note && <div className="stat-note">{t.note}</div>}
        </div>
      ))}
    </div>
  )
}
