// Provider-agnostic LLM layer: every AI feature (connect, scan, instrument,
// insights) makes exactly one kind of call — system + user prompt in,
// schema-validated JSON out, with streamed progress. This file speaks that
// contract to three backends:
//
//   anthropic — @anthropic-ai/sdk, streaming + adaptive thinking + json_schema
//   openai    — plain fetch to /v1/chat/completions, strict structured outputs
//   ollama    — plain fetch to {baseUrl}/api/chat (local or tunneled), schema
//               via the `format` parameter, no API key
//
// Keys: user-supplied per request, else the server's .env / environment
// (ANTHROPIC_API_KEY, OPENAI_API_KEY). Ollama needs a reachable URL instead.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

export const PROVIDERS = ['anthropic', 'openai', 'ollama']

export const DEFAULTS = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra',
  ollama: '', // must be chosen — depends on what the user has pulled
}

// Anthropic models stay allowlisted (a server key could otherwise be pointed
// at arbitrarily expensive models); OpenAI/Ollama accept any sane model id
// so users aren't stuck waiting for us to whitelist new releases.
export const ANTHROPIC_MODELS = ['claude-sonnet-5', 'claude-opus-4-8']
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,79}$/

// Local models get a smaller code digest: a 400 KB prompt blows most local
// context windows. num_ctx below must comfortably hold this.
export const OLLAMA_PROMPT_LIMIT = 100_000
const OLLAMA_NUM_CTX = 32768

function envKey(name) {
  if (process.env[name]) return process.env[name]
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const m = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))
    if (m) return m[1].trim()
  } catch {
    /* no .env */
  }
  return null
}

export function serverKeys() {
  return { anthropic: envKey('ANTHROPIC_API_KEY') !== null, openai: envKey('OPENAI_API_KEY') !== null }
}

/** Back-compat: "does the server have a key" for the default provider. */
export function hasServerKey() {
  return serverKeys().anthropic
}

function normalizeBaseUrl(raw) {
  const url = String(raw || 'http://localhost:11434').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`Not a valid Ollama URL: ${url}`)
  return url
}

/**
 * Resolve request-supplied AI params ({provider, model, apiKey, baseUrl})
 * into a validated config, falling back to server keys and defaults.
 * Throws with a settings-pointing message when no usable auth exists.
 */
export function resolveAi({ provider, model, apiKey, baseUrl } = {}) {
  const p = PROVIDERS.includes(provider) ? provider : 'anthropic'
  let m = typeof model === 'string' && MODEL_RE.test(model.trim()) ? model.trim() : ''

  if (p === 'anthropic') {
    if (!ANTHROPIC_MODELS.includes(m)) m = DEFAULTS.anthropic
    const key = apiKey || envKey('ANTHROPIC_API_KEY')
    if (!key) throw new Error('No Anthropic API key — add yours in ⚙ Settings, or set ANTHROPIC_API_KEY on the server')
    return { provider: p, model: m, apiKey: key }
  }
  if (p === 'openai') {
    if (!m) m = DEFAULTS.openai
    const key = apiKey || envKey('OPENAI_API_KEY')
    if (!key) throw new Error('No OpenAI API key — add yours in ⚙ Settings, or set OPENAI_API_KEY on the server')
    return { provider: p, model: m, apiKey: key }
  }
  // ollama
  if (!m) throw new Error('Pick an Ollama model in ⚙ Settings (whatever `ollama list` shows)')
  return { provider: p, model: m, baseUrl: normalizeBaseUrl(baseUrl) }
}

/** Human label for status lines and plan metadata. */
export function aiLabel(ai) {
  return ai.provider === 'ollama' ? `${ai.model} (local via Ollama)` : ai.model
}

/**
 * OpenAI strict mode requires every object to list ALL its properties as
 * required. Our schemas already use additionalProperties:false everywhere;
 * this fills in the required arrays on a deep copy.
 */
export function strictify(schema) {
  const clone = JSON.parse(JSON.stringify(schema))
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object' && node.properties) {
      node.required = Object.keys(node.properties)
      node.additionalProperties = false
      for (const v of Object.values(node.properties)) walk(v)
    }
    if (node.type === 'array' && node.items) walk(node.items)
  }
  walk(clone)
  return clone
}

function parseJson(text, ai) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `${aiLabel(ai)} did not return valid JSON${ai.provider === 'ollama' ? ' — smaller local models sometimes fail at structured output; try a larger model or a cloud provider' : ''}`,
    )
  }
}

// ---- backends ----

async function runAnthropic(ai, { system, prompt, schema, maxTokens, onStatus, onText }) {
  const client = new Anthropic({ apiKey: ai.apiKey })
  const stream = client.messages.stream({
    model: ai.model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  })
  let announced = false
  stream.on('streamEvent', (event) => {
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking' && !announced) {
      announced = true
      onStatus('The model is reading and planning…')
    }
  })
  stream.on('text', (_, snapshot) => onText(snapshot))
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('Model declined the request')
  if (message.stop_reason === 'max_tokens') throw new Error('Response truncated (max_tokens) — try a smaller codebase')
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return {
    object: parseJson(text, ai),
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  }
}

