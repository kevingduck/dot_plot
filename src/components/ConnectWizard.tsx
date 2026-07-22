import { useEffect, useMemo, useRef, useState } from 'react'
import type { DbSyncConfig, DiscoveredProject, EventPlan, RawEvent } from '../types'
import { postJson, postNdjson } from '../lib/api'
import { PROVIDERS, addRecent, aiParams, getRecents, getSettings, saveSettings, type Provider } from '../lib/settings'
import { browserOllamaActive, runBrowserOllamaTask } from '../lib/ai'
import { probeOllama, type OllamaProbe } from '../lib/ollamaClient'
import { digestFromFileList, pickLocalFolder, type LocalDigest } from '../lib/localdigest'
import { DbPanel } from './DbPanel'

type Phase = 'pick' | 'cloning' | 'discovering' | 'discovered' | 'analyzing' | 'review' | 'importing'

interface ImportResponse {
  events: { userId: string; event: string; ts: number }[]
  summary: { table: string; event: string; rows: number; error?: string }[]
}

interface DirListing {
  path: string
  parent: string | null
  home: string
  isProject: boolean
  shortcuts: { name: string; path: string }[]
  dirs: { name: string; path: string; isProject: boolean }[]
}

interface Props {
  hosted: boolean
  serverKeys: { anthropic: boolean; openai: boolean }
  onData: (events: RawEvent[], source: string, plan: EventPlan, sync?: DbSyncConfig) => void
  onPlanOnly: (plan: EventPlan) => void
  onDbImport: (events: RawEvent[], source: string, sync?: DbSyncConfig) => void
  onImportCsv: () => void
  onImportPlanFile: () => void
  onDemo: () => void
  onClose: () => void
}

const TIER_LABEL: Record<string, string> = { core: 'Core value', activation: 'Activation', feature: 'Feature', noise: 'Noise' }

/** Click-to-browse folder picker backed by /api/fs/list. */
function FolderPicker({ onSelect, disabled }: { onSelect: (path: string) => void; disabled: boolean }) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recents = useMemo(getRecents, [])

  const browse = (path?: string) => {
    postJson<DirListing>('/api/fs/list', { path }).then(setListing, (e) => setError(e.message))
  }
  useEffect(() => browse(), [])

  if (error) return <div className="scan-error">⚠ {error}</div>
  if (!listing) return <div className="scan-hint">Loading folders…</div>

  return (
    <div className="picker">
      {recents.length > 0 && (
        <div className="picker-recents">
          Recent:
          {recents.map((r) => (
            <button key={r.path} className="btn picker-recent" onClick={() => onSelect(r.path)} disabled={disabled} title={r.path}>
              {r.name}
            </button>
          ))}
        </div>
      )}
      <div className="picker-bar">
        {listing.shortcuts.map((s) => (
          <button key={s.path} className="btn btn-ghost picker-shortcut" onClick={() => browse(s.path)}>
            {s.name}
          </button>
        ))}
        <span className="picker-path" title={listing.path}>
          {listing.path.replace(listing.home, '~')}
        </span>
      </div>
      <div className="picker-list">
        {listing.parent && (
          <button className="picker-row" onClick={() => browse(listing.parent!)}>
            <span className="picker-icon">↰</span> ..
          </button>
        )}
        {listing.dirs.map((d) => (
          <div className="picker-row" key={d.path}>
            <button className="picker-nav" onClick={() => browse(d.path)}>
              <span className="picker-icon">📁</span> {d.name}
              {d.isProject && <span className="picker-badge">project</span>}
            </button>
            {d.isProject && (
              <button className="btn btn-primary picker-choose" onClick={() => onSelect(d.path)} disabled={disabled}>
                Select
              </button>
            )}
          </div>
        ))}
        {listing.dirs.length === 0 && <div className="scan-hint picker-empty">No folders here.</div>}
      </div>
      {listing.isProject && (
        <button className="btn btn-primary" onClick={() => onSelect(listing.path)} disabled={disabled}>
          Use this folder ({listing.path.split('/').pop()})
        </button>
      )}
    </div>
  )
}

