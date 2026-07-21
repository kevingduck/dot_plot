import { useEffect, useState } from 'react'
import { MODELS, getSettings, saveSettings } from '../lib/settings'
import { postJson } from '../lib/api'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState(getSettings)
  const [hasServerKey, setHasServerKey] = useState<boolean | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    postJson<{ hasServerKey: boolean }>('/api/keycheck', {}).then(
      (r) => setHasServerKey(r.hasServerKey),
      () => setHasServerKey(null),
    )
  }, [])

  const save = () => {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="card settings">
      <div className="card-head">
        <div>
          <h2>Settings</h2>
          <p className="card-sub">Applies to every AI analysis (project connect, codebase scan, instrumentation).</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="settings-section">
        <div className="stat-label">Model</div>
        {MODELS.map((m) => (
          <label className="settings-model" key={m.id}>
            <input
              type="radio"
              name="ai-model"
              checked={settings.model === m.id}
              onChange={() => setSettings({ ...settings, model: m.id })}
            />
            <span>
              <strong>{m.label}</strong>
              <span className="settings-hint">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="settings-section">
        <div className="stat-label">Anthropic API key</div>
        <input
          type="password"
          className="scan-path settings-key"
          placeholder={hasServerKey ? 'Using the server key from .env — paste your own to override' : 'sk-ant-…'}
          value={settings.apiKey}
          onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
          aria-label="Anthropic API key"
          autoComplete="off"
        />
        <div className="settings-hint">
          {hasServerKey === false && !settings.apiKey
            ? 'No key found on the server — paste yours here to enable AI analysis.'
            : 'Stored only in this browser; sent to the local dev server per request and used for that call only.'}
        </div>
      </div>

      <div className="wizard-actions">
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </div>
    </section>
  )
}
