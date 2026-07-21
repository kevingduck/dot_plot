import { useMemo, useState } from 'react'
import type { InstrumentPrep, InstrumentResult, PlannedEvent, PreparedEdit } from '../types'
import { postJson, postNdjson } from '../lib/api'

type Phase = 'idle' | 'preparing' | 'review' | 'applying' | 'done'

interface Props {
  defaultPath: string
  events: PlannedEvent[] // accepted events only
}

/** Highlight lines in new_string that aren't in old_string (edits are additive). */
function Diff({ edit }: { edit: PreparedEdit }) {
  const oldCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of edit.old_string.split('\n')) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }, [edit])
  const remaining = new Map(oldCounts)
  return (
    <pre className="diff">
      {edit.new_string.split('\n').map((line, i) => {
        const have = remaining.get(line) ?? 0
        const added = have === 0
        if (!added) remaining.set(line, have - 1)
        return (
          <div key={i} className={added ? 'diff-add' : 'diff-ctx'}>
            <span className="diff-sign">{added ? '+' : ' '}</span>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function InstrumentPanel({ defaultPath, events }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [path, setPath] = useState(defaultPath)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [prep, setPrep] = useState<InstrumentPrep | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeSdk, setIncludeSdk] = useState(true)
  const [sdkOpen, setSdkOpen] = useState(false)
  const [result, setResult] = useState<InstrumentResult | null>(null)

  const prepare = async () => {
    setPhase('preparing')
    setError(null)
    try {
      const p = await postNdjson<InstrumentPrep>('/api/instrument/prepare', { path: path.trim(), events }, setStatus)
      setPrep(p)
      setSelected(new Set(p.edits.filter((e) => e.status === 'ok').map((e) => e.id)))
      setIncludeSdk(true)
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }

  const apply = async () => {
    if (!prep) return
    setPhase('applying')
    setError(null)
    try {
      const r = await postJson<InstrumentResult>('/api/instrument/apply', {
        path: path.trim(),
        sdkFile: includeSdk ? prep.sdk_file : undefined,
        edits: prep.edits.filter((e) => selected.has(e.id)),
      })
      setResult(r)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('review')
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  if (phase === 'done' && result) {
    return (
      <div className="instrument-wrap">
        <div className="instrument-done">
          <div className="instrument-done-title">✓ Branch created — your working branch was not touched</div>
          <p>
            <code>{result.branch}</code> (commit <code>{result.commit}</code>) now sits alongside{' '}
            <code>{result.baseBranch}</code> with {result.applied.length} tracking edit
            {result.applied.length === 1 ? '' : 's'} across {result.filesChanged.length} file
            {result.filesChanged.length === 1 ? '' : 's'}.
          </p>
          <div className="instrument-cmds">
            <div className="stat-label">Review it</div>
            <pre className="instr-snippet">{`cd ${path}\ngit diff ${result.baseBranch}...${result.branch}`}</pre>
            <div className="stat-label">Adopt it</div>
            <pre className="instr-snippet">{`git merge ${result.branch}   # or open a PR from the branch`}</pre>
            <div className="stat-label">Reject it entirely</div>
            <pre className="instr-snippet">{`git branch -D ${result.branch}`}</pre>
          </div>
          <p className="scan-hint">
            The instrumentation is inert until you set <code>DOTCHART_INGEST_URL</code> — merged as-is, it changes
            nothing at runtime.
          </p>
          {result.skipped.length > 0 && (
            <p className="scan-hint">Skipped (didn't apply cleanly): {result.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="instrument-wrap">
      <div className="instrument-head">
        <input
          type="text"
          className="scan-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={phase !== 'idle'}
          aria-label="Repository path"
          placeholder="/path/to/repo (must be a git repo with a clean working tree)"
        />
        {phase === 'idle' && (
          <button className="btn btn-primary" onClick={prepare} disabled={!path.trim() || events.length === 0}>
            Propose code changes
          </button>
        )}
      </div>
      {phase === 'idle' && (
        <div className="scan-hint">
          Claude drafts minimal, additive edits for the {events.length} accepted event{events.length === 1 ? '' : 's'}.
          Nothing is written until you review each edit and apply — and applying only creates a new{' '}
          <code>dotchart/…</code> git branch; your current branch and working tree stay untouched.
        </div>
      )}
      {(phase === 'preparing' || phase === 'applying') && (
        <div className="scan-status" role="status">
          <span className="scan-pulse" aria-hidden="true" />
          {phase === 'applying' ? 'Creating branch and applying approved edits…' : status}
        </div>
      )}
      {error && <div className="scan-error">⚠ {error}</div>}

      {phase === 'review' && prep && (
        <div className="instrument-review">
          <div className="instrument-review-head">
            <span>
              {selected.size} of {prep.edits.length} edits approved
              {prep.edits.some((e) => e.status !== 'ok') &&
                ` (${prep.edits.filter((e) => e.status !== 'ok').length} couldn't be validated and are excluded)`}
            </span>
            <button className="btn btn-primary" onClick={apply} disabled={selected.size === 0 && !includeSdk}>
              Create branch with {selected.size + (includeSdk ? 1 : 0)} change{selected.size + (includeSdk ? 1 : 0) === 1 ? '' : 's'}
            </button>
          </div>
          {prep.notes && <p className="scan-hint">Reviewer notes from Claude: {prep.notes}</p>}

          <div className="edit-item">
            <label className="edit-label">
              <input type="checkbox" checked={includeSdk} onChange={() => setIncludeSdk(!includeSdk)} />
              <span>
                <strong>New file</strong> <code>{prep.sdk_file.path}</code> — the tracking client (no-op until{' '}
                <code>DOTCHART_INGEST_URL</code> is set)
              </span>
              <button className="btn btn-ghost plan-expand" onClick={(e) => (e.preventDefault(), setSdkOpen(!sdkOpen))}>
                {sdkOpen ? 'Hide ▾' : 'View ▸'}
              </button>
            </label>
            {sdkOpen && <pre className="diff">{prep.sdk_file.content}</pre>}
          </div>

          {prep.edits.map((e) => (
            <div className={`edit-item${e.status !== 'ok' ? ' edit-invalid' : ''}`} key={e.id}>
              <label className="edit-label">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  disabled={e.status !== 'ok'}
                  onChange={() => toggle(e.id)}
                />
                <span>
                  <code>{e.file}</code> <span className="edit-event">{e.event_key}</span>
                  <span className="edit-explain">{e.explanation}</span>
                  {e.status !== 'ok' && <span className="edit-reason"> — excluded: {e.reason}</span>}
                </span>
              </label>
              <Diff edit={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
