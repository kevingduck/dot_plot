// DotChart accounts (DOTCHART_AUTH=1): email+password (scrypt) with optional
// GitHub OAuth, HMAC-signed session cookies, per-user data namespaces, and
// the ingest-token → project index. File-backed like everything else:
//
//   ~/.dotchart/auth/users.json     [{id, email, salt, hash, github_id, created_at}]
//   ~/.dotchart/auth/secret         session-signing secret (auto-generated)
//   ~/.dotchart/users/<id>/         per-user projects/ + per-project event files

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT } from './store.mjs'

const AUTH_DIR = path.join(DATA_ROOT, 'auth')
const USERS_FILE = path.join(AUTH_DIR, 'users.json')
const SESSION_DAYS = 30
export const COOKIE = 'dotchart_session'

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeUsers(users) {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

function secret() {
  if (process.env.DOTCHART_SECRET) return process.env.DOTCHART_SECRET
  const file = path.join(AUTH_DIR, 'secret')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    const s = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(AUTH_DIR, { recursive: true })
    fs.writeFileSync(file, s, { mode: 0o600 })
    return s
  }
}

const normEmail = (e) => String(e ?? '').trim().toLowerCase()

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

/** Per-user data namespace; all project + event files live under it. */
export function userRoot(userId) {
  return path.join(DATA_ROOT, 'users', String(userId))
}

export function userProjectsDir(userId) {
  return path.join(userRoot(userId), 'projects')
}

/** A project's own event stream file (account mode). */
export function projectEventsFile(userId, slug) {
  return path.join(userRoot(userId), `events-${slug}.jsonl`)
}

export function signup(email, password) {
  const em = normEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new Error('Enter a valid email address')
  if (String(password ?? '').length < 8) throw new Error('Password must be at least 8 characters')
  const users = readUsers()
  if (users.some((u) => u.email === em)) throw new Error('An account with this email already exists — log in instead')
  const salt = crypto.randomBytes(16).toString('hex')
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    email: em,
    salt,
    hash: hashPassword(String(password), salt),
    created_at: Date.now(),
  }
  users.push(user)
  writeUsers(users)
  adoptLegacyData(user, users.length)
  return { id: user.id, email: user.email }
}

export function login(email, password) {
  const em = normEmail(email)
  const user = readUsers().find((u) => u.email === em)
  // Constant-shape failure: never reveal whether the email exists
  const salt = user?.salt ?? crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(String(password ?? ''), salt)
  if (!user?.hash || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.hash))) {
    throw new Error('Wrong email or password')
  }
  return { id: user.id, email: user.email }
}

/** Find-or-create an account from a GitHub identity. */
export function githubLogin(ghId, email) {
  const users = readUsers()
  let user = users.find((u) => u.github_id === ghId) ?? (email ? users.find((u) => u.email === normEmail(email)) : null)
  if (user) {
    if (!user.github_id) {
      user.github_id = ghId
      writeUsers(users)
    }
  } else {
    user = { id: crypto.randomBytes(8).toString('hex'), email: normEmail(email) || `github:${ghId}`, github_id: ghId, created_at: Date.now() }
    users.push(user)
    writeUsers(users)
    adoptLegacyData(user, users.length)
  }
  return { id: user.id, email: user.email }
}

/**
 * The very first account adopts the pre-accounts data (legacy shared store +
 * workspaces) so enabling DOTCHART_AUTH on an existing deployment loses
 * nothing. Safe because until auth is enabled the instance is single-user
 * (typically behind DOTCHART_PASSWORD), and the operator signs up first.
 */
function adoptLegacyData(user, userCount) {
  if (userCount !== 1) return
  try {
    const legacyProjects = path.join(DATA_ROOT, 'projects')
    const dest = userProjectsDir(user.id)
    if (fs.existsSync(legacyProjects) && !fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(legacyProjects, dest, { recursive: true })
    }
    // Legacy shared events land in a catch-all stream the user's projects
    // read through the same scoping as before
    const legacyEvents = path.join(DATA_ROOT, 'events.jsonl')
    const destEvents = path.join(userRoot(user.id), 'events-legacy.jsonl')
    if (fs.existsSync(legacyEvents) && !fs.existsSync(destEvents)) {
      fs.mkdirSync(path.dirname(destEvents), { recursive: true })
      fs.copyFileSync(legacyEvents, destEvents)
    }
    console.log(`[dotchart] first account ${user.email} adopted the pre-accounts workspaces + events (copies; originals untouched)`)
  } catch (err) {
    console.error('[dotchart] legacy adoption failed (continuing):', err.message)
  }
}

// ---- free analyses (DOTCHART_FREE_ANALYSES) ----
// Non-owner accounts may run N analyses on the server's API key before
// bringing their own. Peek with freeAnalysesLeft, burn with consumeFree.

export function freeAnalysesLeft(userId, limit) {
  if (!limit) return 0
  const user = readUsers().find((u) => u.id === userId)
  return user ? Math.max(0, limit - (user.free_used ?? 0)) : 0
}

export function consumeFreeAnalysis(userId, limit) {
  const users = readUsers()
  const user = users.find((u) => u.id === userId)
  if (!user) return false
  if ((user.free_used ?? 0) >= limit) return false
  user.free_used = (user.free_used ?? 0) + 1
  writeUsers(users)
  return true
}

// ---- GitHub repo access token (OAuth `repo` scope, encrypted at rest) ----

function encryptToken(text) {
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(secret()).digest()
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return [iv.toString('hex'), c.getAuthTag().toString('hex'), enc.toString('hex')].join('.')
}