async function runOpenai(ai, { system, prompt, schema, maxTokens, onText }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${ai.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'dotchart_output', strict: true, schema: strictify(schema) },
      },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    let msg = `OpenAI returned ${res.status}`
    try {
      msg = (await res.json()).error?.message ?? msg
    } catch {
      /* keep the status message */
    }
    throw new Error(msg)
  }

  // SSE: `data: {json}` lines, terminated by `data: [DONE]`
  let text = ''
  let usage = null
  let finish = null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let chunk
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        text += delta
        onText(text)
      }
      if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason
      if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 }
    }
  }
  if (finish === 'length') throw new Error('Response truncated (max tokens) — try a smaller codebase')
  if (finish === 'content_filter') throw new Error('Model declined the request')
  return { object: parseJson(text, ai), usage: usage ?? { input_tokens: 0, output_tokens: 0 } }
}

async function runOllama(ai, { system, prompt, schema, onStatus, onText }) {
  let userPrompt = prompt
  if (userPrompt.length > OLLAMA_PROMPT_LIMIT) {
    userPrompt = userPrompt.slice(0, OLLAMA_PROMPT_LIMIT) + '\n… [input truncated to fit the local model context]'
    onStatus(`Trimmed the input to ~${Math.round(OLLAMA_PROMPT_LIMIT / 1024)} KB for the local model`)
  }
  let res
  try {
    res = await fetch(`${ai.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ai.model,
        stream: true,
        format: schema,
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
  } catch {
    throw new Error(`Could not reach Ollama at ${ai.baseUrl} — is \`ollama serve\` running?`)
  }
  if (!res.ok) {
    let msg = `Ollama returned ${res.status}`
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* keep the status message */
    }
    if (/not found/i.test(msg)) msg = `${msg} — pull it first with \`ollama pull ${ai.model}\``
    throw new Error(msg)
  }

  // NDJSON stream: {message:{content}, done, prompt_eval_count, eval_count}
  let text = ''
  let usage = { input_tokens: 0, output_tokens: 0 }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let chunk
      try {
        chunk = JSON.parse(line)
      } catch {
        continue
      }
      if (chunk.error) throw new Error(String(chunk.error))
      if (chunk.message?.content) {
        text += chunk.message.content
        onText(text)
      }
      if (chunk.done) {
        usage = { input_tokens: chunk.prompt_eval_count ?? 0, output_tokens: chunk.eval_count ?? 0 }
      }
    }
  }
  return { object: parseJson(text, ai), usage }
}

/**
 * One structured LLM call. `onText` receives the cumulative output text as it
 * streams (for drafted-count progress); `onStatus` gets human status lines.
 * Returns { object, usage } with the schema-shaped result.
 */
export async function runStructured(ai, { system, prompt, schema, maxTokens = 32000, onStatus = () => {}, onText = () => {} }) {
  if (ai.provider === 'openai') return runOpenai(ai, { system, prompt, schema, maxTokens, onText })
  if (ai.provider === 'ollama') return runOllama(ai, { system, prompt, schema, onStatus, onText })
  return runAnthropic(ai, { system, prompt, schema, maxTokens, onStatus, onText })
}

/** Validate a provider config without a paid call. Returns extra info per provider. */
export async function testProvider({ provider, apiKey, baseUrl }) {
  if (provider === 'openai') {
    const key = String(apiKey ?? '').trim()
    if (!key.startsWith('sk-')) throw new Error("That doesn't look like an OpenAI API key — they start with sk-")
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } })
    if (res.status === 401 || res.status === 403) throw new Error('OpenAI rejected this key — copy it again from platform.openai.com')
    if (!res.ok) throw new Error(`Could not verify the key (OpenAI returned ${res.status}) — try again`)
    return { ok: true }
  }
  if (provider === 'ollama') {
    const base = normalizeBaseUrl(baseUrl)
    let res
    try {
      res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) })
    } catch {
      throw new Error(`Could not reach Ollama at ${base} — is \`ollama serve\` running there?`)
    }
    if (!res.ok) throw new Error(`Ollama at ${base} returned ${res.status}`)
    const data = await res.json()
    const models = (data.models ?? []).map((m) => m.name).filter(Boolean)
    return { ok: true, models }
  }
  // anthropic
  const key = String(apiKey ?? '').trim()
  if (!key.startsWith('sk-ant-')) throw new Error("That doesn't look like an Anthropic API key — they start with sk-ant-")
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  })
  if (res.status === 401 || res.status === 403) throw new Error('Anthropic rejected this key — copy it again from console.anthropic.com')
  if (!res.ok) throw new Error(`Could not verify the key (Anthropic returned ${res.status}) — try again`)
  return { ok: true }
}
