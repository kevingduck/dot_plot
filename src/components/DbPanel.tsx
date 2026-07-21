import { useState } from 'react'
import type { DbSyncConfig, DbTable, RawEvent } from '../types'
import { postJson } from '../lib/api'

interface Props {
  onImport: (events: RawEvent[], source: string, sync?: DbSyncConfig) => void
}

interface ImportResponse {
  events: { userId: string; event: string; ts: number }[]
  summary: { table: string; event: string; rows: number; error?: string }[]
}

export function DbPanel({ onImport }: Props) {
  const [conn, setConn] = useState('')
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'review' | 'importing'>('idle')
  const [tables, setTables] = useState<DbTable[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [eventKeys, setEventKeys] = useState<Map<string, string>>(new Map())
  const [days, setDays] = useState(90)
  const [error, setError] = useState<string | null>(null)

  const scan = async () => {
    setPhase('scanning')
    setError(null)
    try {
      const out = await postJson<{ tables: DbTable[] }>('/api/db/scan', { connectionString: conn.trim() })
      setTables(out.tables)
      setChecked(new Set(out.tables.filter((t) => t.eligible && t.approx_rows > 0).map((t) => t.table)))
      setEventKeys(new Map(out.tables.map((t) => [t.table, t.suggested_event])))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }

  const runImport = async () => {
    setPhase('importing')
    setError(null)
    try {
      const mappings = tables
        .filter((t) => checked.has(t.table))
        .map((t) => ({
          table: t.table,
          event: eventKeys.get(t.table) ?? t.suggested_event,
          user_column: t.user_column,
          timestamp_column: t.timestamp_column,
        }))
      const out = await postJson<ImportResponse>('/api/db/import', { connectionString: conn.trim(), mappings, days })
      const failed = out.summary.filter((s) => s.error)
      if (out.events.length === 0) {
        throw new Error(
          `No events found in the last ${days} days` + (failed.length ? ` (${failed.map((f) => `${f.table}: ${f.error}`).join('; ')})` : ''),
        )
      }
      const dbName = conn.trim().split('/').pop()?.split('?')[0] ?? 'database'
      onImport(
        out.events,
        `${dbName} (read-only import, last ${days}d)` + (failed.length ? ` — ${failed.length} tables failed` : ''),
        { connectionString: conn.trim(), mappings, days },
      )
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('review')
    }
  }

  return (
    <div className="db-panel">
      <div className="scan-bar-main">
        <input
          type="text"
          className="scan-path"
          placeholder="postgres://user@host:5432/dbname  (read-only scan)"
          value={conn}
          onChange={(e) => setConn(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && conn.trim() && scan()}
          disabled={phase === 'scanning' || phase === 'importing'}
          aria-label="Postgres connection string"
        />
        <button className="btn" onClick={scan} disabled={!conn.trim() || phase === 'scanning' || phase === 'importing'}>
          {phase === 'scanning' ? 'Scanning schema…' : 'Scan database'}
        </button>
      </div>
      <div className="scan-hint">
        Connects once with <code>default_transaction_read_only=on</code> (Postgres rejects any write), lists tables that
        look like event streams (a user column + a timestamp column), and imports only the rows you approve. The
        connection string is used from the local dev server and never stored.
      </div>
      {error && <div className="scan-error">⚠ {error}</div>}

      {(phase === 'review' || phase === 'importing') && tables.length > 0 && (
        <div className="db-review">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Import</th>
                <th>Table</th>
                <th>~Rows</th>
                <th>User column</th>
                <th>Timestamp</th>
                <th>Event key</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.table} className={t.eligible ? '' : 'plan-row-off'}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!t.eligible}
                      checked={checked.has(t.table)}
                      onChange={() => {
                        const next = new Set(checked)
                        if (next.has(t.table)) next.delete(t.table)
                        else next.add(t.table)
                        setChecked(next)
                      }}
                      aria-label={`Import ${t.table}`}
                    />
                  </td>
                  <td>
                    <code>{t.table}</code>
                  </td>
                  <td className="db-rows">{t.approx_rows.toLocaleString()}</td>
                  <td>{t.user_column ?? <span className="edit-reason">none found</span>}</td>
                  <td>{t.timestamp_column ?? <span className="edit-reason">none found</span>}</td>
                  <td>
                    {t.eligible ? (
                      <input
                        type="text"
                        className="db-event-key"
                        value={eventKeys.get(t.table) ?? ''}
                        onChange={(e) => setEventKeys(new Map(eventKeys).set(t.table, e.target.value))}
                        aria-label={`Event key for ${t.table}`}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="db-import-row">
            <label className="scan-hint">
              Last{' '}
              <input
                type="number"
                className="db-days"
                min={1}
                max={730}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 90)}
              />{' '}
              days
            </label>
            <button className="btn btn-primary" onClick={runImport} disabled={checked.size === 0 || phase === 'importing'}>
              {phase === 'importing' ? 'Importing…' : `Import events from ${checked.size} table${checked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
