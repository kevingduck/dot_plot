import { useState } from 'react'
import { postJson } from '../lib/api'
import { ShapeIcon } from './ShapeIcon'

interface Props {
  githubOauth: boolean
  accentColor: string
}

/** Full-page login/signup gate shown when accounts are enabled and no session exists. */
export function AuthScreen({ githubOauth, accentColor }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await postJson(`/api/auth/${mode}`, { email, password })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="app lock-screen">
      <section className="card lock-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShapeIcon shape="circle" color={accentColor} size={14} />
          </span>
          <span className="brand-name">DotChart</span>
          <span className="brand-tag">see what your users are actually doing</span>
        </div>
        <p className="card-sub">
          {mode === 'login' ? 'Log in to see your projects.' : 'Create an account — your projects and data are yours alone.'}
        </p>
        <form className="auth-form" onSubmit={submit}>
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
          <input
            type="password"
            className="scan-path"
            placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
            {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        {githubOauth && (
          <a className="btn auth-github" href="/api/auth/github">
            Continue with GitHub
          </a>
        )}
        {error && <div className="scan-error">⚠ {error}</div>}
        <button className="link-btn auth-toggle" onClick={() => (setMode(mode === 'login' ? 'signup' : 'login'), setError(null))}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
      </section>
    </div>
  )
}
