// Tiny markdown -> HTML renderer for the bundled docs pages. Covers exactly
// what docs/*.md uses (headings, paragraphs, lists, fenced code, inline
// code/bold/em/links) — not a general-purpose parser. All text is escaped;
// the only HTML emitted is what this file generates.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(s: string): string {
  let out = esc(s)
  // NUL-delimited placeholders keep code spans opaque to the bold/em/link
  // passes; NUL can't occur in the (escaped) source text
  const codes: string[] = []
  out = out.replace(/`([^`]+)`/g, (_, c: string) => '\u0000' + (codes.push('<code>' + c + '</code>') - 1) + '\u0000')
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)])
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  const isItem = (s: string) => /^[-*] /.test(s) || /^\d+\. /.test(s)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = line.match(/^(#{1,3}) (.+)$/)
    if (h) {
      const level = h[1].length
      html.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }
    if (isItem(line)) {
      const ordered = /^\d+\. /.test(line)
      const items: string[] = []
      // An item continues over following indented lines
      while (i < lines.length && (isItem(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length > 0))) {
        if (isItem(lines[i])) items.push(lines[i].replace(/^[-*] /, '').replace(/^\d+\. /, ''))
        else items[items.length - 1] += ' ' + lines[i].trim()
        i++
      }
      const tag = ordered ? 'ol' : 'ul'
      html.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    // Paragraph: consume until a blank line or a block start
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^#{1,3} /.test(lines[i]) && !isItem(lines[i])) {
      buf.push(lines[i++])
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return html.join('\n')
}
