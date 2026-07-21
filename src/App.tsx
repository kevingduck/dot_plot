import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset, DbSyncConfig, EventPlan, EventType, SortKey } from './types'
import { COLORS, seriesColor, type Mode } from './theme'
import { generateSample } from './data/generate'
import { datasetFromEvents, parseCsv, toCsv } from './data/csv'
import { postJson } from './lib/api'
import { fetchAppMode, setAccessKey, type AppMode } from './lib/mode'
import { buildModel, computeStats } from './lib/model'
import { buildCohorts } from './lib/retention'
import { DotPlot } from './components/DotPlot'
import { RetentionChart } from './components/RetentionChart'
import { StatTiles } from './components/StatTiles'
import { UserDrawer } from './components/UserDrawer'
import { EventPlanPanel } from './components/EventPlanPanel'
import { ConnectWizard } from './components/ConnectWizard'
import { InsightCards, type InsightsResponse } from './components/InsightCards'
import { SettingsPanel } from './components/SettingsPanel'
import { ShapeIcon } from './components/ShapeIcon'

type ThemePref = 'auto' | 'light' | 'dark'

function useMode(pref: ThemePref): Mode {
  const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setOsDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return pref === 'auto' ? (osDark ? 'dark' : 'light') : pref
}

const STORE_KEY = 'dotchart:v2' // v1 abandoned: could hold pre-reset datasets that would re-pollute workspaces via autosave

interface Persisted {
  dataset: Dataset
  plan: EventPlan | null
  dbSync?: DbSyncConfig | null
  insights?: InsightsResponse | null
}

interface WorkspaceSummary {
  slug: string
  name: string
  path: string
  savedAt: number
  users: number
  events: number
  hasInsights: boolean
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Persisted
    if (!p.dataset?.users || !p.dataset?.events || !p.dataset?.registry) return null
    // Never restore a demo-tainted session (older builds could cache one)
    if (p.dataset.source.startsWith('Sample data')) return null
    return p
  } catch {
    return null
  }
}

