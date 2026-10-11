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
