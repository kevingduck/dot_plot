// AI settings: provider choice (Claude / OpenAI / local Ollama), per-provider
// model + key, persisted locally. Sent with each analysis request; the server
// falls back to its own .env keys when no user key is set.

export type Provider = 'anthropic' | 'openai' | 'ollama'

export const PROVIDERS: { id: Provider; label: string; blurb: string }[] = [
  { id: 'anthropic', label: 'Claude', blurb: 'Recommended — best results on code analysis' },
  { id: 'openai', label: 'OpenAI', blurb: 'Use the OpenAI key you already have' },
  { id: 'ollama', label: 'Local (Ollama)', blurb: 'Free & private — runs on your own machine' },
]

export interface AiSettings {
  provider: Provider
  models: Record<Provider, string>
  keys: { anthropic: string; openai: string }
  ollamaUrl: string
}

export interface ModelChoice {
  id: string
  label: string
  hint: string
}

export const PROVIDER_MODELS: Record<Provider, ModelChoice[]> = {
  anthropic: [
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
  ],
  openai: [
    {
      id: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      hint: 'Recommended — balances intelligence and cost ($2.50 in / $15 out per M tokens)',
    },
    {
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      hint: 'Fast and cheap — fine for insights, weaker on big codebases ($1 in / $6 out per M tokens)',
    },
  ],
  ollama: [], // whatever the user has pulled — discovered live via /api/tags
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'anthropic',
  models: { anthropic: 'claude-sonnet-5', openai: 'gpt-5.6-terra', ollama: '' },
  keys: { anthropic: '', openai: '' },
  ollamaUrl: 'http://localhost:11434',
}

// $ per token, used for the post-run cost readout (Ollama runs are free)
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3 / 1e6, output: 15 / 1e6 },
  'claude-opus-4-8': { input: 5 / 1e6, output: 25 / 1e6 },
  'gpt-5.6': { input: 5 / 1e6, output: 30 / 1e6 },
  'gpt-5.6-sol': { input: 5 / 1e6, output: 30 / 1e6 },
  'gpt-5.6-terra': { input: 2.5 / 1e6, output: 15 / 1e6 },
  'gpt-5.6-luna': { input: 1 / 1e6, output: 6 / 1e6 },
}

export function estimateCost(model: string | undefined, usage: { input_tokens: number; output_tokens: number } | undefined): string | null {
  if (!model || !usage) return null
  const p = PRICING[model]
  if (!p) return null
  const usd = usage.input_tokens * p.input + usage.output_tokens * p.output
  return usd < 0.995 ? `${Math.max(1, Math.round(usd * 100))}¢` : `$${usd.toFixed(2)}`
}

/** "~4¢" for cloud runs, "free · local" for Ollama, null when unknowable. */
export function costLabel(meta: { model?: string; provider?: string; usage?: { input_tokens: number; output_tokens: number } } | undefined): string | null {
  if (!meta) return null
  if (meta.provider === 'ollama') return 'free · local'
  const c = estimateCost(meta.model, meta.usage)
  return c ? `~${c}` : null
}

const KEY = 'dotchart:ai-settings'

export function getSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s && PROVIDERS.some((p) => p.id === s.provider) && s.models) {
        return {
          provider: s.provider,
          models: { ...DEFAULT_SETTINGS.models, ...s.models },
          keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
          ollamaUrl: typeof s.ollamaUrl === 'string' && s.ollamaUrl ? s.ollamaUrl : DEFAULT_SETTINGS.ollamaUrl,
        }
      }
      // v1 shape: { model, apiKey } — always Anthropic
      if (s && typeof s.model === 'string') {
        return {
          ...DEFAULT_SETTINGS,
          models: { ...DEFAULT_SETTINGS.models, anthropic: s.model },
          keys: { ...DEFAULT_SETTINGS.keys, anthropic: s.apiKey ?? '' },
        }
      }
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models }, keys: { ...DEFAULT_SETTINGS.keys } }
}

export function saveSettings(s: AiSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Request-body fields every AI endpoint accepts. */
export function aiParams(): { provider: Provider; model: string; apiKey?: string; baseUrl?: string } {
  const s = getSettings()
  const model = s.models[s.provider]
  if (s.provider === 'ollama') return { provider: s.provider, model, baseUrl: s.ollamaUrl }
  return { provider: s.provider, model, apiKey: s.keys[s.provider] || undefined }
}

// ---- Recently connected projects ----

const RECENTS_KEY = 'dotchart:recent-projects'

export interface RecentProject {
  path: string
  name: string
}

export function getRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw) return (JSON.parse(raw) as RecentProject[]).filter((r) => r.path && r.name)
  } catch {
    /* fall through */
  }
  return []
}

export function addRecent(r: RecentProject) {
  const list = [r, ...getRecents().filter((x) => x.path !== r.path)].slice(0, 5)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
}
