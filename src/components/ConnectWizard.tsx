import { useMemo, useState } from 'react'
import type { DiscoveredProject, EventPlan, RawEvent } from '../types'
import { postJson, postNdjson } from '../lib/api'

type Phase = 'path' | 'discovering' | 'discovered' | 'analyzing' | 'review' | 'importing'

interface ImportResponse {
  events: { userId: string; event: string; ts: number }[]
  summary: { table: string; event: string; rows: number; error?: string }[]
}

interface Props {
  onData: (events: RawEvent[], source: string, plan: EventPlan) => void
  onPlanOnly: (plan: EventPlan) => void
  onClose: () => void
}

const TIER_LABEL: Record<string, string> = { core: 'Core value', activation: 'Activation', feature: 'Feature', noise: 'Noise' }

export function ConnectWizard({ onData, onPlanOnly, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('path')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [project, setProject] = useState<DiscoveredProject | null>(null)
  const [useDb, setUseDb] = useState(true)
  const [dbIndex, setDbIndex] = useState(0)
  const [plan, setPlan] = useState<EventPlan | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(90)

  const discover = async () => {
    setPhase('discovering')
    setError(null)
    try {
      const p = await postJson<DiscoveredProject>('/api/connect/discover', { path: path.trim() })
      setProject(p)
      setUseDb(p.databases.length > 0)
      setDbIndex(0)
      setPhase('discovered')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('path')
    }
  }

  const analyze = async () => {
    if (!project) return
    setPhase('analyzing')
    setError(null)
    try {
      const conn = useDb && project.databases[dbIndex] ? project.databases[dbIndex].connectionString : undefined
      const result = await postNdjson<EventPlan>('/api/connect/analyze', { path: project.root, connectionString: conn }, setStatus)
      setPlan(result)
      setAccepted(new Set(result.events.filter((e) => e.tier !== 'noise').map((e) => e.key)))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('discovered')
    }
  }

  const acceptedEvents = useMemo(() => (plan ? plan.events.filter((e) => accepted.has(e.key)) : []), [plan, accepted])
  const dbEvents = useMemo(() => acceptedEvents.filter((e) => e.db_mapping?.table), [acceptedEvents])
  const codeEvents = useMemo(() => acceptedEvents.filter((e) => !e.db_mapping?.table), [acceptedEvents])

  const finish = async () => {
    if (!plan || !project) return
    setError(null)
    // No DB-backed events (or no DB) — hand the plan over for instrumentation
    if (dbEvents.length === 0) {
      onPlanOnly({ ...plan, events: acceptedEvents.length ? acceptedEvents : plan.events })
      return
    }
    setPhase('importing')
    try {
      const conn = project.databases[dbIndex].connectionString
      const out = await postJson<ImportResponse>('/api/db/import', {
        connectionString: conn,
        mappings: dbEvents.map((e) => ({
          table: e.db_mapping!.table,
          event: e.key,
          user_column: e.db_mapping!.user_column,
          timestamp_column: e.db_mapping!.timestamp_column,
        })),
        days,
      })
      if (out.events.length === 0) {
        const errs = out.summary.filter((s) => s.error).map((s) => `${s.table}: ${s.error}`)
        throw new Error(`No events found in the last ${days} days${errs.length ? ` (${errs.join('; ')})` : ''} — try a longer window`)
      }
      onData(out.events, `${project.name} (live from database, last ${days}d)`, { ...plan, events: acceptedEvents })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('review')
    }
  }

  return (
    <section className="card wizard">
      <div className="card-head">
        <div>
          <h2>Connect your project</h2>
          <p className="card-sub">Point DotChart at a codebase — it finds your database and your events, you approve, done.</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {(phase === 'path' || phase === 'discovering') && (
        <>
          <div className="scan-bar-main">
            <input
              type="text"
              className="scan-path"
              placeholder="/path/to/your/project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && path.trim() && discover()}
              disabled={phase === 'discovering'}
              aria-label="Project path"
              autoFocus
            />
            <button className="btn btn-primary" onClick={discover} disabled={!path.trim() || phase === 'discovering'}>
              {phase === 'discovering' ? 'Looking…' : 'Connect'}
            </button>
          </div>
          <div className="scan-hint">
            Everything runs on this machine: your code, your database connection, and your data stay local — only a code
            digest goes to Claude for analysis. Not ready?{' '}
            <button className="btn-link" onClick={onClose}>
              explore the demo data instead
            </button>
            .
          </div>
        </>
      )}

      {phase === 'discovered' && project && (
        <div className="wizard-found">
          <div className="wizard-project">
            <div className="wizard-project-name">{project.name}</div>
            <div className="scan-hint">
              {project.framework && <>{project.framework} · </>}
              {project.files.included} source files ready to analyze
              {project.files.skipped > 0 && ` (${project.files.skipped} skipped by size budget)`}
            </div>
          </div>
          {project.databases.length > 0 ? (
            <label className="wizard-db">
              <input type="checkbox" checked={useDb} onChange={() => setUseDb(!useDb)} />
              <span>
                <strong>Database found</strong> in <code>{project.databases[dbIndex].envFile}</code> (
                <code>{project.databases[dbIndex].varName}</code>) — connect <em>read-only</em> so events already in your
                data can be charted immediately
                <div className="wizard-db-conn">
                  {project.databases.length > 1 ? (
                    <select value={dbIndex} onChange={(e) => setDbIndex(Number(e.target.value))}>
                      {project.databases.map((d, i) => (
                        <option key={i} value={i}>
                          {d.redacted}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <code>{project.databases[0].redacted}</code>
                  )}
                </div>
              </span>
            </label>
          ) : (
            <div className="scan-hint">No database connection found in the repo's env files — analysis will use the code only.</div>
          )}
          <div className="wizard-actions">
            <button className="btn btn-primary" onClick={analyze}>
              Analyze project (~1 min)
            </button>
            <button className="btn btn-ghost" onClick={() => setPhase('path')}>
              Back
            </button>
          </div>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="scan-status" role="status">
          <span className="scan-pulse" aria-hidden="true" />
          {status}
        </div>
      )}

      {(phase === 'review' || phase === 'importing') && plan && (
        <div className="wizard-review">
          <p className="plan-summary">{plan.product_summary}</p>
          <div className="wizard-events">
            {plan.events.map((e) => (
              <label className={`wizard-event${accepted.has(e.key) ? '' : ' wizard-event-off'}`} key={e.key}>
                <input
                  type="checkbox"
                  checked={accepted.has(e.key)}
                  onChange={() => {
                    const next = new Set(accepted)
                    if (next.has(e.key)) next.delete(e.key)
                    else next.add(e.key)
                    setAccepted(next)
                  }}
                />
                <span className="wizard-event-main">
                  <span className="wizard-event-title">
                    {e.label}
                    <span className={`tier-chip tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span>
                    {e.db_mapping?.table ? (
                      <span className="src-chip src-db">already in your database · {e.db_mapping.table}</span>
                    ) : (
                      <span className="src-chip src-code">needs a one-line code change</span>
                    )}
                  </span>
                  <span className="wizard-event-desc">{e.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="wizard-actions">
            {dbEvents.length > 0 ? (
              <>
                <button className="btn btn-primary" onClick={finish} disabled={phase === 'importing'}>
                  {phase === 'importing'
                    ? 'Importing your data…'
                    : `Show me my users (${dbEvents.length} event${dbEvents.length === 1 ? '' : 's'} from your database)`}
                </button>
                <label className="scan-hint">
                  last{' '}
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
              </>
            ) : (
              <button className="btn btn-primary" onClick={finish}>
                Save plan &amp; set up tracking
              </button>
            )}
            {codeEvents.length > 0 && dbEvents.length > 0 && (
              <span className="scan-hint">
                {codeEvents.length} more event{codeEvents.length === 1 ? '' : 's'} need instrumentation — one click after
                this, on a git branch
              </span>
            )}
          </div>
        </div>
      )}

      {error && <div className="scan-error">⚠ {error}</div>}
    </section>
  )
}
