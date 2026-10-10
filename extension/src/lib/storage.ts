import type { Cache, FailedBatch, Onboarding, Op, Settings, SyncState } from './types'

export interface StorageSchema {
  settings: Settings
  cache: Cache
  outbox: Op[]
  failed: FailedBatch[]
  syncState: SyncState
  onboarding: Onboarding
}

export type StorageKey = keyof StorageSchema

export const defaults: StorageSchema = {
  settings: { serverUrl: '', token: '' },
  cache: { version: 0, bookmarks: {} },
  outbox: [],
  failed: [],
  syncState: { status: 'idle', attempt: 0 },
  onboarding: { completed: false, importDone: false },
}

export async function getItem<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
  const res = await chrome.storage.local.get(key)
  return (res[key] as StorageSchema[K] | undefined) ?? defaults[key]
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
