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
  // Device info classified from the sender's User-Agent at /ingest
  // (browser-sent events only — server-side SDKs can't know the device)
  os?: string
  browser?: string
  device?: string
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
  // Connect wizard: filled when an existing DB table already records this
  // event (empty strings = needs instrumentation)
  db_mapping?: { table: string; user_column: string; timestamp_column: string }
}

export interface DiscoveredProject {
  root: string
  name: string
  framework: string
  files: { included: number; skipped: number; total: number }
  databases: { envFile: string; varName: string; connectionString: string; redacted: string }[]
}

export interface PreparedEdit {
  id: string
  event_key: string
  file: string
  old_string: string
  new_string: string
  explanation: string
  status: 'ok' | 'no_match' | 'ambiguous'
  reason: string
}

export interface InstrumentPrep {
  sdk_file: { path: string; content: string }
  edits: PreparedEdit[]
  notes: string
  meta: { target: string; model: string; usage?: { input_tokens: number; output_tokens: number } }
}

export interface InstrumentResult {
  branch: string
  baseBranch: string
  commit: string
  applied: PreparedEdit[]
  skipped: (PreparedEdit & { reason: string })[]
  filesChanged: string[]
}

export interface DbSyncConfig {
  connectionString: string
  mappings: { table: string; event: string; user_column: string | null; timestamp_column: string | null }[]
  days: number
}

export interface DbTable {
  table: string
  columns: string[]
  user_column: string | null
  timestamp_column: string | null
  approx_rows: number
  eligible: boolean
  suggested_event: string
  suggested_label: string
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
