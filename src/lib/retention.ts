import type { Dataset } from '../types'
import { firstSeenByUser } from './model'

const DAY = 86_400_000
const WEEK = 7 * DAY

export interface Cohort {
  label: string // e.g. "Wk of May 4"
  size: number
  // pct[w] = fraction of eligible cohort users active during week w since
  // their signup; NaN when no user has completed that week yet
  pct: number[]
}

function startOfWeek(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay()) // Sunday
  return d.getTime()
}

/**
 * Weekly cohort retention over the users visible in the grid. Week 0 is the
 * signup week (always 100% by construction — every user has an event on their
 * first day). A user only counts toward week w's denominator once that week
 * has fully elapsed in the data.
 */
export function buildCohorts(ds: Dataset, visibleUserIds: Set<string>, maxCohorts = 5, maxWeeks = 8): Cohort[] {
  if (ds.events.length === 0) return []
  const firstSeen = firstSeenByUser(ds)
  const dataEnd = ds.events[ds.events.length - 1].ts

  // Per-user set of active week indices since signup
  const activeWeeks = new Map<string, Set<number>>()
  for (const e of ds.events) {
    if (!visibleUserIds.has(e.userId)) continue
    const fs = firstSeen.get(e.userId)!
    const w = Math.floor((e.ts - fs) / WEEK)
    let set = activeWeeks.get(e.userId)
    if (!set) {
      set = new Set()
      activeWeeks.set(e.userId, set)
    }
    set.add(w)
  }

  const byCohort = new Map<number, string[]>()
  for (const id of activeWeeks.keys()) {
    const week = startOfWeek(firstSeen.get(id)!)
    let arr = byCohort.get(week)
    if (!arr) {
      arr = []
      byCohort.set(week, arr)
    }
    arr.push(id)
  }

  const sorted = [...byCohort.entries()].sort((a, b) => a[0] - b[0]).filter(([, ids]) => ids.length >= 3)
  const chosen = sorted.slice(-maxCohorts)

  return chosen
    .map(([weekTs, ids]) => {
      const label = `Wk of ${new Date(weekTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      // Only chart weeks the ENTIRE cohort has fully lived through — a
      // partially-elapsed tail week has a tiny denominator and produces
      // fake spikes.
      const lastFullWeek = Math.min(
        maxWeeks - 1,
        ...ids.map((id) => Math.floor((dataEnd - firstSeen.get(id)!) / WEEK) - 1),
      )
      const pct: number[] = []
      for (let w = 0; w <= lastFullWeek; w++) {
        let active = 0
        for (const id of ids) {
          if (activeWeeks.get(id)!.has(w)) active++
        }
        pct.push(active / ids.length)
      }
      return { label, size: ids.length, pct }
    })
    .filter((c) => c.pct.length >= 2)
}
