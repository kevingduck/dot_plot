import { useMemo, useState } from 'react'
import type { EventPlan, EventTier } from '../types'

const TIER_ORDER: EventTier[] = ['core', 'activation', 'feature', 'noise']
const TIER_LABEL: Record<EventTier, string> = {
  core: 'Core value',
  activation: 'Activation',
  feature: 'Feature',
  noise: 'Noise',
}

interface Props {
  plan: EventPlan
  datasetEvents: Set<string>
  onApply: (accepted: { key: string; label: string }[], coreKey: string) => void
  onClose: () => void
}

export function EventPlanPanel({ plan, datasetEvents, onApply, onClose }: Props) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(plan.events.filter((e) => e.tier !== 'noise').map((e) => e.key)),
  )
  const [coreKey, setCoreKey] = useState(plan.core_event)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...plan.events].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)),
    [plan],
  )
  const matchedCount = useMemo(
    () => [...accepted].filter((k) => datasetEvents.has(k)).length,
    [accepted, datasetEvents],
  )

  const toggle = (key: string) => {
    const next = new Set(accepted)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setAccepted(next)
  }

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    })
  }

  const exportAccepted = () => {
    const out = {
      ...plan,
      core_event: coreKey,
      events: plan.events.filter((e) => accepted.has(e.key)),
      meta: plan.meta,
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dotchart.events.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card plan-card">
      <div className="card-head">
        <div>
          <h2>Proposed event plan</h2>
          <p className="card-sub">
            {plan.meta
              ? `Scanned ${plan.meta.scanned_path} (${plan.meta.files_included} files, ${plan.meta.model})`
              : 'Imported plan'}{' '}
            · {accepted.size} of {plan.events.length} events accepted
          </p>
        </div>
        <div className="plan-actions">
          <button
            className="btn btn-primary"
            disabled={matchedCount === 0}
            title={
              matchedCount === 0
                ? 'None of the accepted event keys exist in the current dataset yet — instrument your app or import matching data'
                : 'Use the accepted events as the grid legend (labels, symbols, core event)'
            }
            onClick={() =>
              onApply(
                sorted.filter((e) => accepted.has(e.key)).map((e) => ({ key: e.key, label: e.label })),
                coreKey,
              )
            }
          >
            Apply to grid ({matchedCount} in data)
          </button>
          <button className="btn" onClick={exportAccepted}>
            Export accepted plan
          </button>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close plan">
            ✕
          </button>
        </div>
      </div>

      <p className="plan-summary">{plan.product_summary}</p>

      <table className="plan-table">
        <thead>
          <tr>
            <th>Track</th>
            <th>Core</th>
            <th>Event</th>
            <th>Tier</th>
            <th>Why</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const isOpen = expanded === e.key
            return (
              <tr key={e.key} className={accepted.has(e.key) ? '' : 'plan-row-off'}>
                <td>
                  <input
                    type="checkbox"
                    checked={accepted.has(e.key)}
                    onChange={() => toggle(e.key)}
                    aria-label={`Track ${e.label}`}
                  />
                </td>
                <td>
                  <input
                    type="radio"
                    name="core-event"
                    checked={coreKey === e.key}
                    onChange={() => setCoreKey(e.key)}
                    aria-label={`Make ${e.label} the core event`}
                  />
                </td>
                <td>
                  <div className="plan-event-label">{e.label}</div>
                  <code className="plan-event-key">{e.key}</code>
                  <div className="plan-event-desc">{e.description}</div>
                </td>
                <td>
                  <span className={`tier-chip tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span>
                  <div className="plan-confidence">{e.confidence} confidence</div>
                </td>
                <td className="plan-rationale">{e.rationale}</td>
                <td>
                  <button className="btn btn-ghost plan-expand" onClick={() => setExpanded(isOpen ? null : e.key)}>
                    {e.instrumentation.length} location{e.instrumentation.length === 1 ? '' : 's'} {isOpen ? '▾' : '▸'}
                  </button>
                  {isOpen && (
                    <div className="instr-list">
                      {e.instrumentation.map((p, i) => {
                        const id = `${e.key}:${i}`
                        return (
                          <div className="instr-item" key={id}>
                            <div className="instr-loc">
                              {p.file} · {p.location}
                            </div>
                            <pre className="instr-snippet">{p.snippet}</pre>
                            <button className="btn btn-ghost instr-copy" onClick={() => copy(id, p.snippet)}>
                              {copied === id ? 'Copied ✓' : 'Copy'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