function decryptToken(blob) {
  try {
    const [iv, tag, data] = String(blob).split('.')
    const key = crypto.createHash('sha256').update(secret()).digest()
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
    d.setAuthTag(Buffer.from(tag, 'hex'))
    return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function saveGithubToken(userId, token) {
  const users = readUsers()
  const user = users.find((u) => u.id === userId)
  if (!user) return
  user.github_token_enc = encryptToken(token)
  writeUsers(users)
}

export function getGithubToken(userId) {
  const user = readUsers().find((u) => u.id === userId)
  return user?.github_token_enc ? decryptToken(user.github_token_enc) : null
}

/** Attach a GitHub identity (and optionally its token) to an EXISTING logged-in account. */
export function linkGithub(userId, ghId, token) {
  const users = readUsers()
  const user = users.find((u) => u.id === userId)
  if (!user) return
  user.github_id = ghId
  if (token) user.github_token_enc = encryptToken(token)
  writeUsers(users)
}

// ---- password reset ----
// Email delivery via Resend (RESEND_API_KEY + optional RESEND_FROM). The
// reset link carries an HMAC-signed one-hour token bound to the user's
// current hash, so it self-invalidates once used.

export function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY)
}

function resetSig(user, exp) {
  return sign(`reset.${user.id}.${exp}.${user.hash ?? 'github'}`)
}

export async function requestPasswordReset(email, origin) {
  if (!emailEnabled()) {
    throw new Error("Password reset email isn't set up on this DotChart — ask the operator to reset your password")
  }
  const user = readUsers().find((u) => u.email === normEmail(email))
  if (!user) return // silent: never reveal whether an email exists
  const exp = Date.now() + 3600_000
  const token = `${user.id}.${exp}.${resetSig(user, exp)}`
  const link = `${origin}/?reset_token=${encodeURIComponent(token)}`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'DotChart <onboarding@resend.dev>',
      to: [user.email],
      subject: 'Reset your DotChart password',
      text: `Someone (hopefully you) asked to reset the DotChart password for ${user.email}.\n\nReset it here (link valid for 1 hour):\n${link}\n\nIf this wasn't you, ignore this email — nothing changes.`,
    }),
  })
  if (!res.ok) throw new Error(`Could not send the reset email (${res.status}) — try again or contact the operator`)
}

export function resetPassword(token, newPassword) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) throw new Error('Invalid reset link')
  const [uid, exp, sig] = parts
  const users = readUsers()
  const user = users.find((u) => u.id === uid)
  const expected = user ? resetSig(user, exp) : ''
  if (!user || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid or already-used reset link — request a new one')
  }
  if (Number(exp) < Date.now()) throw new Error('This reset link has expired — request a new one')
  if (String(newPassword ?? '').length < 8) throw new Error('Password must be at least 8 characters')
  user.salt = crypto.randomBytes(16).toString('hex')
  user.hash = hashPassword(String(newPassword), user.salt)
  writeUsers(users)
  return { id: user.id, email: user.email }
}

/** Operator escape hatch (run on the server): node scanner/reset-password.mjs email newpass */
export function adminSetPassword(email, newPassword) {
  const users = readUsers()
  const user = users.find((u) => u.email === normEmail(email))
  if (!user) throw new Error(`No account with email ${email}`)
  if (String(newPassword ?? '').length < 8) throw new Error('Password must be at least 8 characters')
  user.salt = crypto.randomBytes(16).toString('hex')
  user.hash = hashPassword(String(newPassword), user.salt)
  writeUsers(users)
  return user.email
}

/** Oldest account — receives tokenless legacy /ingest traffic in account mode. */
export function firstUserId() {
  const users = readUsers()
  return users.length ? users.reduce((a, b) => (a.created_at <= b.created_at ? a : b)).id : null
}

// ---- sessions ----

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function sessionCookie(userId) {
  const exp = Date.now() + SESSION_DAYS * 86400_000
  const payload = `${userId}.${exp}`
  const value = `${payload}.${sign(payload)}`
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/** Cookie header → {id, email} or null. */
export function sessionUser(cookieHeader) {
  const m = String(cookieHeader ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  const [uid, exp, sig] = parts
  const payload = `${uid}.${exp}`
  const expected = sign(payload)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  if (Number(exp) < Date.now()) return null
  const user = readUsers().find((u) => u.id === uid)
  return user ? { id: user.id, email: user.email } : null
}

// ---- ingest token → project lookup ----

/**
 * Resolve an ingest token to its owner + project by scanning user workspace
 * files. Cached with a short TTL: token lookups happen on every ingest POST,
 * project saves happen rarely.
 */
let tokenCache = { at: 0, map: new Map() }

export function resolveIngestToken(token) {
  if (!/^[a-f0-9]{16,64}$/.test(String(token ?? ''))) return null
  if (Date.now() - tokenCache.at > 30_000) {
    const map = new Map()
    const usersDir = path.join(DATA_ROOT, 'users')
    let uids = []
    try {
      uids = fs.readdirSync(usersDir)
    } catch {
      /* no accounts yet */
    }
    for (const uid of uids) {
      let files = []
      try {
        files = fs.readdirSync(path.join(usersDir, uid, 'projects')).filter((f) => f.endsWith('.json'))
      } catch {
        continue
      }
      for (const f of files) {
        try {
          const ws = JSON.parse(fs.readFileSync(path.join(usersDir, uid, 'projects', f), 'utf8'))
          if (ws.ingest_token) map.set(ws.ingest_token, { userId: uid, slug: ws.slug ?? f.replace(/\.json$/, '') })
        } catch {
          /* skip corrupt file */
        }
      }
    }
    tokenCache = { at: Date.now(), map }
  }
  return tokenCache.map.get(token) ?? null
}

export function invalidateTokenCache() {
  tokenCache.at = 0
}
