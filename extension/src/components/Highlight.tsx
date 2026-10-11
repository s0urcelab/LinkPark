import { splitMatches } from '../lib/highlight'

export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text
  return splitMatches(text, query).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : s.text))
}
