import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EventType, GridModel, Shape } from '../types'
import type { ThemeColors } from '../theme'
import { seriesColor } from '../theme'
import { ShapeIcon } from './ShapeIcon'

const ROW_H = 22
const COL_W = 20
const GUTTER_W = 224
const HEADER_H = 44
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

interface Props {
  model: GridModel
  registry: EventType[]
  colors: ThemeColors
  selectedUserId: string | null
  onSelectUser: (id: string | null) => void
}

interface HoverCell {
  row: number
  col: number
  vx: number // viewport-relative x for tooltip
  vy: number
}

function markRadius(total: number): number {
  return total >= 6 ? 5.5 : total >= 3 ? 4.75 : 4
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: Shape, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2)
      break
    case 'square': {
      const s = r * 0.92
      ctx.roundRect(x - s, y - s, s * 2, s * 2, 2)
      break
    }
    case 'diamond': {
      const d = r * 1.18
      ctx.moveTo(x, y - d)
      ctx.lineTo(x + d, y)
      ctx.lineTo(x, y + d)
      ctx.lineTo(x - d, y)
      ctx.closePath()
      break
    }
    case 'triangle': {
      const d = r * 1.15
      ctx.moveTo(x, y - d)
      ctx.lineTo(x + d * 0.95, y + d * 0.75)
      ctx.lineTo(x - d * 0.95, y + d * 0.75)
      ctx.closePath()
      break
    }
    case 'dot':
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
      break
  }
  ctx.fill()
}

