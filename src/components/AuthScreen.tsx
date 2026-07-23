import { useState } from 'react'
import { postJson } from '../lib/api'
import { ShapeIcon } from './ShapeIcon'

interface Props {
  githubOauth: boolean
  emailEnabled: boolean
  accentColor: string
  onDemo: () => void
}

type Mode = 'login' | 'signup' | 'forgot' | 'reset'

/** Full-page front door: pitch + login/signup/reset, shown when accounts are enabled and no session exists. */
export function AuthScreen({ githubOauth, emailEnabled, accentColor, onDemo }: Props) {
  const resetToken = new URLSearchParams(window.location.search).get('reset_token')
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = (m: Mode) => {
    setMode(m)
    setError(null)
    setNotice(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'forgot') {
        await postJson('/api/auth/forgot', { email })
        setNotice('If that email has an account, a reset link is on its way (valid for 1 hour).')
      } else if (mode === 'reset') {
        await postJson('/api/auth/reset', { token: resetToken, password })
        window.location.href = '/' // logged in by the reset — drop the token from the URL
        return
      } else {
        await postJson(`/api/auth/${mode}`, { email, password })
        window.location.reload()
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <div className="app lock-screen">
      <section className="card lock-card auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShapeIcon shape="circle" color={accentColor} size={14} />
          </span>
          <span className="brand-name">DotChart</span>
          <span className="brand-tag">see what your users are actually doing</span>
        </div>

        {(mode === 'login' || mode === 'signup') && (
          <ul className="auth-pitch">
            <li>Every row is a user, every column is a day — churners, streaks, and power users become visible.</li>
            <li>AI reads your codebase and proposes the events worth tracking; events already in your database chart instantly, zero code changes.</li>
            <li>The rest lands as a reviewed git branch — merge it, set one env var, watch events flow in live.</li>
          </ul>
        )}

        <p className="card-sub">
          {mode === 'login' && 'Log in to see your projects.'}
          {mode === 'signup' && 'Create an account — your projects and data are yours alone.'}
          {mode === 'forgot' && 'Enter your email and we’ll send a reset link.'}
          {mode === 'reset' && 'Choose a new password.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {mode !== 'reset' && (
            <input
              type="email"
              className="scan-path"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
              autoComplete="email"
              autoFocus
            />
          )}
          {mode !== 'forgot' && (
            <input
              type="password"
              className="scan-path"
              placeholder={mode === 'login' ? 'Password' : 'Password (8+ characters)'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || (mode !== 'reset' && !email) || (mode !== 'forgot' && !password)}>
            {busy
              ? '…'
              : mode === 'login'
                ? 'Log in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Set new password'}
          </button>
        </form>

        {githubOauth && (mode === 'login' || mode === 'signup') && (
          <a className="btn auth-github" href="/api/auth/github">
            Continue with GitHub
          </a>
        )}
        {notice && <div className="scan-hint">{notice}</div>}
        {error && <div className="scan-error">⚠ {error}</div>}

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button className="link-btn" onClick={() => go('signup')}>
                New here? Create an account
              </button>
              {emailEnabled && (
                <button className="link-btn" onClick={() => go('forgot')}>
                  Forgot password?
                </button>
              )}
            </>
          )}
          {mode !== 'login' && (
            <button className="link-btn" onClick={() => go('login')}>
              Back to log in
            </button>
          )}
        </div>

        <div className="scan-divider" />
        <div className="auth-demo">
          <button className="btn" onClick={onDemo}>
            Explore the live demo — no account needed
          </button>
          <a className="link-btn" href="/docs" target="_blank" rel="noreferrer">
            Read the docs
          </a>
        </div>
      </section>
    </div>
  )
}
