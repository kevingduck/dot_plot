import type { Dataset, RawEvent, User, EventType } from '../types'

// Seeded PRNG so "Sample data" renders reproducibly per seed.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Ava', 'Ben', 'Carla', 'Dev', 'Elena', 'Femi', 'Grace', 'Hugo', 'Iris', 'Jonas', 'Kira', 'Liam', 'Mei', 'Noor', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wes', 'Xena', 'Yuki', 'Zane', 'Anya', 'Bo', 'Cleo', 'Dario']
const LAST = 'ABCDEFGHJKLMNPRSTVW'

const PLATFORMS: [string, number][] = [['iOS', 0.45], ['Android', 0.3], ['Web', 0.25]]
const PLANS: [string, number][] = [['Free', 0.7], ['Pro', 0.3]]
const COUNTRIES: [string, number][] = [['US', 0.5], ['FR', 0.15], ['BR', 0.15], ['IN', 0.1], ['DE', 0.1]]

function pick<T>(rnd: () => number, weighted: [T, number][]): T {
  let r = rnd()
  for (const [v, w] of weighted) {
    r -= w
    if (r <= 0) return v
  }
  return weighted[weighted.length - 1][0]
}

type Persona = 'office' | 'weekender' | 'power' | 'one_and_done' | 'casual' | 'playlist_convert' | 'fader'

const PERSONAS: [Persona, number][] = [
  ['office', 0.22],
  ['weekender', 0.13],
  ['power', 0.1],
  ['one_and_done', 0.16],
  ['casual', 0.15],
  ['playlist_convert', 0.12],
  ['fader', 0.12],
]

export const SAMPLE_REGISTRY: EventType[] = [
  { key: 'played_song', label: 'Played song', shape: 'circle', slot: 0, core: true },
  { key: 'created_playlist', label: 'Created playlist', shape: 'square', slot: 1, core: false },
  { key: 'shared_song', label: 'Shared song', shape: 'diamond', slot: 2, core: false },
  { key: 'searched', label: 'Searched', shape: 'triangle', slot: 3, core: false },
]

const DAY = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function generateSample(seed: number, numUsers = 64, numDays = 70): Dataset {
  const rnd = mulberry32(seed * 0x9e3779b9 + 7)
  const end = startOfDay(Date.now())
  const start = end - (numDays - 1) * DAY

  const users: User[] = []
  const events: RawEvent[] = []

  for (let u = 0; u < numUsers; u++) {
    const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}.`
    const user: User = {
      id: `u_${(u + 1).toString().padStart(3, '0')}`,
      name,
      platform: pick(rnd, PLATFORMS),
      plan: pick(rnd, PLANS),
      country: pick(rnd, COUNTRIES),
    }
    users.push(user)

    const persona = pick(rnd, PERSONAS)
    // Signups scattered over the window, weighted toward earlier days so
    // cohorts have room to show retention.
    const signupDay = Math.floor(Math.pow(rnd(), 1.4) * (numDays - 3))
    // playlist_convert flips from casual to daily on this day
    const convertDay = signupDay + 3 + Math.floor(rnd() * 14)

    for (let d = signupDay; d < numDays; d++) {
      const dayTs = start + d * DAY
      const dow = new Date(dayTs).getDay()
      const weekend = dow === 0 || dow === 6
      const sinceSignup = d - signupDay

      let pActive: number
      switch (persona) {
        case 'office':
          pActive = weekend ? 0.08 : 0.82
          break
        case 'weekender':
          pActive = weekend ? 0.78 : 0.07
          break
        case 'power':
          pActive = 0.92
          break
        case 'one_and_done':
          pActive = sinceSignup === 0 ? 1 : sinceSignup === 1 ? 0.15 : 0.01
          break
        case 'casual':
          pActive = 0.16
          break
        case 'playlist_convert':
          pActive = d < convertDay ? 0.18 : 0.85
          break
        case 'fader':
          pActive = Math.max(0.02, 0.75 - sinceSignup * 0.028)
          break
      }
      if (sinceSignup === 0) pActive = 1 // everyone is active the day they sign up

      if (rnd() >= pActive) continue

      const plays = 1 + Math.floor(rnd() * (persona === 'power' ? 9 : 5))
      for (let i = 0; i < plays; i++) {
        events.push({ userId: user.id, event: 'played_song', ts: dayTs + Math.floor(rnd() * DAY) })
      }
      if (rnd() < 0.25) events.push({ userId: user.id, event: 'searched', ts: dayTs + Math.floor(rnd() * DAY) })
      if (rnd() < 0.08) events.push({ userId: user.id, event: 'shared_song', ts: dayTs + Math.floor(rnd() * DAY) })
      const isConvertDay = persona === 'playlist_convert' && d === convertDay
      if (isConvertDay || rnd() < 0.03) {
        events.push({ userId: user.id, event: 'created_playlist', ts: dayTs + Math.floor(rnd() * DAY) })
      }
    }
  }

  events.sort((a, b) => a.ts - b.ts)
  return { users, events, registry: SAMPLE_REGISTRY, source: `Sample data (seed ${seed})` }
}
