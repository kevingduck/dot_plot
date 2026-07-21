// AI settings: model choice + optional user-supplied API key, persisted
// locally. Sent with each analysis request; the dev server falls back to the
// .env key when no user key is set.

export interface AiSettings {
  model: string
  apiKey: string
}

export const MODELS = [
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    hint: 'Recommended — near-Opus quality on code analysis at roughly 40% of the cost ($3 in / $15 out per M tokens)',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    hint: 'Highest quality — worth it for large or unusually tangled codebases ($5 in / $25 out per M tokens)',
  },
] as const

export const DEFAULT_MODEL = MODELS[0].id

// $ per token, used for the post-run cost readout
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3 / 1e6, output: 15 / 1e6 },
  'claude-opus-4-8': { input: 5 / 1e6, output: 25 / 1e6 },
}

export function estimateCost(model: string | undefined, usage: { input_tokens: number; output_tokens: number } | undefined): string | null {
  if (!model || !usage) return null
  const p = PRICING[model]
  if (!p) return null
  const usd = usage.input_tokens * p.input + usage.output_tokens * p.output
  return usd < 0.995 ? `${Math.max(1, Math.round(usd * 100))}¢` : `$${usd.toFixed(2)}`
}

const KEY = 'dotchart:ai-settings'

export function getSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (MODELS.some((m) => m.id === s.model)) return { model: s.model, apiKey: s.apiKey ?? '' }
    }
  } catch {
    /* fall through */
  }
  return { model: DEFAULT_MODEL, apiKey: '' }
}

export function saveSettings(s: AiSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Request-body fields every AI endpoint accepts. */
export function aiParams(): { model: string; apiKey?: string } {
  const s = getSettings()
  return { model: s.model, apiKey: s.apiKey || undefined }
}
