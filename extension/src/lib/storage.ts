import type { SortKey } from './ops'
import type { Cache, FailedBatch, Onboarding, Op, Settings, SyncState } from './types'

export interface Prefs {
  sort: SortKey
  /** Title-only rows. */
  compact: boolean
}

export type PopupTab = 'all' | 'stash'

/** Last popup view, restored the next time it opens. */
export interface PopupState {
  tab: PopupTab
  query: string
  tags: string[]
  scrollTop: number
  limit: number
  /** Expanded stash groups; the rest show only their header. */
  stashOpen: string[]
}

export interface StorageSchema {
  prefs: Prefs
  popupState: PopupState
  settings: Settings
  cache: Cache
  outbox: Op[]
  failed: FailedBatch[]
  syncState: SyncState
  onboarding: Onboarding
}

export type StorageKey = keyof StorageSchema

export const defaults: StorageSchema = {
  prefs: { sort: 'default', compact: false },
  popupState: { tab: 'all', query: '', tags: [], scrollTop: 0, limit: 0, stashOpen: [] },
  settings: { serverUrl: '', token: '' },
  cache: { version: 0, bookmarks: {}, stashes: {}, tags: {} },
  outbox: [],
  failed: [],
  syncState: { status: 'idle', attempt: 0 },
  onboarding: { completed: false, importDone: false },
}

export async function getItem<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
  const res = await chrome.storage.local.get(key)
  const stored = res[key] as StorageSchema[K] | undefined
  const def = defaults[key]
  if (stored === undefined) return def
  // Fill fields added after the value was first stored.
  if (!Array.isArray(def) && typeof stored === 'object' && stored !== null) return { ...def, ...stored }
  return stored
}

export async function setItem<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function patchItem<K extends StorageKey>(key: K, patch: Partial<StorageSchema[K]>): Promise<void> {
  const cur = await getItem(key)
  await setItem(key, { ...cur, ...patch })
}

export function isConfigured(s: Settings): boolean {
  return s.serverUrl.trim() !== '' && s.token.trim() !== ''
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}
