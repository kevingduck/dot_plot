import { useMemo, useState } from 'react'
import type { EventPlan, EventTier } from '../types'
import { InstrumentPanel } from './InstrumentPanel'
import { estimateCost } from '../lib/settings'

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

const normTokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))

/** Best-effort guess of which dataset event a plan key refers to. */
function guessMatch(planKey: string, datasetNames: string[]): string {
  if (datasetNames.includes(planKey)) return planKey
  const pt = normTokens(planKey)
  let best = ''
  let bestScore = 0
  for (const name of datasetNames) {
    const overlap = [...normTokens(name)].filter((t) => pt.has(t)).length
    const score = overlap + (planKey.includes(name) || name.includes(planKey) ? 2 : 0)
    if (score > bestScore) {
      best = name
      bestScore = score
    }
  }
  return bestScore >= 1 ? best : ''
}

export function EventPlanPanel({ plan, datasetEvents, onApply, onClose }: Props) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(plan.events.filter((e) => e.tier !== 'noise').map((e) => e.key)),
  )
  const [coreKey, setCoreKey] = useState(plan.core_event)
  const datasetNames = useMemo(() => [...datasetEvents].filter((n) => n !== '__other__').sort(), [datasetEvents])
  // plan event key -> dataset event name it corresponds to ('' = not in data)
  const [mapping, setMapping] = useState<Map<string, string>>(
    () => new Map(plan.events.map((e) => [e.key, guessMatch(e.key, [...datasetEvents].filter((n) => n !== '__other__'))])),
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showInstrument, setShowInstrument] = useState(false)

  const sorted = useMemo(
    () => [...plan.events].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)),
    [plan],
  )
  // Accepted plan events resolved to dataset event names (deduped per target)
  const mappedPairs = useMemo(() => {
    const used = new Set<string>()
    const out: { key: string; label: string; planKey: string }[] = []
    for (const e of sorted.filter((ev) => accepted.has(ev.key))) {
      const target = mapping.get(e.key) ?? ''
      if (target && !used.has(target)) {
        used.add(target)
        out.push({ key: target, label: e.label, planKey: e.key })
      }
    }
    return out
  }, [sorted, accepted, mapping])

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
              ? `Scanned ${plan.meta.scanned_path} (${plan.meta.files_included} files, ${plan.meta.model}${estimateCost(plan.meta.model, plan.meta.usage) ? `, ~${estimateCost(plan.meta.model, plan.meta.usage)}` : ''})`
              : 'Imported plan'}{' '}
            · {accepted.size} of {plan.events.length} events accepted
          </p>
        </div>
        <div className="plan-actions">
          <button
            className="btn btn-primary"
            disabled={mappedPairs.length === 0}
            title={
              mappedPairs.length === 0
                ? 'No accepted events are matched to your data — use the "in your data" selector on each event, or import matching data first'
                : 'Use the accepted events as the grid legend (labels, symbols, core event)'
            }
            onClick={() => {
              const mappedCore = mapping.get(coreKey) || mappedPairs[0]?.key
              onApply(mappedPairs, mappedCore)
            }}
          >
            Apply to grid ({mappedPairs.length} mapped)
          </button>
          <button className="btn" onClick={() => setShowInstrument(!showInstrument)} aria-expanded={showInstrument}>
            Instrument codebase…
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

      {mappedPairs.length === 0 && datasetNames.length > 0 && (
        <p className="plan-map-hint">
          None of the proposed event keys appear in the loaded dataset (it has: {datasetNames.slice(0, 6).join(', ')}
          {datasetNames.length > 6 ? ', …' : ''}). Plan keys describe what the codebase <em>will</em> emit once
          instrumented — to chart the data you already have, match each plan event to one of your dataset's events with
          the "in your data" selector, then apply.
        </p>
      )}

      {showInstrument && (
        <InstrumentPanel
          defaultPath={plan.meta?.scanned_path ?? ''}
          events={plan.events.filter((e) => accepted.has(e.key))}
        />
      )}

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
                  {datasetNames.length > 0 && (
                    <div className="plan-map">
                      in your data:{' '}
                      <select
                        value={mapping.get(e.key) ?? ''}
                        onChange={(ev) => setMapping(new Map(mapping).set(e.key, ev.target.value))}
                        aria-label={`Dataset event for ${e.label}`}
                      >
                        <option value="">— not in data —</option>
                        {datasetNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
