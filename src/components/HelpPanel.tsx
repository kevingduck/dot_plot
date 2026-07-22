import { useMemo } from 'react'
import { DOC_PAGES, getDoc } from '../lib/docs'
import { renderMarkdown } from '../lib/markdown'

interface Props {
  page: string
  onNavigate: (slug: string) => void
  onClose: () => void
}

export function HelpPanel({ page, onNavigate, onClose }: Props) {
  const doc = getDoc(page) ?? DOC_PAGES[0]
  const html = useMemo(() => renderMarkdown(doc.body), [doc])

  return (
    <section className="card help">
      <div className="card-head">
        <div>
          <h2>Help</h2>
          <p className="card-sub">The full documentation, right here — no other tab needed.</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close help">
          ✕
        </button>
      </div>
      <div className="help-body">
        <nav className="help-nav" aria-label="Documentation pages">
          {DOC_PAGES.map((p) => (
            <button
              key={p.slug}
              className={`help-nav-item${p.slug === doc.slug ? ' help-nav-on' : ''}`}
              aria-current={p.slug === doc.slug ? 'page' : undefined}
              onClick={() => onNavigate(p.slug)}
            >
              {p.title}
            </button>
          ))}
        </nav>
        {/* renderMarkdown escapes all source text; only its own tags reach here */}
        <article className="help-content" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  )
}
