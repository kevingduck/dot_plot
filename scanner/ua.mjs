// Tiny user-agent classifier for /ingest: when events arrive from the end
// user's browser, the request's User-Agent tells us their OS, browser, and
// device class for free — no SDK changes, no fingerprinting libraries.
// Server-side SDKs (node/python/curl) return null: the ingest request comes
// from the app's backend, which says nothing about the end user's device.

const SERVER_RE = /node|undici|axios|got|python|curl|wget|okhttp|java|ruby|go-http|libwww|dart/i

export function parseUserAgent(ua) {
  const s = String(ua ?? '')
  if (!s || SERVER_RE.test(s)) return null

  let os = ''
  if (/iPhone|iPad|iPod/.test(s)) os = 'iOS'
  else if (/Android/.test(s)) os = 'Android'
  else if (/Windows NT/.test(s)) os = 'Windows'
  else if (/Mac OS X/.test(s)) os = 'macOS'
  else if (/CrOS/.test(s)) os = 'ChromeOS'
  else if (/Linux/.test(s)) os = 'Linux'

  let browser = ''
  if (/Edg\//.test(s)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera'
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet'
  else if (/Firefox\//.test(s)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome'
  else if (/Safari\//.test(s)) browser = 'Safari'

  let device = 'Desktop'
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'Tablet'
  else if (/iPhone|iPod/.test(s) || (/Android/.test(s) && /Mobile/.test(s)) || /Mobile Safari/.test(s)) device = 'Phone'

  if (!os && !browser) return null
  return { os, browser, device }
}
