/**
 * Fractional-index keys for manual ordering: a new key can always be generated between
 * two existing ones, so moving an item only rewrites that item. Keys compare as plain
 * strings (never localeCompare) and never end with the lowest digit, which keeps the
 * space between any two keys non-empty.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b !== null && b.length > 1) return b[0]
  return DIGITS[da] + midpoint(a.slice(1), null)
}

/** A key strictly between a and b; null/undefined means "no bound on that side". */
export function rankBetween(a?: string | null, b?: string | null): string {
  const lo = a ?? ''
  const hi = b ?? null
  // Two devices can produce the same key; fall back to "after a" rather than throwing.
  if (hi !== null && lo >= hi) return midpoint(lo, null)
  return midpoint(lo, hi)
}

/** n evenly spaced keys after `after`, short enough for bulk inserts such as imports. */
export function rankSequence(after: string | null | undefined, n: number): string[] {
  const prefix = after ? midpoint(after, null) : ''
  let width = 1
  while (DIGITS.length ** width < n + 1) width++
  const space = DIGITS.length ** width
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    let v = Math.floor(((i + 1) * space) / (n + 1))
    let s = ''
    for (let d = 0; d < width; d++) {
      s = DIGITS[v % DIGITS.length] + s
      v = Math.floor(v / DIGITS.length)
    }
    out.push(prefix + s.replace(/0+$/, ''))
  }
  return out
}

export function compareRank(a: { rank: string; id: string }, b: { rank: string; id: string }): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