export function ConnectWizard({ hosted, serverKeys, onData, onPlanOnly, onDbImport, onImportCsv, onImportPlanFile, onDemo, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [tab, setTab] = useState<'local' | 'github'>('local')
  const [ghUrl, setGhUrl] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [project, setProject] = useState<DiscoveredProject | null>(null)
  const [useDb, setUseDb] = useState(true)
  const [dbIndex, setDbIndex] = useState(0)
  const [plan, setPlan] = useState<EventPlan | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(90)
  const [localDigest, setLocalDigest] = useState<LocalDigest | null>(null)
  const [digesting, setDigesting] = useState(false)
  const dirInputRef = useRef<HTMLInputElement>(null)

  // "Choose your AI" — analysis needs a working provider: a Claude/OpenAI key
  // (the user's or the server's) or a reachable Ollama. When nothing is
  // configured the analyze step becomes a one-question setup instead of a
  // dead end; when something is, the step never appears.
  const [aiCfg, setAiCfg] = useState(getSettings)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [ollama, setOllama] = useState<OllamaProbe | null>(null)

  // Silent probe so the Ollama card can say "detected · N models"
  useEffect(() => {
    probeOllama(aiCfg.ollamaUrl).then(setOllama)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aiReady =
    aiCfg.provider === 'ollama' ? aiCfg.models.ollama !== '' : serverKeys[aiCfg.provider] || aiCfg.keys[aiCfg.provider] !== ''

  const pickProvider = (p: Provider) => {
    const next = { ...aiCfg, provider: p }
    if (p === 'ollama' && ollama?.ok && ollama.models.length > 0 && !ollama.models.includes(next.models.ollama)) {
      next.models = { ...next.models, ollama: ollama.models[0] }
    }
    setAiCfg(next)
    saveSettings(next)
    setKeyError(null)
  }

  const saveKey = async () => {
    if (aiCfg.provider === 'ollama') return
    setKeyBusy(true)
    setKeyError(null)
    try {
      const apiKey = keyDraft.trim()
      await postJson('/api/keytest', { provider: aiCfg.provider, apiKey })
      const next = { ...aiCfg, keys: { ...aiCfg.keys, [aiCfg.provider]: apiKey } }
      saveSettings(next)
      setAiCfg(next)
      setKeyDraft('')
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setKeyBusy(false)
    }
  }

  const useDigest = (d: LocalDigest) => {
    if (d.included === 0) {
      setError('No source files found in that folder')
      return
    }
    setLocalDigest(d)
    setProject({
      root: `local:${d.name}`,
      name: d.name,
      framework: '',
      files: { included: d.included, skipped: d.skipped, total: d.included + d.skipped },
      databases: d.databases,
    })
    setUseDb(d.databases.length > 0)
    setDbIndex(0)
    setPhase('discovered')
    setError(null)
  }

  const browserPick = async () => {
    setDigesting(true)
    setError(null)
    try {
      const d = await pickLocalFolder()
      if (d) useDigest(d)
      else if (typeof window.showDirectoryPicker !== 'function') dirInputRef.current?.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDigesting(false)
    }
  }

  const discover = async (path: string) => {
    setPhase('discovering')
    setError(null)
    try {
      const p = await postJson<DiscoveredProject>('/api/connect/discover', { path })
      setProject(p)
      setUseDb(p.databases.length > 0)
      setDbIndex(0)
      addRecent({ path: p.root, name: p.name })
      setPhase('discovered')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('pick')
    }
  }

  const cloneGithub = async () => {
    setPhase('cloning')
    setError(null)
    try {
      const r = await postNdjson<{ path: string }>('/api/github/clone', { url: ghUrl.trim(), token: ghToken.trim() || undefined }, setStatus)
      setGhToken('')
      await discover(r.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('pick')
    }
  }

  const analyze = async () => {
    if (!project) return
    setPhase('analyzing')
    setError(null)
    try {
      const conn = useDb && project.databases[dbIndex] ? project.databases[dbIndex].connectionString : undefined
      const payload = localDigest
        ? {
            digest: { name: localDigest.name, digest: localDigest.digest, included: localDigest.included, skipped: localDigest.skipped, trackedKeys: localDigest.trackedKeys },
            connectionString: conn,
          }
        : { path: project.root, connectionString: conn }
      // Hosted + local Ollama: the server can't reach the user's machine, so
      // the model call runs right here in the browser.
      const result = browserOllamaActive()
        ? await runBrowserOllamaTask<EventPlan>('connect', payload, setStatus)
        : await postNdjson<EventPlan>('/api/connect/analyze', { ...payload, ...aiParams() }, setStatus)
      setPlan(result)
      setAccepted(new Set(result.events.filter((e) => e.tier !== 'noise').map((e) => e.key)))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('discovered')
    }
  }

  const acceptedEvents = useMemo(() => (plan ? plan.events.filter((e) => accepted.has(e.key)) : []), [plan, accepted])
  const dbEvents = useMemo(() => acceptedEvents.filter((e) => e.db_mapping?.table), [acceptedEvents])
  const codeEvents = useMemo(() => acceptedEvents.filter((e) => !e.db_mapping?.table), [acceptedEvents])

  const finish = async () => {
    if (!plan || !project) return
    setError(null)
    if (dbEvents.length === 0) {
      onPlanOnly({ ...plan, events: acceptedEvents.length ? acceptedEvents : plan.events })
      return
    }
    setPhase('importing')
    try {
      const conn = project.databases[dbIndex].connectionString
      const mappings = dbEvents.map((e) => ({
        table: e.db_mapping!.table,
        event: e.key,
        user_column: e.db_mapping!.user_column,
        timestamp_column: e.db_mapping!.timestamp_column,
      }))
      const out = await postJson<ImportResponse>('/api/db/import', { connectionString: conn, mappings, days })
      if (out.events.length === 0) {
        const errs = out.summary.filter((s) => s.error).map((s) => `${s.table}: ${s.error}`)
        throw new Error(`No events found in the last ${days} days${errs.length ? ` (${errs.join('; ')})` : ''} — try a longer window`)
      }
      onData(out.events, `${project.name} (live from database, last ${days}d)`, { ...plan, events: acceptedEvents }, {
        connectionString: conn,
        mappings,
        days,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('review')
    }
  }

  return (
    <section className="card wizard">
      <div className="card-head">
        <div>
          <h2>Connect your project</h2>
          <p className="card-sub">Pick your project — DotChart finds your database and your events; you approve; done.</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {(phase === 'pick' || phase === 'cloning' || phase === 'discovering') && (
        <>
          <div className="wizard-tabs" role="tablist">
            <button className={`wizard-tab${tab === 'local' ? ' wizard-tab-on' : ''}`} role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')}>
              On this computer
            </button>
            <button className={`wizard-tab${tab === 'github' ? ' wizard-tab-on' : ''}`} role="tab" aria-selected={tab === 'github'} onClick={() => setTab('github')}>
              From GitHub
            </button>
          </div>

          {tab === 'local' && !hosted && <FolderPicker onSelect={discover} disabled={phase !== 'pick'} />}
          {tab === 'local' && hosted && (
            <div className="wizard-github">
              <button className="btn btn-primary" onClick={browserPick} disabled={digesting || phase !== 'pick'}>
                {digesting ? 'Reading folder…' : '📁 Choose project folder…'}
              </button>
              <input
                ref={dirInputRef}
                type="file"
                hidden
                multiple
                aria-label="Project folder"
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={async (e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setDigesting(true)
                    try {
                      useDigest(await digestFromFileList(e.target.files))
                    } finally {
                      setDigesting(false)
                    }
                  }
                  e.target.value = ''
                }}
              />
              <div className="scan-hint">
                Your browser reads the folder locally and uploads only the filtered code digest (same content that goes
                to Claude) — the project itself never leaves your machine.
              </div>
            </div>
          )}

          {tab === 'github' && (
            <div className="wizard-github">
              <input
                type="text"
                className="scan-path"
                placeholder="https://github.com/owner/repo"
                value={ghUrl}
                onChange={(e) => setGhUrl(e.target.value)}
                disabled={phase !== 'pick'}
                aria-label="GitHub repository URL"
              />
              <input
                type="password"
                className="scan-path"
                placeholder="Access token — only needed for private repos"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                disabled={phase !== 'pick'}
                aria-label="GitHub access token"
                autoComplete="off"
              />
              <div className="scan-hint">
                The repo is copied to this machine and analyzed locally. A token is used once for the download and never
                stored (private repos: github.com → Settings → Developer settings → Fine-grained tokens → read-only
                access to the repo).
              </div>
              <button className="btn btn-primary" onClick={cloneGithub} disabled={!ghUrl.trim() || phase !== 'pick'}>
                {phase === 'cloning' ? 'Downloading…' : 'Connect repo'}
              </button>
            </div>
          )}

          {(phase === 'cloning' || phase === 'discovering') && (
            <div className="scan-status" role="status">
              <span className="scan-pulse" aria-hidden="true" />
              {phase === 'discovering' ? 'Looking at the project…' : status}
            </div>
          )}

          <details className="wizard-advanced">
            <summary>Other ways to add data</summary>
            <div className="wizard-advanced-body">
              <div className="wizard-advanced-row">
                <button className="btn" onClick={onImportCsv}>
                  Import a CSV of events
                </button>
                <button className="btn" onClick={onImportPlanFile}>
                  Import an event plan (dotchart.events.json)
                </button>
                <button className="btn" onClick={onDemo}>
                  Load demo data
                </button>
              </div>
              <div className="scan-divider" />
              <DbPanel onImport={onDbImport} />
            </div>
          </details>
        </>
      )}

      {phase === 'discovered' && project && (
        <div className="wizard-found">
          <div className="wizard-project">
            <div className="wizard-project-name">{project.name}</div>
            <div className="scan-hint">
              {project.framework && <>{project.framework} · </>}
              {project.files.included} source files ready to analyze
              {project.files.skipped > 0 && ` (${project.files.skipped} skipped by size budget)`}
            </div>
          </div>
          {project.databases.length > 0 ? (
            <label className="wizard-db">
              <input type="checkbox" checked={useDb} onChange={() => setUseDb(!useDb)} />
              <span>
                <strong>Database found</strong> in <code>{project.databases[dbIndex].envFile}</code> (
                <code>{project.databases[dbIndex].varName}</code>) — connect <em>read-only</em> so events already in your
                data can be charted immediately
                <div className="wizard-db-conn">
                  {hosted && /localhost|127\.0\.0\.1/.test(project.databases[dbIndex].connectionString) && (
                    <div className="scan-error">⚠ This looks like a localhost database — a hosted server can't reach it. Uncheck, or connect a cloud database URL.</div>
                  )}
                  {project.databases.length > 1 ? (
                    <select value={dbIndex} onChange={(e) => setDbIndex(Number(e.target.value))}>
                      {project.databases.map((d, i) => (
                        <option key={i} value={i}>
                          {d.redacted}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <code>{project.databases[0].redacted}</code>
                  )}
                </div>
              </span>
            </label>
          ) : (
            <div className="scan-hint">No database connection found in the repo's env files — analysis will use the code only.</div>
          )}
          {!aiReady && (
            <div className="wizard-keystep">
              <div className="scan-hint">
                <strong>One thing first — choose your AI.</strong> It reads the code and proposes your event plan; you
                can change it any time in ⚙ Settings.
              </div>
              <div className="provider-row" role="radiogroup" aria-label="AI provider">
                {PROVIDERS.map((p) => {
                  const badge =
                    p.id === 'ollama'
                      ? ollama?.ok
                        ? `detected · ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}`
                        : 'not detected'
                      : serverKeys[p.id as 'anthropic' | 'openai']
                        ? 'key on server ✓'
                        : aiCfg.keys[p.id as 'anthropic' | 'openai']
                          ? 'your key ✓'
                          : 'needs a key'
                  return (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={aiCfg.provider === p.id}
                      className={`provider-card${aiCfg.provider === p.id ? ' provider-on' : ''}`}
                      onClick={() => pickProvider(p.id)}
                    >
                      <strong>{p.label}</strong>
                      <span>{p.blurb}</span>
                      <span className="provider-badge">{badge}</span>
                    </button>
                  )
                })}
              </div>
              {aiCfg.provider !== 'ollama' && (
                <>
                  <div className="scan-hint">
                    Paste your {aiCfg.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key (
                    <a
                      href={aiCfg.provider === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://platform.openai.com/api-keys'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      create one here
                    </a>
                    ) — an analysis costs a few tens of cents. Stored only in this browser, used per request.
                  </div>
                  <div className="wizard-keyrow">
                    <input
                      type="password"
                      className="scan-path"
                      placeholder={aiCfg.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      aria-label="API key"
                      autoComplete="off"
                    />
                    <button className="btn btn-primary" onClick={saveKey} disabled={!keyDraft.trim() || keyBusy}>
                      {keyBusy ? 'Checking…' : 'Save key'}
                    </button>
                  </div>
                </>
              )}
              {aiCfg.provider === 'ollama' &&
                (ollama?.ok ? (
                  ollama.models.length > 0 ? (
                    <label className="scan-hint">
                      Model{' '}
                      <select
                        value={aiCfg.models.ollama}
                        onChange={(e) => {
                          const next = { ...aiCfg, models: { ...aiCfg.models, ollama: e.target.value } }
                          setAiCfg(next)
                          saveSettings(next)
                        }}
                        aria-label="Ollama model"
                      >
                        {ollama.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>{' '}
                      — free, private, runs on this machine (larger models give better plans)
                    </label>
                  ) : (
                    <div className="scan-hint">
                      Ollama is running but has no models yet — <code>ollama pull qwen3:8b</code>, then{' '}
                      <button className="link-btn" onClick={() => probeOllama(aiCfg.ollamaUrl).then(setOllama)}>
                        re-detect
                      </button>
                    </div>
                  )
                ) : (
                  <div className="scan-hint">
                    Couldn't reach Ollama from this page.{' '}
                    {hosted ? (
                      <>
                        Start it with this page allowed, then re-detect:{' '}
                        <code>OLLAMA_ORIGINS={window.location.origin} ollama serve</code>
                      </>
                    ) : (
                      <>
                        Install it from <a href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a> and make sure it's
                        running.
                      </>
                    )}{' '}
                    <button className="link-btn" onClick={() => probeOllama(aiCfg.ollamaUrl).then(setOllama)}>
                      Re-detect
                    </button>{' '}
                    · Remote Ollama URL? Set it in ⚙ Settings.
                  </div>
                ))}
              {keyError && <div className="scan-error">⚠ {keyError}</div>}
            </div>
          )}
          <div className="wizard-actions">
            <button className="btn btn-primary" onClick={analyze} disabled={!aiReady} title={aiReady ? undefined : 'Choose an AI above first'}>
              Analyze project (~1 min)
            </button>
            <button className="btn btn-ghost" onClick={() => setPhase('pick')}>
              Back
            </button>
            {aiReady && (
              <span className="scan-hint">
                AI: {aiCfg.provider === 'ollama' ? `${aiCfg.models.ollama} (local)` : aiCfg.models[aiCfg.provider]} — change in ⚙ Settings
              </span>
            )}
          </div>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="scan-status" role="status">
          <span className="scan-pulse" aria-hidden="true" />
          {status}
        </div>
      )}

      {(phase === 'review' || phase === 'importing') && plan && (
        <div className="wizard-review">
          <p className="plan-summary">{plan.product_summary}</p>
          <div className="wizard-events">
            {plan.events.map((e) => (
              <label className={`wizard-event${accepted.has(e.key) ? '' : ' wizard-event-off'}`} key={e.key}>
                <input
                  type="checkbox"
                  checked={accepted.has(e.key)}
                  onChange={() => {
                    const next = new Set(accepted)
                    if (next.has(e.key)) next.delete(e.key)
                    else next.add(e.key)
                    setAccepted(next)
                  }}
                />
                <span className="wizard-event-main">
                  <span className="wizard-event-title">
                    {e.label}
                    <span className={`tier-chip tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span>
                    {e.db_mapping?.table ? (
                      <span className="src-chip src-db">already in your database · {e.db_mapping.table}</span>
                    ) : (
                      <span className="src-chip src-code">needs a one-line code change</span>
                    )}
                  </span>
                  <span className="wizard-event-desc">{e.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="wizard-actions">
            {dbEvents.length > 0 ? (
              <>
                <button className="btn btn-primary" onClick={finish} disabled={phase === 'importing'}>
                  {phase === 'importing'
                    ? 'Importing your data…'
                    : `Show me my users (${dbEvents.length} event${dbEvents.length === 1 ? '' : 's'} from your database)`}
                </button>
                <label className="scan-hint">
                  last{' '}
                  <input
                    type="number"
                    className="db-days"
                    min={1}
                    max={730}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value) || 90)}
                  />{' '}
                  days
                </label>
              </>
            ) : (
              <button className="btn btn-primary" onClick={finish}>
                Save plan &amp; set up tracking
              </button>
            )}
            {codeEvents.length > 0 && dbEvents.length > 0 && (
              <span className="scan-hint">
                {codeEvents.length} more event{codeEvents.length === 1 ? '' : 's'} need instrumentation — one click after
                this, on a git branch
              </span>
            )}
          </div>
        </div>
      )}

      {error && <div className="scan-error">⚠ {error}</div>}
    </section>
  )
}
