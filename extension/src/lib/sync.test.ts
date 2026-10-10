import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { buildView, makeCreateOp, makeDeleteOp } from './ops'
import { defaults, type StorageKey, type StorageSchema } from './storage'
import { backoffDelay, createSyncEngine, type SyncDeps } from './sync'
import type { Bookmark, Op, PullResponse } from './types'

function memoryStore() {
  const data: StorageSchema = structuredClone(defaults)
  data.settings = { serverUrl: 'http://srv', token: 't' }
  return {
    data,
    get: async <K extends StorageKey>(k: K) => structuredClone(data[k]),
    set: async <K extends StorageKey>(k: K, v: StorageSchema[K]) => {
      data[k] = structuredClone(v)
    },
  }
}

/** A tiny fake server applying ops with the same semantics as the Go store. */
function fakeServer() {
  let version = 0
  const rows: Record<string, Bookmark> = {}
  const applied = new Set<string>()
  return {
    offline: false,
    rows,
    async postOps(_s: unknown, ops: Op[]) {
      if (this.offline) throw new ApiError(0, 'offline')
      const results = ops.map((op) => {
        if (applied.has(op.op_id)) return { op_id: op.op_id, status: 'replayed' as const }
        applied.add(op.op_id)
        version++
        if (op.type === 'create') {
          const p = op.payload as { url: string; title: string; tags: string[] }
          rows[op.bookmark_id] = { id: op.bookmark_id, url: p.url, title: p.title, favicon: '', tags: p.tags, created_at: 1, updated_at: 1, version }
        } else if (op.type === 'delete') {
          rows[op.bookmark_id] = { ...rows[op.bookmark_id], deleted_at: 1, version }
        }
        return { op_id: op.op_id, status: 'applied' as const }
      })
      return { version, results }
    },
    async pull(_s: unknown, since: number): Promise<PullResponse> {
      if (this.offline) throw new ApiError(0, 'offline')
      const bookmarks = Object.values(rows).filter((b) => (b.version ?? 0) > since && (since > 0 || !b.deleted_at))
      return { version, full: since === 0, bookmarks }
    },
  }
}

describe('backoffDelay', () => {
  it('grows exponentially and caps at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000])
    expect(backoffDelay(30)).toBe(300_000)
  })
})

describe('sync engine', () => {
  let store: ReturnType<typeof memoryStore>
  let server: ReturnType<typeof fakeServer>
  let deps: SyncDeps

  beforeEach(() => {
    store = memoryStore()
    server = fakeServer()
    deps = {
      get: store.get,
      set: store.set,
      api: server,
      scheduleRetry: vi.fn(),
      cancelRetry: vi.fn(),
    }
  })

  it('pushes the outbox, pulls, and keeps the view stable', async () => {
    const engine = createSyncEngine(deps)
    const op = makeCreateOp({ url: 'https://a.com', title: 'A', tags: ['dev'] })
    await engine.enqueue(op)
    expect(buildView(store.data.cache, store.data.outbox)).toHaveLength(1)

    await engine.sync()
    expect(store.data.outbox).toHaveLength(0)
    expect(store.data.cache.version).toBe(1)
    expect(buildView(store.data.cache, store.data.outbox).map((b) => b.url)).toEqual(['https://a.com'])
    expect(store.data.syncState.status).toBe('idle')
  })

  it('keeps ops and schedules exponential retries while offline, then recovers', async () => {
    const engine = createSyncEngine(deps)
    server.offline = true
    await engine.enqueue(makeCreateOp({ url: 'https://a.com', title: 'A' }))

    await engine.sync()
    await engine.sync()
    expect(store.data.outbox).toHaveLength(1)
    expect(store.data.syncState).toMatchObject({ status: 'retrying', attempt: 2 })
    expect(deps.scheduleRetry).toHaveBeenNthCalledWith(1, 1000)
    expect(deps.scheduleRetry).toHaveBeenNthCalledWith(2, 2000)

    server.offline = false
    await engine.sync()
    expect(store.data.outbox).toHaveLength(0)
    expect(store.data.syncState).toMatchObject({ status: 'idle', attempt: 0 })
    expect(deps.cancelRetry).toHaveBeenCalled()
  })

  it('does not double-apply when the response was lost after the server committed', async () => {
    const engine = createSyncEngine(deps)
    const op = makeCreateOp({ url: 'https://a.com', title: 'A' })
    await engine.enqueue(op)
    const realPull = server.pull.bind(server)
    server.pull = async () => {
      throw new ApiError(0, 'connection reset')
    }
    await engine.sync()
    expect(store.data.outbox).toHaveLength(1)

    server.pull = realPull
    await engine.sync()
    expect(store.data.outbox).toHaveLength(0)
    expect(Object.keys(server.rows)).toHaveLength(1)
  })

  it('moves a rejected batch to failed without retrying', async () => {
    const engine = createSyncEngine(deps)
    server.postOps = async () => {
      throw new ApiError(422, 'bad op')
    }
    await engine.enqueue(makeDeleteOp('x'))
    await engine.sync()
    expect(store.data.outbox).toHaveLength(0)
    expect(store.data.failed).toHaveLength(1)
    expect(store.data.syncState.status).toBe('error')
    expect(deps.scheduleRetry).not.toHaveBeenCalled()
  })

  it('pauses on auth errors and keeps the outbox', async () => {
    const engine = createSyncEngine(deps)
    server.postOps = async () => {
      throw new ApiError(401, 'unauthorized')
    }
    await engine.enqueue(makeCreateOp({ url: 'https://a.com', title: 'A' }))
    await engine.sync()
    expect(store.data.outbox).toHaveLength(1)
    expect(store.data.syncState.status).toBe('auth_error')
    expect(deps.scheduleRetry).not.toHaveBeenCalled()
  })

  it('applies remote deletions from incremental pulls', async () => {
    const engine = createSyncEngine(deps)
    const op = makeCreateOp({ url: 'https://a.com', title: 'A' })
    await engine.enqueue(op)
    await engine.sync()
    await server.postOps(null, [makeDeleteOp(op.bookmark_id)])
    await engine.sync()
    expect(store.data.cache.bookmarks).toEqual({})
  })
})