/** Registry built from plan events that exist in the data (core first, top 4 get symbols). */
function registryFromPlan(names: Set<string>, accepted: { key: string; label: string }[], coreKey: string): EventType[] | null {
  const present = accepted.filter((e) => names.has(e.key))
  if (present.length === 0) return null
  const ordered = [...present.filter((e) => e.key === coreKey), ...present.filter((e) => e.key !== coreKey)]
  const shapes = ['circle', 'square', 'diamond', 'triangle'] as const
  const registry: EventType[] = ordered.slice(0, 4).map((e, i) => ({
    key: e.key,
    label: e.label,
    shape: shapes[i],
    slot: i,
    core: i === 0,
  }))
  const covered = new Set(registry.map((t) => t.key))
  if ([...names].some((n) => !covered.has(n))) {
    registry.push({ key: '__other__', label: 'Other', shape: 'dot', slot: -1, core: false })
  }
  return registry
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

const RANGES: [string, string][] = [
  ['14', 'Last 14 days'],
  ['30', 'Last 30 days'],
  ['60', 'Last 60 days'],
  ['all', 'All time'],
  ['custom', 'Custom range…'],
]

export default function App() {
  const [persisted] = useState<Persisted | null>(loadPersisted)
  const [seed, setSeed] = useState(1)
  const [dataset, setDataset] = useState<Dataset>(() => persisted?.dataset ?? generateSample(1))
  const datasetRef = useRef<Dataset>(dataset)
  datasetRef.current = dataset
  const [importError, setImportError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(() => persisted === null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>({ hosted: false, authRequired: false, hasServerKey: true })
  const [modeReady, setModeReady] = useState(false)
  const [authOk, setAuthOk] = useState(true)
  const [lockError, setLockError] = useState('')

  useEffect(() => {
    fetchAppMode().then((m) => {
      setAppMode(m)
      setModeReady(true)
      if (m.authRequired) {
        postJson('/api/keycheck', {}).then(
          () => setAuthOk(true),
          () => setAuthOk(false),
        )
      }
    }, () => setModeReady(true))
  }, [])

  const [rangePreset, setRangePreset] = useState('60')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [platform, setPlatform] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('firstSeen')
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(() => new Set(dataset.registry.map((t) => t.key)))
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [themePref, setThemePref] = useState<ThemePref>(() => {
    const q = new URLSearchParams(window.location.search).get('theme')
    return q === 'dark' || q === 'light' ? q : 'auto'
  })

  // Event plan (from the Connect wizard or an imported file)
  const [plan, setPlan] = useState<EventPlan | null>(persisted?.plan ?? null)
  const [planOpen, setPlanOpen] = useState(persisted?.plan != null)
  const [dataMenuOpen, setDataMenuOpen] = useState(false)
  const planFileRef = useRef<HTMLInputElement>(null)

  // Live tracked events (from /ingest) + database re-sync
  const [dbSync, setDbSync] = useState<DbSyncConfig | null>(persisted?.dbSync ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [liveCount, setLiveCount] = useState(0)
  const [liveLastAt, setLiveLastAt] = useState<number | null>(null)
  const [highlightUsers, setHighlightUsers] = useState<Set<string> | null>(null)
  const mergedCountRef = useRef(0)

  // Per-project workspaces (saved server-side under ~/.dotchart/projects)
  const [insightsSaved, setInsightsSaved] = useState<InsightsResponse | null>(persisted?.insights ?? null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false)
  const projectKey = plan?.meta?.scanned_path ?? null

  const refreshWorkspaces = useCallback(() => {
    postJson<{ projects: WorkspaceSummary[] }>('/api/projects/list', {}).then(
      (r) => setWorkspaces(r.projects),
      () => {},
    )
  }, [])
  useEffect(refreshWorkspaces, [refreshWorkspaces])

  // Autosave the active project's workspace (debounced) whenever it changes
  useEffect(() => {
    if (!projectKey) return
    const t = setTimeout(() => {
      const demo = dataset.source.startsWith('Sample data')
      postJson('/api/projects/save', {
        path: projectKey,
        name: projectKey.split('/').pop(),
        dataset: demo ? null : dataset,
        plan,
        dbSync,
        insights: insightsSaved,
      }).then(refreshWorkspaces, () => {})
    }, 1200)
    return () => clearTimeout(t)
  }, [projectKey, dataset, plan, dbSync, insightsSaved, refreshWorkspaces])

  // Persist real data (not the regenerable sample) across reloads
  useEffect(() => {
    try {
      if (dataset.source.startsWith('Sample data')) {
        localStorage.removeItem(STORE_KEY)
        return
      }
      const raw = JSON.stringify({ dataset, plan, dbSync, insights: insightsSaved })
      if (raw.length < 4_500_000) localStorage.setItem(STORE_KEY, raw)
    } catch {
      /* quota exceeded — skip persistence */
    }
  }, [dataset, plan, dbSync, insightsSaved])

  const loadDataset = useCallback((ds: Dataset) => {
    mergedCountRef.current = 0 // live events re-merge into the new dataset
    setDataset(ds)
    setEnabledEvents(new Set(ds.registry.map((t) => t.key)))
    setSelectedUserId(null)
    setPlatform('all')
    setPlanFilter('all')
    setSearch('')
    setImportError(null)
  }, [])

  // Merge events received via /ingest into the current dataset (deduped).
  // If the grid is showing demo data, real events REPLACE it — fictional and
  // real users must never mix.
  const mergeLiveEvents = useCallback((incoming: { userId: string; event: string; ts: number }[]) => {
    if (incoming.length === 0) return
    if (datasetRef.current.source.startsWith('Sample data')) {
      const ds = datasetFromEvents(incoming, 'Live tracked events')
      const registry = plan ? registryFromPlan(new Set(ds.events.map((e) => e.event)), plan.events, plan.core_event) : null
      loadDataset(registry ? { ...ds, registry } : ds)
      return
    }
    setDataset((prev) => {
      const seen = new Set(prev.events.map((e) => `${e.userId}|${e.event}|${e.ts}`))
      const fresh = incoming.filter((e) => !seen.has(`${e.userId}|${e.event}|${e.ts}`))
      if (fresh.length === 0) return prev
      const users = new Map(prev.users.map((u) => [u.id, u]))
      for (const e of fresh) {
        if (!users.has(e.userId)) {
          const name = e.userId.startsWith('anon_') ? `Visitor ${e.userId.slice(5, 11)}` : e.userId
          users.set(e.userId, { id: e.userId, name, platform: '—', plan: '—', country: '—' })
        }
      }
      const events = [...prev.events, ...fresh].sort((a, b) => a.ts - b.ts)
      let registry = prev.registry
      const known = new Set(registry.map((t) => t.key))
      if (fresh.some((e) => !known.has(e.event)) && !known.has('__other__')) {
        registry = [...registry, { key: '__other__', label: 'Other', shape: 'dot' as const, slot: -1, core: false }]
      }
      const source = prev.source.includes(' + live') ? prev.source : `${prev.source} + live`
      return { ...prev, users: [...users.values()], events, registry, source }
    })
    setEnabledEvents((prev) => (prev.has('__other__') ? prev : new Set([...prev, '__other__'])))
  }, [plan, loadDataset])

  // Poll the store so tracked events appear on the grid without a reload
  useEffect(() => {
    let stopped = false
    const check = async () => {
      try {
        const info = await postJson<{ count: number; lastReceived: number | null }>('/api/store/events', { countOnly: true })
        if (stopped) return
        setLiveCount(info.count)
        setLiveLastAt(info.lastReceived ?? null)
        if (info.count > mergedCountRef.current) {
          const full = await postJson<{ events: { userId: string; event: string; ts: number }[] }>('/api/store/events', {})
          if (stopped) return
          mergedCountRef.current = full.events.length
          mergeLiveEvents(full.events)
        }
      } catch {
        /* dev server unreachable — retry next tick */
      }
    }
    check()
    const t = setInterval(check, 15000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [mergeLiveEvents])

  // Re-import from the connected database, keeping the registry and plan
  const refreshDb = useCallback(async () => {
    if (!dbSync || refreshing) return
    setRefreshing(true)
    try {
      const out = await postJson<{ events: { userId: string; event: string; ts: number }[] }>('/api/db/import', dbSync)
      if (out.events.length > 0) {
        setDataset((prev) => {
          const base = prev.source.replace(/ \+ live$/, '')
          const ds = datasetFromEvents(out.events, base)
          return { ...ds, registry: prev.registry, source: base }
        })
        mergedCountRef.current = 0 // live events re-merge on the next poll
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [dbSync, refreshing])
  const mode = useMode(themePref)
  const colors = COLORS[mode]
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = themePref === 'auto' ? '' : themePref
  }, [themePref])


  const loadWorkspace = useCallback(
    async (slug: string) => {
      setProjectsMenuOpen(false)
      try {
        const ws = await postJson<Persisted & { path: string }>('/api/projects/load', { slug })
        if (ws.dataset) {
          loadDataset(ws.dataset)
        } else {
          // Workspace saved before real data existed — chart the live store,
          // or an empty waiting state. NEVER demo data inside a project.
          const store = await postJson<{ events: { userId: string; event: string; ts: number }[] }>('/api/store/events', {})
          const name = (ws as { name?: string }).name ?? slug
          if (store.events.length > 0 && ws.plan) {
            const ds = datasetFromEvents(store.events, `${name} (live tracked events)`)
            const registry = registryFromPlan(new Set(ds.events.map((e) => e.event)), ws.plan.events, ws.plan.core_event)
            loadDataset(registry ? { ...ds, registry } : ds)
            mergedCountRef.current = store.events.length
          } else {
            const planKeys = ws.plan ? new Set(ws.plan.events.map((e) => e.key)) : new Set<string>()
            const registry = ws.plan ? registryFromPlan(planKeys, ws.plan.events, ws.plan.core_event) ?? [] : []
            loadDataset({ users: [], events: [], registry, source: `${name} — waiting for first events` })
          }
        }
        setPlan(ws.plan ?? null)
        setPlanOpen(ws.plan != null)
        setDbSync(ws.dbSync ?? null)
        setInsightsSaved(ws.insights ?? null)
        setHighlightUsers(null)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadDataset],
  )


  // Cell display priority: the rarest event of the day wins the cell, so
  // low-frequency, high-signal moments (created a playlist) stay visible on
  // days the core event also happened. "__other__" always loses.
  const registryKeys = useMemo(() => {
    const freq = new Map<string, number>()
    for (const e of dataset.events) freq.set(e.event, (freq.get(e.event) ?? 0) + 1)
    const keys = dataset.registry.filter((t) => t.key !== '__other__').map((t) => t.key)
    keys.sort((a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0))
    if (dataset.registry.some((t) => t.key === '__other__')) keys.push('__other__')
    return keys
  }, [dataset])

  const range = useMemo(() => {
    if (rangePreset === 'custom') return { from: customFrom || undefined, to: customTo || undefined }
    if (rangePreset === 'all') return {}
    return { lastDays: Number(rangePreset) }
  }, [rangePreset, customFrom, customTo])

  const model = useMemo(
    () => buildModel(dataset, { range, platform, plan: planFilter, search, enabledEvents, sortBy, registryKeys }),
    [dataset, range, platform, planFilter, search, enabledEvents, sortBy, registryKeys],
  )

  const coreType = dataset.registry.find((t) => t.core) ?? null
  const stats = useMemo(() => computeStats(model, coreType?.key ?? null), [model, coreType])

  const cohorts = useMemo(() => buildCohorts(dataset, new Set(model.rows.map((r) => r.user.id))), [dataset, model])

  const datasetEventNames = useMemo(() => new Set(dataset.events.map((e) => e.event)), [dataset])
  const platforms = useMemo(() => [...new Set(dataset.users.map((u) => u.platform))].sort(), [dataset])
  const plans = useMemo(() => [...new Set(dataset.users.map((u) => u.plan))].sort(), [dataset])

  const selectedRow = selectedUserId ? model.rows.find((r) => r.user.id === selectedUserId) ?? null : null

  const onImport = useCallback(
    (file: File) => {
      file.text().then(
        (text) => {
          try {
            loadDataset(parseCsv(text, file.name))
          } catch (err) {
            setImportError(err instanceof Error ? err.message : String(err))
          }
        },
        () => setImportError('Could not read file'),
      )
    },
    [loadDataset],
  )

  useEffect(() => {
    setDataMenuOpen(false)
  }, [dataset])

  // Apply accepted plan events to the grid: matched keys become the registry
  // (labels, shapes, core flag), everything else folds into "Other".
  const applyPlan = useCallback(
    (accepted: { key: string; label: string }[], coreKey: string) => {
      const registry = registryFromPlan(new Set(dataset.events.map((e) => e.event)), accepted, coreKey)
      if (!registry) return
      setDataset((prev) => ({ ...prev, registry, source: `${prev.source.replace(/ \+ event plan$/, '')} + event plan` }))
      setEnabledEvents(new Set(registry.map((t) => t.key)))
    },
    [dataset],
  )

  // Connect wizard completion: real data + the plan arrive together
  const onWizardData = useCallback(
    (events: { userId: string; event: string; ts: number }[], source: string, wizardPlan: EventPlan, sync?: DbSyncConfig) => {
      const ds = datasetFromEvents(events, source)
      const registry = registryFromPlan(new Set(ds.events.map((e) => e.event)), wizardPlan.events, wizardPlan.core_event)
      loadDataset(registry ? { ...ds, registry } : ds)
      setPlan(wizardPlan)
      setPlanOpen(true)
      setDbSync(sync ?? null)
      setWizardOpen(false)
    },
    [loadDataset],
  )

  const onImportPlan = useCallback((file: File) => {
    file.text().then(
      (text) => {
        try {
          const parsed = JSON.parse(text)
          if (!Array.isArray(parsed.events)) throw new Error('Not a DotChart event plan (missing events array)')
          setPlan(parsed as EventPlan)
          setPlanOpen(true)
          setWizardOpen(false)
        } catch (err) {
          setImportError(err instanceof Error ? err.message : String(err))
        }
      },
      () => setImportError('Could not read file'),
    )
  }, [])

  const onExport = useCallback(() => {
    const blob = new Blob([toCsv(dataset)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dotchart-events.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [dataset])

  if (!authOk) {
    return (
      <div className="app lock-screen">
        <section className="card lock-card">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <ShapeIcon shape="circle" color={colors.series[0]} size={14} />
            </span>
            <span className="brand-name">DotChart</span>
          </div>
          <p className="card-sub">This DotChart is password-protected.</p>
          <form
            className="scan-bar-main"
            onSubmit={(e) => {
              e.preventDefault()
              const pw = new FormData(e.currentTarget).get('password')
              setAccessKey(String(pw ?? ''))
              postJson('/api/keycheck', {}).then(
                () => window.location.reload(),
                () => setLockError('Wrong password'),
              )
            }}
          >
            <input type="password" name="password" className="scan-path" placeholder="Password" aria-label="Password" autoFocus />
            <button className="btn btn-primary" type="submit">
              Unlock
            </button>
          </form>
          {lockError && <div className="scan-error">⚠ {lockError}</div>}
        </section>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShapeIcon shape="circle" color={colors.series[0]} size={14} />
          </span>
          <span className="brand-name">DotChart</span>
          <span className="brand-tag">see what your users are actually doing</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setWizardOpen(!wizardOpen)} aria-expanded={wizardOpen}>
            Connect project
          </button>
          {plan && (
            <button className="btn" onClick={() => setPlanOpen(!planOpen)} aria-expanded={planOpen}>
              {planOpen ? 'Hide event plan' : 'Event plan'}
            </button>
          )}
          {workspaces.length > 0 && (
            <div className="menu-wrap">
              <button
                className="btn"
                onClick={() => setProjectsMenuOpen(!projectsMenuOpen)}
                aria-expanded={projectsMenuOpen}
                aria-haspopup="menu"
              >
                Projects ▾
              </button>
              {projectsMenuOpen && (
                <div className="menu" role="menu">
                  {workspaces.map((w) => (
                    <div className="menu-row" key={w.slug}>
                      <button role="menuitem" onClick={() => loadWorkspace(w.slug)} title={w.path}>
                        {projectKey === w.path ? '● ' : ''}
                        {w.name}
                        <span className="menu-sub">
                          {w.users} users · {w.events.toLocaleString()} events{w.hasInsights ? ' · insights' : ''}
                        </span>
                      </button>
                      <button
                        className="menu-delete"
                        aria-label={`Forget ${w.name}`}
                        title="Forget this saved project"
                        onClick={async () => {
                          await postJson('/api/projects/delete', { slug: w.slug })
                          refreshWorkspaces()
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="menu-wrap">
            <button className="btn" onClick={() => setDataMenuOpen(!dataMenuOpen)} aria-expanded={dataMenuOpen} aria-haspopup="menu">
              Data ▾
            </button>
            {dataMenuOpen && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => (setDataMenuOpen(false), fileRef.current?.click())}>
                  Import events CSV…
                </button>
                <button role="menuitem" onClick={() => (setDataMenuOpen(false), planFileRef.current?.click())}>
                  Import event plan…
                </button>
                <button role="menuitem" onClick={() => (setDataMenuOpen(false), onExport())}>
                  Export current data as CSV
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    const next = seed + 1
                    setSeed(next)
                    loadDataset(generateSample(next))
                  }}
                >
                  Load demo data (fictional music app)
                </button>
                {liveCount > 0 && (
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setDataMenuOpen(false)
                      await postJson('/api/store/clear', {})
                      mergedCountRef.current = 0
                      setLiveCount(0)
                    }}
                  >
                    Clear tracked events ({liveCount})
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            className="btn btn-icon"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings — model & API key"
            aria-label="Settings"
            aria-expanded={settingsOpen}
          >
            ⚙
          </button>
          <button
            className="btn btn-icon"
            onClick={() => setThemePref(themePref === 'auto' ? 'dark' : themePref === 'dark' ? 'light' : 'auto')}
            title={`Theme: ${themePref} — click to change`}
            aria-label="Toggle theme"
          >
            {themePref === 'auto' ? '◐' : themePref === 'dark' ? '●' : '○'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
          <input
            ref={planFileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportPlan(f)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="statusbar">
        <span className="source-label">{dataset.source}</span>
        {appMode.hosted && <span className="mode-chip">hosted</span>}
        {liveCount > 0 && (
          <span
            className="live-chip"
            title="Total events your instrumented app has sent to the ingest endpoint (all time, all projects). They merge into the grid automatically."
          >
            ● {liveCount} tracked event{liveCount === 1 ? '' : 's'} received
            {liveLastAt != null && <span className="live-when"> · last {relTime(liveLastAt)}</span>}
          </span>
        )}
        {dbSync && (
          <button className="btn btn-ghost statusbar-refresh" onClick={refreshDb} disabled={refreshing} title="Re-import fresh events from your database (read-only)">
            {refreshing ? 'Refreshing…' : '↻ Refresh data'}
          </button>
        )}
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {wizardOpen && modeReady && (
        <ConnectWizard
          hosted={appMode.hosted}
          onData={onWizardData}
          onDbImport={(events, source, sync) => {
            try {
              loadDataset(datasetFromEvents(events, source))
              setDbSync(sync ?? null)
              setWizardOpen(false)
            } catch (err) {
              setImportError(err instanceof Error ? err.message : String(err))
            }
          }}
          onImportCsv={() => fileRef.current?.click()}
          onImportPlanFile={() => planFileRef.current?.click()}
          onDemo={() => {
            const next = seed + 1
            setSeed(next)
            loadDataset(generateSample(next))
            setWizardOpen(false)
          }}
          onPlanOnly={(p) => {
            setPlan(p)
            setPlanOpen(true)
            setWizardOpen(false)
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {importError && (
        <div className="import-error" role="alert">
          ⚠ {importError}
          <button className="btn btn-ghost" onClick={() => setImportError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {plan && planOpen && (
        <EventPlanPanel
          key={`${plan.meta?.generated_at ?? ''}:${plan.events.map((e) => e.key).join(',')}`}
          plan={plan}
          datasetEvents={datasetEventNames}
          datasetIsDemo={dataset.source.startsWith('Sample data') && !dataset.source.includes(' + live')}
          onApply={applyPlan}
          onClose={() => setPlanOpen(false)}
        />
      )}

      <div className="filter-row">
        <select value={rangePreset} onChange={(e) => setRangePreset(e.target.value)} aria-label="Date range">
          {RANGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {rangePreset === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Range start"
            />
            <span className="range-sep">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="Range end" />
          </>
        )}
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="all">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Plan">
          <option value="all">All plans</option>
          {plans.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} aria-label="Sort users">
          <option value="firstSeen">Sort: signup date</option>
          <option value="activeDays">Sort: most active days</option>
          <option value="lastActive">Sort: recently active</option>
          <option value="streak">Sort: longest streak</option>
        </select>
        <input
          type="search"
          placeholder="Find user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
      </div>

      <StatTiles stats={stats} coreLabel={coreType?.label ?? 'All'} />

      <InsightCards
        key={projectKey ?? 'adhoc'}
        model={model}
        dataset={dataset}
        saved={insightsSaved}
        onSaved={setInsightsSaved}
        onHighlight={setHighlightUsers}
      />

      <section className="card card-grid">
        <div className="card-head">
          <div>
            <h2>Daily activity</h2>
            <p className="card-sub">
              One row per user, one column per day. Ring = first day. The symbol shows the day's rarest event; bigger = more events. Click a row for the full log.
            </p>
          </div>
          <div className="legend-row" role="list" aria-label="Event types">
            {dataset.registry.map((t) => {
              const on = enabledEvents.has(t.key)
              return (
                <button
                  key={t.key}
                  role="listitem"
                  className={`legend-item legend-toggle${on ? '' : ' legend-off'}`}
                  aria-pressed={on}
                  title={on ? 'Click to hide this event from the grid' : 'Click to show this event again'}
                  onClick={() => {
                    const next = new Set(enabledEvents)
                    if (on) next.delete(t.key)
                    else next.add(t.key)
                    setEnabledEvents(next)
                  }}
                >
                  <ShapeIcon shape={t.shape} color={seriesColor(colors, t.slot)} />
                  {t.label}
                  {t.core && <span className="legend-n">core</span>}
                </button>
              )
            })}
          </div>
        </div>
        {dataset.events.length === 0 ? (
          <div className="empty-note waiting-note">
            <span className="scan-pulse" aria-hidden="true" />
            <div>
              <strong>Waiting for the first event.</strong> This project has no data yet — as soon as the instrumented
              app sends its first <code>track()</code> call to the ingest endpoint, it appears here (checked every ~15
              seconds, no reload needed).
            </div>
          </div>
        ) : model.rows.length > 0 ? (
          <DotPlot
            model={model}
            registry={dataset.registry}
            colors={colors}
            selectedUserId={selectedUserId}
            highlightUsers={highlightUsers}
            onSelectUser={setSelectedUserId}
          />
        ) : (
          <div className="empty-note">No matching users — adjust the filters, or import a CSV with columns user_id, event, timestamp.</div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Cohort retention</h2>
            <p className="card-sub">Share of each signup-week cohort active in the weeks after signup. Scoped to the filtered users above.</p>
          </div>
        </div>
        <RetentionChart cohorts={cohorts} colors={colors} />
      </section>

      {selectedRow && (
        <UserDrawer row={selectedRow} dataset={dataset} registry={dataset.registry} colors={colors} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  )
}
