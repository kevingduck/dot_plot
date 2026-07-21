import { useState } from 'react'
import type { Dataset, GridModel } from '../types'
import { postJson } from '../lib/api'
import { aiParams, estimateCost } from '../lib/settings'
import { buildUsageSummary, type Insight } from '../lib/insights'

const KIND_LABEL: Record<Insight['kind'], string> = {
  churn_risk: '⚠ Churn risk',
  activation: '🚀 Activation',
  pattern: '📈 Pattern',
  milestone: '⭐ Worth a look',
}

export interface InsightsResponse {
  insights: Insight[]
  meta: { model: string; usage: { input_tokens: number; output_tokens: number } }
}

interface Props {
  model: GridModel
  dataset: Dataset
  saved: InsightsResponse | null
  onSaved: (r: InsightsResponse) => void
  onHighlight: (users: Set<string> | null) => void
}

export function InsightCards({ model, dataset, saved, onSaved, onHighlight }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InsightsResponse | null>(saved)
  const [active, setActive] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const run = async () => {
    setLoading(true)
    setError(null)
    setActive(null)
    onHighlight(null)
    try {
      const summary = buildUsageSummary(model, dataset)
      const r = await postJson<InsightsResponse>('/api/insights', { summary, ...aiParams() })
      setResult(r)
      onSaved(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (i: number) => {
    if (active === i) {
      setActive(null)
      onHighlight(null)
      return
    }
    setActive(i)
    const ids = result?.insights[i]?.user_ids ?? []
    onHighlight(ids.length ? new Set(ids) : null)
  }

  if (model.rows.length === 0) return null

  return (
    <section className="card insights">
      <div className="card-head">
        <div>
          <h2>Insights</h2>
          <p className="card-sub">
            {result
              ? `Found by ${result.meta.model} (~${estimateCost(result.meta.model, result.meta.usage) ?? '?'}) — click a card to highlight those users on the grid`
              : 'Let Claude stare at the grid for you — churn risks, activation patterns, users worth talking to.'}
          </p>
        </div>
        <div className="plan-actions">
          {result && !loading && (
            <button className="btn" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
              {collapsed ? `Show (${result.insights.length})` : 'Hide'}
            </button>
          )}
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? 'Reading the grid…' : result ? '↻ Re-analyze' : '✨ Find patterns'}
          </button>
        </div>
      </div>
      {loading && (
        <div className="scan-status" role="status">
          <span className="scan-pulse" aria-hidden="true" />
          Looking for patterns across {Math.min(model.rows.length, 150)} users…
        </div>
      )}
      {error && <div className="scan-error">⚠ {error}</div>}
      {result && !loading && !collapsed && (
        <div className="insight-row">
          {result.insights.map((ins, i) => (
            <button
              key={i}
              className={`insight-card${active === i ? ' insight-active' : ''}`}
              onClick={() => toggle(i)}
              title={ins.user_ids.length ? `Click to highlight ${ins.user_ids.length} user${ins.user_ids.length === 1 ? '' : 's'} on the grid` : undefined}
            >
              <span className={`insight-kind insight-${ins.kind}`}>{KIND_LABEL[ins.kind]}</span>
              <span className="insight-title">{ins.title}</span>
              <span className="insight-detail">{ins.detail}</span>
              {ins.user_ids.length > 0 && (
                <span className="insight-users">
                  {active === i ? '● highlighting' : '○'} {ins.user_ids.length} user{ins.user_ids.length === 1 ? '' : 's'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