export function DotPlot({ model, registry, colors, selectedUserId, onSelectUser }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })
  const [hover, setHover] = useState<HoverCell | null>(null)
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null)
  const hoverRef = useRef<HoverCell | null>(null)
  hoverRef.current = hover

  const totalW = GUTTER_W + model.days.length * COL_W
  const totalH = HEADER_H + model.rows.length * ROW_H

  const typeByKey = useMemo(() => new Map(registry.map((t) => [t.key, t])), [registry])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return
    const dpr = window.devicePixelRatio || 1
    const w = size.w
    const h = size.h
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const sl = viewport.scrollLeft
    const st = viewport.scrollTop

    ctx.fillStyle = colors.surface
    ctx.fillRect(0, 0, w, h)

    const c0 = Math.max(0, Math.floor(sl / COL_W))
    const c1 = Math.min(model.days.length - 1, Math.ceil((sl + w - GUTTER_W) / COL_W))
    const r0 = Math.max(0, Math.floor(st / ROW_H))
    const r1 = Math.min(model.rows.length - 1, Math.ceil((st + h - HEADER_H) / ROW_H))

    const colX = (c: number) => GUTTER_W + c * COL_W - sl
    const rowY = (r: number) => HEADER_H + r * ROW_H - st

    // ---- cells region ----
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, HEADER_H, w - GUTTER_W, h - HEADER_H)
    ctx.clip()

    for (let c = c0; c <= c1; c++) {
      if (model.days[c]?.weekend) {
        ctx.fillStyle = colors.weekendWash
        ctx.fillRect(colX(c), HEADER_H, COL_W, h - HEADER_H)
      }
    }

    const hoveredRow = hover?.row ?? -1
    const selectedRow = selectedUserId ? model.rows.findIndex((r) => r.user.id === selectedUserId) : -1
    for (const r of [selectedRow, hoveredRow]) {
      if (r >= r0 - 1 && r <= r1 + 1 && r >= 0) {
        ctx.fillStyle = colors.hoverWash
        ctx.fillRect(GUTTER_W, rowY(r), w - GUTTER_W, ROW_H)
      }
    }

    for (let r = r0; r <= r1; r++) {
      const row = model.rows[r]
      if (!row) continue
      const cy = rowY(r) + ROW_H / 2
      for (let c = c0; c <= c1; c++) {
        const cx = colX(c) + COL_W / 2
        const isFirstDay = model.days[c].key === row.firstSeenKey
        const cell = row.cells.get(c)
        if (cell) {
          const type = typeByKey.get(cell.primary)
          const radius = markRadius(cell.total)
          drawMark(ctx, cx, cy, radius, type?.shape ?? 'dot', seriesColor(colors, type?.slot ?? -1))
        }
        if (isFirstDay) {
          ctx.strokeStyle = colors.inkSecondary
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, 8.5, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }

    if (focusCell) {
      const { row, col } = focusCell
      if (row >= r0 - 1 && row <= r1 + 1 && col >= c0 - 1 && col <= c1 + 1) {
        ctx.strokeStyle = colors.focusRing
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(colX(col) + 1.5, rowY(row) + 1.5, COL_W - 3, ROW_H - 3, 4)
        ctx.stroke()
      }
    }
    ctx.restore()

    // ---- header (dates) ----
    ctx.fillStyle = colors.surface
    ctx.fillRect(0, 0, w, HEADER_H)
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, 0, w - GUTTER_W, HEADER_H)
    ctx.clip()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let c = c0; c <= c1; c++) {
      const day = model.days[c]
      const x = colX(c) + COL_W / 2
      if (day.monthStart || c === c0) {
        ctx.fillStyle = colors.inkSecondary
        ctx.font = `600 11px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillText(day.date.toLocaleDateString(undefined, { month: 'short' }), colX(c) + 2, 12)
        ctx.textAlign = 'center'
      }
      ctx.fillStyle = day.weekend ? colors.baseline : colors.inkMuted
      ctx.font = `10px ${FONT}`
      ctx.fillText(`${day.date.getDate()}`, x, 32)
    }
    ctx.restore()
    ctx.strokeStyle = colors.gridline
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, HEADER_H - 0.5)
    ctx.lineTo(w, HEADER_H - 0.5)
    ctx.stroke()

    // ---- gutter (user names) ----
    ctx.fillStyle = colors.surface
    ctx.fillRect(0, HEADER_H, GUTTER_W, h - HEADER_H)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, HEADER_H, GUTTER_W, h - HEADER_H)
    ctx.clip()
    ctx.textBaseline = 'middle'
    for (let r = r0; r <= r1; r++) {
      const row = model.rows[r]
      if (!row) continue
      const y = rowY(r) + ROW_H / 2
      if (r === hoveredRow || r === selectedRow) {
        ctx.fillStyle = colors.hoverWash
        ctx.fillRect(0, rowY(r), GUTTER_W, ROW_H)
      }
      ctx.fillStyle = r === selectedRow ? colors.inkPrimary : colors.inkSecondary
      ctx.font = `${r === selectedRow ? 600 : 400} 12px ${FONT}`
      ctx.textAlign = 'left'
      let name = row.user.name
      while (name.length > 3 && ctx.measureText(name).width > GUTTER_W - 74) name = name.slice(0, -2) + '…'
      ctx.fillText(name, 12, y)
      ctx.fillStyle = colors.inkMuted
      ctx.font = `10px ${FONT}`
      ctx.textAlign = 'right'
      ctx.fillText(`${row.activeDays}d`, GUTTER_W - 12, y)
    }
    ctx.restore()

    // corner
    ctx.fillStyle = colors.surface
    ctx.fillRect(0, 0, GUTTER_W, HEADER_H)
    ctx.fillStyle = colors.inkMuted
    ctx.font = `11px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${model.rows.length} users`, 12, HEADER_H - 12)
    ctx.strokeStyle = colors.gridline
    ctx.beginPath()
    ctx.moveTo(GUTTER_W - 0.5, 0)
    ctx.lineTo(GUTTER_W - 0.5, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, HEADER_H - 0.5)
    ctx.lineTo(GUTTER_W, HEADER_H - 0.5)
    ctx.stroke()
  }, [model, colors, size, hover, focusCell, selectedUserId, typeByKey])

  useEffect(() => {
    draw()
  }, [draw])

  // Open scrolled to the most recent days — that's what the reader checks first.
  const lastDayKey = model.days[model.days.length - 1]?.key ?? ''
  const firstDayKey = model.days[0]?.key ?? ''
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollLeft = viewport.scrollWidth
  }, [firstDayKey, lastDayKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const ro = new ResizeObserver(() => {
      setSize({ w: viewport.clientWidth, h: viewport.clientHeight })
    })
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [])

  const cellFromPoint = useCallback(
    (clientX: number, clientY: number): HoverCell | null => {
      const viewport = viewportRef.current
      if (!viewport) return null
      const rect = viewport.getBoundingClientRect()
      const vx = clientX - rect.left
      const vy = clientY - rect.top
      if (vx < GUTTER_W || vy < HEADER_H) {
        // gutter hover still highlights the row
        if (vx < GUTTER_W && vy >= HEADER_H) {
          const row = Math.floor((vy + viewport.scrollTop - HEADER_H) / ROW_H)
          if (row >= 0 && row < model.rows.length) return { row, col: -1, vx, vy }
        }
        return null
      }
      const col = Math.floor((vx + viewport.scrollLeft - GUTTER_W) / COL_W)
      const row = Math.floor((vy + viewport.scrollTop - HEADER_H) / ROW_H)
      if (row < 0 || row >= model.rows.length || col < 0 || col >= model.days.length) return null
      return { row, col, vx, vy }
    },
    [model],
  )

  const onScroll = useCallback(() => {
    requestAnimationFrame(draw)
    if (hoverRef.current) setHover(null)
  }, [draw])

  const scrollCellIntoView = useCallback((row: number, col: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const x = GUTTER_W + col * COL_W
    const y = HEADER_H + row * ROW_H
    if (x - viewport.scrollLeft < GUTTER_W) viewport.scrollLeft = x - GUTTER_W
    else if (x + COL_W - viewport.scrollLeft > viewport.clientWidth) viewport.scrollLeft = x + COL_W - viewport.clientWidth
    if (y - viewport.scrollTop < HEADER_H) viewport.scrollTop = y - HEADER_H
    else if (y + ROW_H - viewport.scrollTop > viewport.clientHeight) viewport.scrollTop = y + ROW_H - viewport.clientHeight
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (model.rows.length === 0) return
      let { row, col } = focusCell ?? { row: 0, col: model.rows[0].cells.keys().next().value ?? 0 }
      switch (e.key) {
        case 'ArrowRight':
          col = Math.min(model.days.length - 1, focusCell ? col + 1 : col)
          break
        case 'ArrowLeft':
          col = Math.max(0, focusCell ? col - 1 : col)
          break
        case 'ArrowDown':
          row = Math.min(model.rows.length - 1, focusCell ? row + 1 : row)
          break
        case 'ArrowUp':
          row = Math.max(0, focusCell ? row - 1 : row)
          break
        case 'Enter':
          if (focusCell) onSelectUser(model.rows[focusCell.row].user.id)
          e.preventDefault()
          return
        case 'Escape':
          setFocusCell(null)
          return
        default:
          return
      }
      e.preventDefault()
      setFocusCell({ row, col })
      scrollCellIntoView(row, col)
    },
    [focusCell, model, onSelectUser, scrollCellIntoView],
  )

  // Tooltip target: keyboard focus wins, else hovered cell
  const tip = useMemo(() => {
    const viewport = viewportRef.current
    if (focusCell && viewport) {
      return {
        row: focusCell.row,
        col: focusCell.col,
        vx: GUTTER_W + focusCell.col * COL_W - viewport.scrollLeft + COL_W / 2,
        vy: HEADER_H + focusCell.row * ROW_H - viewport.scrollTop,
      }
    }
    if (hover && hover.col >= 0) return hover
    return null
  }, [hover, focusCell])

  const tipRow = tip ? model.rows[tip.row] : null
  const tipCell = tip && tipRow ? tipRow.cells.get(tip.col) : null
  const tipDay = tip ? model.days[tip.col] : null

  return (
    <div className="dotplot-wrap">
      <div
        ref={viewportRef}
        className="dotplot-viewport"
        role="grid"
        aria-label="Per-user daily activity"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerMove={(e) => setHover(cellFromPoint(e.clientX, e.clientY))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const cell = cellFromPoint(e.clientX, e.clientY)
          if (cell) onSelectUser(model.rows[cell.row].user.id)
        }}
      >
        <canvas ref={canvasRef} style={{ position: 'sticky', top: 0, left: 0, display: 'block', width: size.w, height: size.h }} />
        <div style={{ position: 'absolute', top: 0, left: 0, width: totalW, height: totalH, pointerEvents: 'none' }} />
      </div>
      {tip && tipRow && tipDay && (
        <div
          className="viz-tooltip"
          style={{
            left: Math.min(Math.max(tip.vx + 14, GUTTER_W), size.w - 190),
            top: Math.max(8, tip.vy - 12),
          }}
        >
          <div className="tip-head">
            <span className="tip-user">{tipRow.user.name}</span>
            <span className="tip-date">{tipDay.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
          {tipDay.key === tipRow.firstSeenKey && <div className="tip-first">First day</div>}
          {tipCell ? (
            registry
              .filter((t) => (tipCell.counts[t.key] ?? 0) > 0)
              .map((t) => (
                <div className="tip-row" key={t.key}>
                  <ShapeIcon shape={t.shape} color={seriesColor(colors, t.slot)} />
                  <span className="tip-value">{tipCell.counts[t.key]}</span>
                  <span className="tip-label">{t.label}</span>
                </div>
              ))
          ) : (
            <div className="tip-row">
              <span className="tip-label">No activity</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
