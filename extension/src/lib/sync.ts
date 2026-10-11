import { ApiError, api as defaultApi } from './api'
import { mergePull } from './ops'
import { isConfigured, type StorageKey, type StorageSchema } from './storage'
import type { Op, OpsResponse, SyncState } from './types'

export const BATCH_SIZE = 200
export const MAX_BACKOFF_MS = 5 * 60_000

/** attempt is 1-based: 1s, 2s, 4s ... capped at 5 minutes. */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)
}

export interface SyncDeps {
  get<K extends StorageKey>(key: K): Promise<StorageSchema[K]>
  set<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void>
  api: Pick<typeof defaultApi, 'postOps' | 'pull'>
  scheduleRetry(delayMs: number): void
  cancelRetry(): void
  onChange?(): void
  now?(): number
}

export type SyncEngine = ReturnType<typeof createSyncEngine>

export function createSyncEngine(deps: SyncDeps) {
  const now = deps.now ?? Date.now

  // Serializes read-modify-write cycles on storage. Never nest withLock calls.
  let lock: Promise<unknown> = Promise.resolve()
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn)
    lock = run.catch(() => undefined)
    return run
  }

  async function setState(patch: Partial<SyncState>): Promise<void> {
    await withLock(async () => {
      const cur = await deps.get('syncState')
      await deps.set('syncState', { ...cur, ...patch })
    })
    deps.onChange?.()
  }

  async function enqueue(op: Op): Promise<void> {
    await withLock(async () => {
      const outbox = await deps.get('outbox')
      await deps.set('outbox', [...outbox, op])
    })
    deps.onChange?.()
  }

  let running: Promise<void> | null = null
  let rerun = false
  let fullRequested = false

  /** Single-flight: concurrent callers share the in-progress run, which repeats once if asked again. */
  function sync(opts: { full?: boolean } = {}): Promise<void> {
    if (opts.full) fullRequested = true
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      do {
        rerun = false
        const full = fullRequested
        fullRequested = false
        await runOnce(full)
      } while (rerun)
    })().finally(() => {
      running = null
    })
    return running
  }

  async function runOnce(full: boolean): Promise<void> {
    const settings = await deps.get('settings')
    if (!isConfigured(settings)) {
      await setState({ status: 'unconfigured' })
      return
    }
    const state = await deps.get('syncState')
    if (state.status === 'auth_error' && !full) return

    await setState({ status: 'syncing' })
    const outbox = await deps.get('outbox')
    const batch = outbox.slice(0, BATCH_SIZE)
    const sent = new Set(batch.map((o) => o.op_id))
    let phase: 'push' | 'pull' = 'push'

    try {
      let res: OpsResponse | undefined
      if (batch.length) res = await deps.api.postOps(settings, batch)

      // Pull before dropping sent ops from the outbox, so optimistic edits never flicker away.
      phase = 'pull'
      const since = full ? 0 : (await deps.get('cache')).version
      let pulled = await deps.api.pull(settings, since)
      if (!pulled.full && pulled.version < since) {
        // The server's version went backwards (database restored/reset): resync from scratch.
        pulled = await deps.api.pull(settings, 0)
      }

      await withLock(async () => {
        await deps.set('cache', mergePull(await deps.get('cache'), pulled))
        const cur = await deps.get('outbox')
        await deps.set('outbox', cur.filter((o) => !sent.has(o.op_id)))
      })
      deps.cancelRetry()

      const bookmarkOps = new Set(batch.filter((o) => o.entity === 'bookmark').map((o) => o.op_id))
      const dup = res?.results.filter((r) => r.status === 'duplicate' && bookmarkOps.has(r.op_id)).length ?? 0
      await setState({
        status: 'idle',
        attempt: 0,
        lastSyncAt: now(),
        lastError: undefined,
        nextRetryAt: undefined,
        notice: dup ? `${dup} 个书签在服务端已存在，已跳过` : undefined,
      })
      if (outbox.length > batch.length) rerun = true
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, String(e))

      if (err.status === 401 || err.status === 403) {
        deps.cancelRetry()
        await setState({ status: 'auth_error', attempt: 0, lastError: 'Token 无效，请在设置中检查', nextRetryAt: undefined })
        return
      }

      if (!err.retryable && phase === 'push') {
        // The server rejected the batch as a whole; retrying would fail forever.
        await withLock(async () => {
          const cur = await deps.get('outbox')
          await deps.set('outbox', cur.filter((o) => !sent.has(o.op_id)))
          const failed = await deps.get('failed')
          await deps.set('failed', [...failed, { ops: batch, error: err.message, at: now() }])
        })
        await setState({ status: 'error', attempt: 0, lastError: err.message, nextRetryAt: undefined })
        if (outbox.length > batch.length) rerun = true
        return
      }

      const attempt = (await deps.get('syncState')).attempt + 1
      const delay = backoffDelay(attempt)
      deps.scheduleRetry(delay)
      await setState({ status: 'retrying', attempt, lastError: err.message, nextRetryAt: now() + delay })
    }
  }

  /** Puts failed batches back at the head of the outbox and syncs again. */
  async function retryFailed(): Promise<void> {
    await withLock(async () => {
      const failed = await deps.get('failed')
      const outbox = await deps.get('outbox')
      await deps.set('outbox', [...failed.flatMap((f) => f.ops), ...outbox])
      await deps.set('failed', [])
    })
    deps.onChange?.()
    await sync()
  }

  async function discardFailed(): Promise<void> {
    await withLock(() => deps.set('failed', []))
    await setState({ status: 'idle', lastError: undefined })
  }

  /** Drops the local cache (e.g. after switching servers) and pulls a full snapshot. */
  async function resetAndResync(): Promise<void> {
    await withLock(() => deps.set('cache', { version: 0, bookmarks: {}, stashes: {}, tags: {} }))
    await setState({ status: 'idle', attempt: 0, lastError: undefined })
    await sync({ full: true })
  }

  return { enqueue, sync, retryFailed, discardFailed, resetAndResync, withLock }
}
