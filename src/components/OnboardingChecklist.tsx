import { useEffect, useState } from 'react'

// First-run checklist: teaches the product's arc (demo → connect → real
// users → insights) and checks itself off from app state. Progress sticks
// across reloads; the strip disappears once dismissed or complete.

const STORE = 'dotchart:onboarding-v1'

export interface OnboardingFlags {
  demo: boolean
  connect: boolean
  users: boolean
  insights: boolean
}

interface Saved {
  dismissed: boolean
  done: Partial<OnboardingFlags>
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return JSON.parse(raw) as Saved
  } catch {
    /* fall through */
  }
  return { dismissed: false, done: {} }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    /* private mode — checklist just won't persist */
  }
}

interface Props {
  flags: OnboardingFlags
  onDemo: () => void
  onConnect: () => void
  onHelp: (slug: string) => void
}

const STEPS: { key: keyof OnboardingFlags; label: string; hint: string }[] = [
  { key: 'demo', label: 'Explore the demo', hint: 'A fictional music app — every feature works on it' },
  { key: 'connect', label: 'Connect your project', hint: 'DotChart finds your events for you' },
  { key: 'users', label: 'See your real users', hint: 'From your database, a CSV, or live tracking' },
  { key: 'insights', label: 'Find patterns', hint: '✨ in the Insights card, once real data is in' },
]

export function OnboardingChecklist({ flags, onDemo, onConnect, onHelp }: Props) {
  const [state, setState] = useState<Saved>(load)

  // Once a step is done it stays done, even if the app state moves on
  useEffect(() => {
    setState((prev) => {
      const done = { ...prev.done }
      let changed = false
      for (const step of STEPS) {
        if (flags[step.key] && !done[step.key]) {
          done[step.key] = true
          changed = true
        }
      }
      if (!changed) return prev
      const next = { ...prev, done }
      save(next)
      return next
    })
  }, [flags])

  if (state.dismissed || STEPS.every((s) => state.done[s.key])) return null

  const actions: Partial<Record<keyof OnboardingFlags, () => void>> = {
    demo: onDemo,
    connect: onConnect,
    users: () => onHelp('connect-your-project'),
    insights: () => onHelp('reading-the-grid'),
  }

  return (
    <div className="onboarding" role="region" aria-label="Getting started checklist">
      <span className="onboarding-title">Getting started</span>
      {STEPS.map((s, i) => {
        const done = Boolean(state.done[s.key])
        return (
          <button
            key={s.key}
            className={`onboarding-step${done ? ' onboarding-done' : ''}`}
            title={s.hint}
            disabled={done}
            onClick={actions[s.key]}
          >
            <span className="onboarding-mark" aria-hidden="true">
              {done ? '✓' : i + 1}
            </span>
            {s.label}
          </button>
        )
      })}
      <button
        className="btn btn-ghost onboarding-dismiss"
        aria-label="Dismiss the getting-started checklist"
        title="Dismiss"
        onClick={() => {
          const next = { ...state, dismissed: true }
          save(next)
          setState(next)
        }}
      >
        ✕
      </button>
    </div>
  )
}
