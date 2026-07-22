import { useCallback, useEffect, useState } from 'react'
import { PROVIDERS, PROVIDER_MODELS, getSettings, saveSettings, type Provider } from '../lib/settings'
import { postJson } from '../lib/api'
import { getAppMode } from '../lib/mode'
import { isLocalUrl, probeOllama } from '../lib/ollamaClient'

interface Props {
  onClose: () => void
}

interface ServerKeys {
  anthropic: boolean
  openai: boolean
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState(getSettings)
  const [serverKeys, setServerKeys] = useState<ServerKeys | null>(null)
  const [saved, setSaved] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    postJson<{ hasServerKey: boolean; serverKeys?: ServerKeys }>('/api/keycheck', {}).then(
      (r) => setServerKeys(r.serverKeys ?? { anthropic: r.hasServerKey, openai: false }),
      () => setServerKeys(null),
    )
  }, [])

  const probe = useCallback(async (url: string) => {
    setProbing(true)
    setOllamaError(null)
    // Browser first (reaches the user's own machine), server as fallback
    // (reaches LAN/tunneled Ollama the browser may not). Exception: a hosted
    // server can NEVER reach the user's localhost — falling back there would
    // replace the real, actionable browser error with a useless one.
    const p = await probeOllama(url)
    if (p.ok) {
      setOllamaModels(p.models)
    } else if (getAppMode().hosted && isLocalUrl(url)) {
      setOllamaModels(null)
      setOllamaError(p.error ?? 'Could not reach Ollama from this page')
    } else {
      try {
        const r = await postJson<{ models?: string[] }>('/api/keytest', { provider: 'ollama', baseUrl: url })
        setOllamaModels(r.models ?? [])
      } catch (err) {
        setOllamaModels(null)
        setOllamaError(err instanceof Error ? err.message : String(err))
      }
    }
    setProbing(false)
  }, [])

  useEffect(() => {
    if (settings.provider === 'ollama' && ollamaModels === null && !probing) probe(settings.ollamaUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider])

  // Once models are known, make sure a valid one is selected
  useEffect(() => {
    if (ollamaModels && ollamaModels.length > 0 && !ollamaModels.includes(settings.models.ollama)) {
      setSettings((s) => ({ ...s, models: { ...s.models, ollama: ollamaModels[0] } }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaModels])

  const save = () => {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const provider = settings.provider
  const setModel = (id: string) => setSettings({ ...settings, models: { ...settings.models, [provider]: id } })

  return (
    <section className="card settings">
      <div className="card-head">
        <div>
          <h2>Settings</h2>
          <p className="card-sub">Which AI runs every analysis (project connect, codebase scan, instrumentation, insights).</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="settings-section">
        <div className="stat-label">AI provider</div>
        <div className="provider-row" role="radiogroup" aria-label="AI provider">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={provider === p.id}
              className={`provider-card${provider === p.id ? ' provider-on' : ''}`}
              onClick={() => setSettings({ ...settings, provider: p.id as Provider })}
            >
              <strong>{p.label}</strong>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {provider !== 'ollama' && (
        <>
          <div className="settings-section">
            <div className="stat-label">Model</div>
            {PROVIDER_MODELS[provider].map((m) => (
              <label className="settings-model" key={m.id}>
                <input type="radio" name="ai-model" checked={settings.models[provider] === m.id} onChange={() => setModel(m.id)} />
                <span>
                  <strong>{m.label}</strong>
                  <span className="settings-hint">{m.hint}</span>
                </span>
              </label>
            ))}
            {provider === 'openai' && (
              <label className="settings-hint settings-freemodel-row">
                Or any other model id:{' '}
                <input
                  type="text"
                  className="scan-path settings-freemodel"
                  placeholder="e.g. gpt-5.6"
                  value={PROVIDER_MODELS.openai.some((m) => m.id === settings.models.openai) ? '' : settings.models.openai}
                  onChange={(e) => setModel(e.target.value || PROVIDER_MODELS.openai[0].id)}
                  aria-label="Custom OpenAI model id"
                />
              </label>
            )}
          </div>

          <div className="settings-section">
            <div className="stat-label">{provider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'}</div>
            <input
              type="password"
              className="scan-path settings-key"
              placeholder={
                serverKeys?.[provider]
                  ? 'Using the server key — paste your own to override'
                  : provider === 'anthropic'
                    ? 'sk-ant-…'
                    : 'sk-…'
              }
              value={settings.keys[provider]}
              onChange={(e) => setSettings({ ...settings, keys: { ...settings.keys, [provider]: e.target.value } })}
              aria-label={`${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}
              autoComplete="off"
            />
            <div className="settings-hint">
              {serverKeys?.[provider] === false && !settings.keys[provider]
                ? 'No key found on the server — paste yours here to enable AI analysis.'
                : 'Stored only in this browser; sent to the server per request and used for that call only.'}
              {' '}
              <a className="link-btn" href="/docs/api-keys-and-models" target="_blank" rel="noreferrer">
                About providers, models &amp; cost
              </a>
            </div>
          </div>
        </>
      )}

      {provider === 'ollama' && (
        <div className="settings-section">
          <div className="stat-label">Ollama server</div>
          <div className="wizard-keyrow">
            <input
              type="text"
              className="scan-path"
              value={settings.ollamaUrl}
              onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
              aria-label="Ollama URL"
              placeholder="http://localhost:11434"
            />
            <button className="btn" onClick={() => probe(settings.ollamaUrl)} disabled={probing}>
              {probing ? 'Checking…' : 'Detect models'}
            </button>
          </div>
          {ollamaModels && ollamaModels.length > 0 && (
            <label className="settings-hint settings-ollama-model">
              Model{' '}
              <select value={settings.models.ollama} onChange={(e) => setModel(e.target.value)} aria-label="Ollama model">
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {ollamaModels && ollamaModels.length === 0 && (
            <div className="settings-hint">Ollama is running but has no models — pull one first, e.g. <code>ollama pull qwen3:8b</code></div>
          )}
          {ollamaError && <div className="scan-error">⚠ {ollamaError}</div>}
          <div className="settings-hint">
            Free and private — analysis runs on this machine and nothing is sent to a cloud AI. Local models are weaker
            than Claude on large codebases; larger models give better plans.{' '}
            <a className="link-btn" href="/docs/api-keys-and-models" target="_blank" rel="noreferrer">
              Setup help
            </a>
          </div>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </div>
    </section>
  )
}
