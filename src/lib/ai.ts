// AI transport chooser. Almost every AI call goes to the server, which talks
// to the configured provider. The one exception: HOSTED mode + local Ollama,
// where the server can't reach the user's localhost — so the page itself runs
// the model call (prepare → browser Ollama → finish).

import { postJson, postNdjson } from './api'
import { getAppMode } from './mode'
import { aiParams, getSettings } from './settings'
import { isLocalUrl, ollamaChat } from './ollamaClient'

/** True when AI calls must run in the browser instead of on the server. */
export function browserOllamaActive(): boolean {
  const s = getSettings()
  return getAppMode().hosted && s.provider === 'ollama' && isLocalUrl(s.ollamaUrl)
}

interface PreparedRequest {
  request: { system: string; prompt: string; schema: unknown; maxTokens: number }
  ctx: unknown
}

/**
 * Run an AI task ('connect' | 'insights') through the browser-Ollama path.
 * `payload` is the same body the server-side endpoint would take (minus the
 * ai params). Returns the same result shape as the server-side endpoint.
 */
export async function runBrowserOllamaTask<T>(task: string, payload: Record<string, unknown>, onStatus: (s: string) => void): Promise<T> {
  const s = getSettings()
  const model = s.models.ollama
  const prep = await postNdjson<PreparedRequest>('/api/ai/prepare', { task, ...payload }, onStatus)
  onStatus(`Running ${model} locally via Ollama — nothing sent to any cloud AI…`)
  let lastTick = 0
  const { text, usage } = await ollamaChat(
    { baseUrl: s.ollamaUrl, model, system: prep.request.system, prompt: prep.request.prompt, schema: prep.request.schema },
    (chars) => {
      if (chars - lastTick > 2000) {
        lastTick = chars
        onStatus(`Running ${model} locally — ${Math.round(chars / 1024)} KB drafted…`)
      }
    },
  )
  return postJson<T>('/api/ai/finish', { task, output: text, ctx: prep.ctx, model, provider: 'ollama', usage })
}

/** The ai params to attach to server-side AI request bodies. */
export { aiParams }
