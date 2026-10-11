export interface Segment {
  text: string
  match: boolean
}

/** Splits `text` around every case-insensitive occurrence of the trimmed query. */
export function splitMatches(text: string, query: string): Segment[] {
  const q = query.trim()
  if (!q) return [{ text, match: false }]
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false })
    out.push({ text: m[0], match: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false })
  return out
}
