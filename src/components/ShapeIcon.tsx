import type { Shape } from '../types'

export function ShapeIcon({ shape, color, size = 12 }: { shape: Shape; color: string; size?: number }) {
  const c = size / 2
  const r = size * 0.42
  let el: JSX.Element
  switch (shape) {
    case 'circle':
      el = <circle cx={c} cy={c} r={r} fill={color} />
      break
    case 'square':
      el = <rect x={c - r * 0.92} y={c - r * 0.92} width={r * 1.84} height={r * 1.84} rx={1.5} fill={color} />
      break
    case 'diamond':
      el = <path d={`M ${c} ${c - r * 1.15} L ${c + r * 1.15} ${c} L ${c} ${c + r * 1.15} L ${c - r * 1.15} ${c} Z`} fill={color} />
      break
    case 'triangle':
      el = <path d={`M ${c} ${c - r * 1.1} L ${c + r * 1.05} ${c + r * 0.85} L ${c - r * 1.05} ${c + r * 0.85} Z`} fill={color} />
      break
    case 'dot':
      el = <circle cx={c} cy={c} r={r * 0.55} fill={color} />
      break
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      {el}
    </svg>
  )
}
