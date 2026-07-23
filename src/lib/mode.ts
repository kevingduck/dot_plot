// App mode: local dev server vs hosted (Render etc). Fetched once at boot;
// components read the cached value synchronously.

import { postJson } from './api'

export interface AppMode {
  hosted: boolean
  authRequired: boolean
  authMode?: boolean
  user?: { email: string } | null
  githubOauth?: boolean
  githubRepoAccess?: boolean
  emailEnabled?: boolean
  freeAnalyses?: number | null
  hasServerKey: boolean
  serverKeys?: { anthropic: boolean; openai: boolean }
}

let current: AppMode = { hosted: false, authRequired: false, hasServerKey: true, serverKeys: { anthropic: true, openai: false } }

export function getAppMode(): AppMode {
  return current
}

export async function fetchAppMode(): Promise<AppMode> {
  current = await postJson<AppMode>('/api/mode', {})
  return current
}

const ACCESS_KEY = 'dotchart:access-key'

export function getAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessKey(key: string) {
  localStorage.setItem(ACCESS_KEY, key)
}
