import type { Stash, StashItem } from './types'

/** Reading other tabs' URLs needs "tabs"; it's optional so installs don't warn about history access. */
export const TABS_PERMISSION: chrome.permissions.Permissions = { permissions: ['tabs'] }

export function stashItemsFromTabs(tabs: { url?: string; title?: string }[]): StashItem[] {
  return tabs
    .filter((t): t is { url: string; title?: string } => !!t.url && /^https?:\/\//i.test(t.url))
    .map((t) => ({ url: t.url, title: (t.title || t.url).trim() }))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Default name of a new group, e.g. "2026-10-11 22:39". */
export function defaultStashName(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function stashLabel(s: Stash): string {
  return s.name || new Date(s.created_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export interface StashMatch {
  stash: Stash
  /** Indices into `stash.items` to show, in order. */
  hits: number[]
}

/**
 * Groups with items whose title or URL contains the query. A group whose name matches
 * keeps all of its items, since the user is looking for that group.
 */
export function filterStashes(stashes: Stash[], query: string): StashMatch[] {
  const q = query.trim().toLowerCase()
  const all = (s: Stash) => s.items.map((_, i) => i)
  if (!q) return stashes.map((stash) => ({ stash, hits: all(stash) }))
  const out: StashMatch[] = []
  for (const stash of stashes) {
    if (stashLabel(stash).toLowerCase().includes(q)) {
      out.push({ stash, hits: all(stash) })
      continue
    }
    const hits = all(stash).filter((i) => {
      const it = stash.items[i]
      return it.title.toLowerCase().includes(q) || it.url.toLowerCase().includes(q)
    })
    if (hits.length) out.push({ stash, hits })
  }
  return out
}
