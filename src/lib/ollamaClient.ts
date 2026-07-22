// Browser-side Ollama client. Used two ways:
//  - probing: does the user have Ollama running, and which models? (works in
//    local mode out of the box — Ollama allows localhost origins by default)
//  - transport: in HOSTED mode the server can't reach the user's localhost,
//    but this page runs ON the user's machine — so the LLM call itself runs
//    here, against http://localhost:11434. Needs the user to allow two
//    things once: Chrome's "local network" permission prompt, and
//    OLLAMA_ORIGINS=<app origin> so Ollama accepts our origin.

export interface OllamaProbe {
  ok: boolean
  models: string[]
  error?: string
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url.trim())
}

/**
 * Can this page reach the given Ollama? Never throws. The generous timeout
 * matters: on a hosted page, Chrome's local-network permission prompt blocks
 * the fetch until the user answers — aborting early would kill the prompt.
 */
export async function probeOllama(baseUrl: string): Promise<OllamaProbe> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, models: [], error: `Ollama returned ${res.status}` }
    const data = await res.json()
    const models = ((data.models ?? []) as { name?: string }[]).map((m) => m.name ?? '').filter(Boolean)
    return { ok: true, models }
  } catch {
    return {
      ok: false,
      models: [],
      error: `Couldn't reach Ollama from this page — check it's running, and that OLLAMA_ORIGINS includes ${window.location.origin}`,
    }
  }
}

/**
 * One structured chat call, straight from the browser. Returns the raw
 * response text (JSON per the schema — the server's /api/ai/finish parses
 * and post-processes it).
 */
export async function ollamaChat(
  { baseUrl, model, system, prompt, schema }: { baseUrl: string; model: string; system: string; prompt: string; schema: unknown },
  onProgress: (chars: number) => void,
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        format: schema,
        options: { num_ctx: 32768, temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })
  } catch {
    throw new Error(`Couldn't reach Ollama at ${base} from this page — is it running, with OLLAMA_ORIGINS=${window.location.origin}?`)
  }
  if (!res.ok || !res.body) {
    let msg = `Ollama returned ${res.status}`
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* keep the status message */
    }
    throw new Error(msg)
  }

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
      let chunk: { error?: string; message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number }
      try {
        chunk = JSON.parse(line)
      } catch {
        continue
      }
      if (chunk.error) throw new Error(chunk.error)
      if (chunk.message?.content) {
        text += chunk.message.content
        onProgress(text.length)
      }
      if (chunk.done) usage = { input_tokens: chunk.prompt_eval_count ?? 0, output_tokens: chunk.eval_count ?? 0 }
    }
  }
  return { text, usage }
}
