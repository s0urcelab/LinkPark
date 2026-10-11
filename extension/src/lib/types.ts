export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string
  tags: string[]
  /** Place in the single global order (fractional-index key, plain string comparison). */
  rank: string
  created_at: number
  updated_at: number
  deleted_at?: number | null
  version?: number
}

/**
 * Order and pin state of a tag. The name is matched case-insensitively; the empty name
 * is the virtual "未分类" tag holding every bookmark without tags.
 */
export interface TagMeta {
  name: string
  /** Empty means unranked: sorted after every ranked tag. */
  rank: string
  pinned: boolean
}

export interface StashItem {
  url: string
  title: string
}

/** One batch of tabs saved together, in tab order. */
export interface Stash {
  id: string
  name: string
  items: StashItem[]
  created_at: number
  updated_at: number
  deleted_at?: number | null
  version?: number
}

export type Entity = 'bookmark' | 'tag' | 'stash'
export type OpType = 'create' | 'update' | 'delete'

export interface CreatePayload {
  url: string
  title: string
  favicon: string
  tags: string[]
  rank: string
  created_at: number
}

export interface UpdatePayload {
  url?: string
  title?: string
  favicon?: string
  tags?: string[]
  rank?: string
}

/** `name` renames the tag everywhere, merging into an existing tag of that name. */
export interface TagUpdatePayload {
  name?: string
  rank?: string
  pinned?: boolean
}

export interface StashCreatePayload {
  name: string
  items: StashItem[]
  created_at: number
}

export interface StashUpdatePayload {
  name?: string
  items?: StashItem[]
}

/** Tag ops address the tag by name in `id`. */
export type Op =
  | { op_id: string; entity: 'bookmark'; type: 'create'; id: string; payload: CreatePayload; client_ts: number }
  | { op_id: string; entity: 'bookmark'; type: 'update'; id: string; payload: UpdatePayload; client_ts: number }
  | { op_id: string; entity: 'tag'; type: 'update'; id: string; payload: TagUpdatePayload; client_ts: number }
  | { op_id: string; entity: 'stash'; type: 'create'; id: string; payload: StashCreatePayload; client_ts: number }
  | { op_id: string; entity: 'stash'; type: 'update'; id: string; payload: StashUpdatePayload; client_ts: number }
  | { op_id: string; entity: Entity; type: 'delete'; id: string; client_ts: number }

export type OpStatus = 'applied' | 'duplicate' | 'ignored' | 'replayed'

export interface OpsResponse {
  version: number
  results: { op_id: string; status: OpStatus }[]
}

export interface PullResponse {
  version: number
  full: boolean
  bookmarks: Bookmark[]
  stashes: Stash[]
  /** Always the complete list. */
  tags: TagMeta[]
}

export interface ImportItem {
  url: string
  title: string
  tags: string[]
  rank: string
  created_at: number
  /** `data:image/...;base64,...` captured at import, used when Chrome has no cached icon. */
  favicon?: string
}

export interface ImportResponse {
  imported: number
  skipped: number
  version: number
}

/** Server-confirmed state; pending outbox ops are layered on top for display. */
export interface Cache {
  version: number
  bookmarks: Record<string, Bookmark>
  stashes: Record<string, Stash>
  /** Keyed by lowercased tag name. */
  tags: Record<string, TagMeta>
}

export interface Settings {
  serverUrl: string
  token: string
}

export interface FailedBatch {
  ops: Op[]
  error: string
  at: number
}

export type SyncStatus = 'idle' | 'syncing' | 'retrying' | 'error' | 'auth_error' | 'unconfigured'

export interface SyncState {
  status: SyncStatus
  attempt: number
  lastSyncAt?: number
  lastError?: string
  nextRetryAt?: number
  notice?: string
}

export interface Onboarding {
  completed: boolean
  importDone: boolean
}
