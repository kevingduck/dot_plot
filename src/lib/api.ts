// Client helpers for the dev-server endpoints.

/** POST returning plain JSON; throws on HTTP error or an {error} payload. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }))
  if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

/**
 * POST to an NDJSON streaming endpoint: {status} lines invoke onStatus, a
 * final {done, result|plan} resolves, {error} rejects.
 */
export async function postNdjson<T>(url: string, body: unknown, onStatus: (s: string) => void): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.body) throw new Error(`Request failed (${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: T | undefined
  let finished = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.status) onStatus(msg.status)
      if (msg.error) throw new Error(msg.error)
      if (msg.done) {
        result = (msg.result ?? msg.plan) as T
        finished = true
      }
    }
  }
  if (!finished || result === undefined) throw new Error('Stream ended unexpectedly — check the dev-server log')
  return result
}
