import { useEffect, useRef, useState } from 'react'
import type { Cohort } from '../lib/retention'
import type { ThemeColors } from '../theme'

const HEIGHT = 240
const M = { top: 14, right: 16, bottom: 26, left: 40 }

interface Props {
  cohorts: Cohort[]
  colors: ThemeColors
}

export function RetentionChart({ cohorts, colors }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hoverWeek, setHoverWeek] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxWeeks = Math.max(2, ...cohorts.map((c) => c.pct.length))
  const plotW = width - M.left - M.right
  const plotH = HEIGHT - M.top - M.bottom
  const x = (w: number) => M.left + (maxWeeks === 1 ? 0 : (w / (maxWeeks - 1)) * plotW)
  const y = (p: number) => M.top + (1 - p) * plotH

  // newest cohort gets the darkest ordinal step
  const ramp = colors.ordinal.slice(Math.max(0, colors.ordinal.length - cohorts.length))
  const cohortColor = (i: number) => ramp[Math.min(i, ramp.length - 1)]

  if (cohorts.length === 0) {
    return <div className="empty-note">Not enough users per signup week to draw cohorts yet.</div>
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < M.left - 10 || px > width - M.right + 10) {
      setHoverWeek(null)
      return
    }
    const w = Math.round(((px - M.left) / plotW) * (maxWeeks - 1))
    setHoverWeek(Math.max(0, Math.min(maxWeeks - 1, w)))
  }

  return (
    <div className="retention-wrap" ref={wrapRef}>
      <div style={{ position: 'relative' }}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Weekly cohort retention"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverWeek(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={M.left} x2={width - M.right} y1={y(p)} y2={y(p)} stroke={p === 0 ? colors.baseline : colors.gridline} strokeWidth={1} />
              <text x={M.left - 8} y={y(p) + 3.5} textAnchor="end" fontSize={10} fill={colors.inkMuted}>
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}
          {Array.from({ length: maxWeeks }, (_, w) => (
            <text key={w} x={x(w)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill={colors.inkMuted}>
              {w === 0 ? 'Signup wk' : `W${w}`}
            </text>
          ))}
          {hoverWeek !== null && (
            <line x1={x(hoverWeek)} x2={x(hoverWeek)} y1={M.top} y2={M.top + plotH} stroke={colors.baseline} strokeWidth={1} />
          )}
          {cohorts.map((c, i) => {
            const pts = c.pct.map((p, w) => (Number.isNaN(p) ? null : ([x(w), y(p)] as const)))
            const path = pts
              .map((pt, w) => (pt ? `${w === 0 || !pts[w - 1] ? 'M' : 'L'} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}` : ''))
              .join(' ')
            const last = [...pts].reverse().find(Boolean)
            return (
              <g key={c.label}>
                <path d={path} fill="none" stroke={cohortColor(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {last && (
                  <circle cx={last[0]} cy={last[1]} r={4} fill={cohortColor(i)} stroke={colors.surface} strokeWidth={2} />
                )}
                {hoverWeek !== null && pts[hoverWeek] && (
                  <circle cx={pts[hoverWeek]![0]} cy={pts[hoverWeek]![1]} r={4.5} fill={cohortColor(i)} stroke={colors.surface} strokeWidth={2} />
                )}
              </g>
            )
          })}
        </svg>
        {hoverWeek !== null && (
          <div
            className="viz-tooltip"
            style={{ left: Math.min(x(hoverWeek) + 14, width - 200), top: M.top }}
          >
            <div className="tip-head">
              <span className="tip-user">{hoverWeek === 0 ? 'Signup week' : `Week ${hoverWeek} after signup`}</span>
            </div>
            {cohorts.map((c, i) => {
              const p = c.pct[hoverWeek]
              if (p === undefined || Number.isNaN(p)) return null
              return (
                <div className="tip-row" key={c.label}>
                  <span className="tip-linekey" style={{ background: cohortColor(i) }} />
                  <span className="tip-value">{Math.round(p * 100)}%</span>
                  <span className="tip-label">{c.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="legend-row" role="list" aria-label="Cohorts">
        {cohorts.map((c, i) => (
          <span className="legend-item" role="listitem" key={c.label}>
            <span className="tip-linekey" style={{ background: cohortColor(i) }} />
            {c.label}
            <span className="legend-n">n={c.size}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
