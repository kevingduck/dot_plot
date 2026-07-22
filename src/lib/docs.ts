// User documentation, bundled at build time from docs/*.md so the same
// pages serve local mode, hosted mode, and GitHub readers.

const raw = import.meta.glob('../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface DocPage {
  slug: string
  title: string
  body: string
}

// Reading order for the Help panel sidebar.
const ORDER = [
  'getting-started',
  'connect-your-project',
  'reading-the-grid',
  'api-keys-and-models',
  'instrumenting-your-code',
  'live-tracking',
  'csv-import',
  'self-hosting',
  'troubleshooting',
]

const bySlug = new Map<string, DocPage>()
for (const [path, body] of Object.entries(raw)) {
  const slug = path.split('/').pop()!.replace(/\.md$/, '')
  const title = body.match(/^# (.+)$/m)?.[1] ?? slug
  bySlug.set(slug, { slug, title, body })
}

export const DOC_PAGES: DocPage[] = [
  ...ORDER.filter((s) => bySlug.has(s)).map((s) => bySlug.get(s)!),
  ...[...bySlug.values()].filter((p) => !ORDER.includes(p.slug)),
]

export function getDoc(slug: string): DocPage | null {
  return bySlug.get(slug) ?? null
}
