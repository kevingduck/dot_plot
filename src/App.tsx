import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset, EventPlan, SortKey } from './types'
import { COLORS, seriesColor, type Mode } from './theme'
import { generateSample } from './data/generate'
import { parseCsv, toCsv } from './data/csv'
import { buildModel, computeStats } from './lib/model'
import { buildCohorts } from './lib/retention'
import { DotPlot } from './components/DotPlot'
import { RetentionChart } from './components/RetentionChart'
import { StatTiles } from './components/StatTiles'
import { UserDrawer } from './components/UserDrawer'
import { EventPlanPanel } from './components/EventPlanPanel'
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

const RANGES: [string, string][] = [
  ['14', 'Last 14 days'],
  ['30', 'Last 30 days'],
  ['60', 'Last 60 days'],
  ['all', 'All time'],
  ['custom', 'Custom range…'],
]

export default function App() {
  const [seed, setSeed] = useState(1)
  const [dataset, setDataset] = useState<Dataset>(() => generateSample(1))
  const [importError, setImportError] = useState<string | null>(null)

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

  // Codebase scan / event plan
  const [scanOpen, setScanOpen] = useState(false)
  const [scanPath, setScanPath] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [plan, setPlan] = useState<EventPlan | null>(null)
  const planFileRef = useRef<HTMLInputElement>(null)
  const mode = useMode(themePref)
  const colors = COLORS[mode]
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = themePref === 'auto' ? '' : themePref
  }, [themePref])

  const loadDataset = useCallback((ds: Dataset) => {
    setDataset(ds)
    setEnabledEvents(new Set(ds.registry.map((t) => t.key)))
    setSelectedUserId(null)
    setPlatform('all')
    setPlanFilter('all')
    setSearch('')
    setImportError(null)
  }, [])

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

  const runScan = useCallback(async () => {
    if (!scanPath.trim() || scanning) return
    setScanning(true)
    setScanError(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: scanPath.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Scan failed (${res.status})`)
      setPlan(data as EventPlan)
      setScanOpen(false)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [scanPath, scanning])

  const onImportPlan = useCallback((file: File) => {
    file.text().then(
      (text) => {
        try {
          const parsed = JSON.parse(text)
          if (!Array.isArray(parsed.events)) throw new Error('Not a DotChart event plan (missing events array)')
          setPlan(parsed as EventPlan)
          setScanOpen(false)
          setScanError(null)
        } catch (err) {
          setScanError(err instanceof Error ? err.message : String(err))
        }
      },
      () => setScanError('Could not read file'),
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
          <span className="source-label">{dataset.source}</span>
          <button
            className="btn"
            onClick={() => {
              const next = seed + 1
              setSeed(next)
              loadDataset(generateSample(next))
            }}
          >
            New sample
          </button>
          <button className="btn" onClick={() => setScanOpen(!scanOpen)} aria-expanded={scanOpen}>
            Scan codebase
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import CSV
          </button>
          <button className="btn" onClick={onExport}>
            Export CSV
          </button>
          <button
            className="btn"
            onClick={() => setThemePref(themePref === 'auto' ? 'dark' : themePref === 'dark' ? 'light' : 'auto')}
            title="Toggle theme"
          >
            {themePref === 'auto' ? '◐ Auto' : themePref === 'dark' ? '● Dark' : '○ Light'}
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
        </div>
      </header>

      {importError && (
        <div className="import-error" role="alert">
          ⚠ {importError}
          <button className="btn btn-ghost" onClick={() => setImportError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {scanOpen && (
        <div className="scan-bar">
          <div className="scan-bar-main">
            <input
              type="text"
              className="scan-path"
              placeholder="/path/to/your/codebase"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runScan()}
              disabled={scanning}
              aria-label="Codebase path"
            />
            <button className="btn btn-primary" onClick={runScan} disabled={scanning || !scanPath.trim()}>
              {scanning ? 'Scanning… (~1 min)' : 'Scan with Claude'}
            </button>
            <button className="btn btn-ghost" onClick={() => planFileRef.current?.click()} disabled={scanning}>
              …or import dotchart.events.json
            </button>
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
          <div className="scan-hint">
            Reads the codebase server-side and asks Claude ({'Opus 4.8'}) to propose the user events worth tracking. Also
            available as a CLI: <code>npm run scan -- /path/to/codebase</code>
          </div>
          {scanError && <div className="scan-error">⚠ {scanError}</div>}
        </div>
      )}

      {plan && <EventPlanPanel plan={plan} onClose={() => setPlan(null)} />}

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
        {model.rows.length > 0 ? (
          <DotPlot model={model} registry={dataset.registry} colors={colors} selectedUserId={selectedUserId} onSelectUser={setSelectedUserId} />
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
