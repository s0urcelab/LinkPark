export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string
  tags: string[]
  created_at: number
  updated_at: number
  deleted_at?: number | null
  version?: number
}

export type OpType = 'create' | 'update' | 'delete'

export interface CreatePayload {
  url: string
  title: string
  favicon: string
  tags: string[]
  created_at: number
}

export interface UpdatePayload {
  url?: string
  title?: string
  favicon?: string
  tags?: string[]
}

export interface Op {
  op_id: string
  type: OpType
  bookmark_id: string
  payload?: CreatePayload | UpdatePayload
  client_ts: number
}

export type OpStatus = 'applied' | 'duplicate' | 'ignored' | 'replayed'

export interface OpsResponse {
  version: number
  results: { op_id: string; status: OpStatus }[]
}

export interface PullResponse {
  version: number
  full: boolean
  bookmarks: Bookmark[]
}

export interface ImportItem {
  url: string
  title: string
  tags: string[]
  created_at: number
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
