export interface User {
  id: string
  name: string
  platform: string
  plan: string
  country: string
}

export interface RawEvent {
  userId: string
  event: string
  ts: number // epoch ms
}

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'dot'

export interface EventType {
  key: string
  label: string
  shape: Shape
  slot: number // categorical palette slot, 0-based; -1 = "other" (muted)
  core: boolean
}

export interface Dataset {
  users: User[]
  events: RawEvent[]
  registry: EventType[]
  source: string
}

export interface DayCol {
  date: Date
  key: string // YYYY-MM-DD local
  weekend: boolean
  monthStart: boolean
}

export interface CellData {
  total: number
  counts: Record<string, number>
  primary: string // event key whose shape/color the cell wears
}

export interface GridRow {
  user: User
  cells: Map<number, CellData> // day index -> cell
  firstSeenKey: string // YYYY-MM-DD of very first event (all-time, unfiltered)
  activeDays: number
  totalEvents: number
  lastActiveIdx: number
  maxStreak: number
}

export interface GridModel {
  days: DayCol[]
  rows: GridRow[]
}

export type SortKey = 'firstSeen' | 'activeDays' | 'lastActive' | 'streak'

// ---- Codebase scan / event plan (scanner/scan.mjs output) ----

export type EventTier = 'core' | 'activation' | 'feature' | 'noise'

export interface InstrumentationPoint {
  file: string
  location: string
  snippet: string
}

export interface PlannedEvent {
  key: string
  label: string
  description: string
  tier: EventTier
  confidence: 'high' | 'medium' | 'low'
  rationale: string
  instrumentation: InstrumentationPoint[]
}

export interface EventPlan {
  product_summary: string
  core_event: string
  events: PlannedEvent[]
  meta?: {
    scanned_path: string
    files_included: number
    files_skipped: number
    model: string
    generated_at: string
    usage?: { input_tokens: number; output_tokens: number }
  }
}
