import { rankBetween } from './rank'
import { defaultStashName } from './stash'
import { hasTag, normalizeTag, normalizeTags, tagKey, UNTAGGED } from './tags'
import type { Bookmark, Cache, Entity, Op, PullResponse, Stash, StashItem, StashUpdatePayload, TagMeta, TagUpdatePayload, UpdatePayload } from './types'

export function newId(): string {
  return crypto.randomUUID()
}

// ---------- op builders ----------

export function makeCreateOp(input: { url: string; title: string; favicon?: string; tags?: string[]; rank: string }): Op {
  const now = Date.now()
  return {
    op_id: newId(),
    entity: 'bookmark',
    type: 'create',
    id: newId(),
    payload: {
      url: input.url.trim(),
      title: input.title.trim(),
      favicon: input.favicon ?? '',
      tags: normalizeTags(input.tags ?? []),
      rank: input.rank,
      created_at: now,
    },
    client_ts: now,
  }
}

export function makeUpdateOp(id: string, patch: UpdatePayload): Op {
  const payload: UpdatePayload = { ...patch }
  if (payload.tags) payload.tags = normalizeTags(payload.tags)
  if (payload.title !== undefined) payload.title = payload.title.trim()
  if (payload.url !== undefined) payload.url = payload.url.trim()
  return { op_id: newId(), entity: 'bookmark', type: 'update', id, payload, client_ts: Date.now() }
}

export function makeDeleteOp(id: string, entity: Entity = 'bookmark'): Op {
  return { op_id: newId(), entity, type: 'delete', id, client_ts: Date.now() }
}

/** Edits a tag by name; UNTAGGED addresses the virtual tag (which can't be renamed). */
export function makeTagOp(name: string, patch: TagUpdatePayload): Op {
  const payload = { ...patch }
  if (payload.name !== undefined) payload.name = normalizeTag(payload.name)
  return { op_id: newId(), entity: 'tag', type: 'update', id: name, payload, client_ts: Date.now() }
}

/** Unnamed groups are named after their creation time. */
export function makeStashCreateOp(items: StashItem[], name = '', createdAt = Date.now()): Op {
  const payload = { name: name.trim() || defaultStashName(createdAt), items, created_at: createdAt }
  return { op_id: newId(), entity: 'stash', type: 'create', id: newId(), payload, client_ts: Date.now() }
}

export function makeStashUpdateOp(id: string, patch: StashUpdatePayload): Op {
  return { op_id: newId(), entity: 'stash', type: 'update', id, payload: patch, client_ts: Date.now() }
}

// ---------- local state ----------

type Entities = Pick<Cache, 'bookmarks' | 'stashes' | 'tags'>

/** Rewrites one tag on every bookmark carrying it; `to` null removes it. */
function retagAll(s: Entities, key: string, to: string | null, ts: number): void {
  for (const b of Object.values(s.bookmarks)) {
    if (!hasTag(b, key) || key === UNTAGGED) continue
    const tags = b.tags.flatMap((t) => (tagKey(t) === key ? (to === null ? [] : [to]) : [t]))
    s.bookmarks[b.id] = { ...b, tags: normalizeTags(tags), updated_at: ts }
  }
}

function applyTagUpdate(s: Entities, name: string, p: TagUpdatePayload, ts: number): void {
  let key = tagKey(name)
  if (p.name && key !== UNTAGGED && p.name !== name) {
    const toKey = tagKey(p.name)
    const merging = toKey !== key && Object.values(s.bookmarks).some((b) => hasTag(b, toKey))
    retagAll(s, key, p.name, ts)
    const moved = s.tags[key]
    delete s.tags[key]
    if (!(merging && s.tags[toKey])) {
      if (moved) s.tags[toKey] = { ...moved, name: p.name }
      else delete s.tags[toKey]
    }
    key = toKey
  }
  if (p.rank === undefined && p.pinned === undefined) return
  const cur: TagMeta = s.tags[key] ?? { name: key === UNTAGGED ? UNTAGGED : (p.name ?? name), rank: '', pinned: key === UNTAGGED }
  s.tags[key] = { ...cur, ...(p.rank !== undefined && { rank: p.rank }), ...(p.pinned !== undefined && { pinned: p.pinned }) }
}

/** Applies one op to the entity maps in place (optimistic local view). */
export function applyOp(s: Entities, op: Op): void {
  if (op.type === 'delete') {
    if (op.entity === 'bookmark') delete s.bookmarks[op.id]
    else if (op.entity === 'stash') delete s.stashes[op.id]
    else if (op.id !== UNTAGGED) {
      retagAll(s, tagKey(op.id), null, op.client_ts)
      delete s.tags[tagKey(op.id)]
    }
    return
  }

  switch (op.entity) {
    case 'bookmark': {
      if (op.type === 'create') {
        const p = op.payload
        s.bookmarks[op.id] = {
          id: op.id, url: p.url, title: p.title, favicon: p.favicon, tags: p.tags, rank: p.rank ?? '',
          created_at: p.created_at, updated_at: op.client_ts,
        }
        return
      }
      const cur = s.bookmarks[op.id]
      if (!cur) return
      const p = op.payload
      s.bookmarks[op.id] = {
        ...cur,
        ...(p.url !== undefined && { url: p.url }),
        ...(p.title !== undefined && { title: p.title }),
        ...(p.favicon !== undefined && { favicon: p.favicon }),
        ...(p.tags !== undefined && { tags: p.tags }),
        ...(p.rank !== undefined && { rank: p.rank }),
        updated_at: op.client_ts,
      }
      return
    }
    case 'tag':
      applyTagUpdate(s, op.id, op.payload, op.client_ts)
      return
    case 'stash': {
      if (op.type === 'create') {
        const p = op.payload
        if (!s.stashes[op.id]) s.stashes[op.id] = { id: op.id, ...p, updated_at: op.client_ts }
        return
      }
      const cur = s.stashes[op.id]
      if (!cur) return
      const p = op.payload
      s.stashes[op.id] = {
        ...cur,
        ...(p.name !== undefined && { name: p.name }),
        ...(p.items !== undefined && { items: p.items }),
        updated_at: op.client_ts,
      }
    }
  }
}

export interface View {
  /** Global order (by rank). */
  bookmarks: Bookmark[]
  /** Newest first. */
  stashes: Stash[]
  /** Keyed by lowercased tag name. */
  tags: Record<string, TagMeta>
}

/** Server state with pending ops layered on top. */
export function buildState(cache: Cache, outbox: Op[]): View {
  const s: Entities = { bookmarks: { ...cache.bookmarks }, stashes: { ...cache.stashes }, tags: { ...cache.tags } }
  for (const op of outbox) applyOp(s, op)
  return {
    bookmarks: Object.values(s.bookmarks).sort(compareOrder),
    stashes: Object.values(s.stashes).sort((a, b) => b.created_at - a.created_at),
    tags: s.tags,
  }
}

function mergeRows<T extends { id: string; deleted_at?: number | null }>(base: Record<string, T>, rows: T[] | undefined, full: boolean): Record<string, T> {
  const out = full ? {} : { ...base }
  for (const r of rows ?? []) {
    if (r.deleted_at) delete out[r.id]
    else out[r.id] = r
  }
  return out
}

export function mergePull(cache: Cache, res: PullResponse): Cache {
  return {
    version: res.version,
    bookmarks: mergeRows(cache.bookmarks, res.bookmarks, res.full),
    stashes: mergeRows(cache.stashes, res.stashes, res.full),
    tags: res.tags ? Object.fromEntries(res.tags.map((m) => [tagKey(m.name), m])) : cache.tags,
  }
}

export function findByUrl(view: Bookmark[], url: string): Bookmark | undefined {
  const u = url.trim()
  return view.find((b) => b.url === u)
}

// ---------- ordering ----------

/** The global order; equal ranks (two devices picking the same key) fall back to age. */
export function compareOrder(a: Bookmark, b: Bookmark): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Rank for a bookmark entering the given tags: right after the last bookmark of its most
 * specific tag (the one with the fewest bookmarks), like dropping it into that folder.
 * Without tags, or for brand-new tags, it goes to the very end.
 */
export function rankForTags(ordered: Bookmark[], tags: string[]): string {
  let best: { key: string; count: number } | undefined
  for (const key of normalizeTags(tags).map(tagKey)) {
    const count = ordered.reduce((n, b) => n + Number(hasTag(b, key)), 0)
    if (count && (!best || count < best.count)) best = { key, count }
  }
  if (best) {
    let last = ordered.length - 1
    while (!hasTag(ordered[last], best.key)) last--
    return rankBetween(ordered[last].rank, ordered[last + 1]?.rank)
  }
  return rankBetween(ordered.at(-1)?.rank, null)
}

// ---------- browsing ----------

export type SortKey = 'default' | 'added' | 'visits' | 'title'

const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// ICU's zh collation puts Han before Latin; list Latin/digits first, then Han by pinyin.
const startsWithHan = (s: string) => /^\p{Script=Han}/u.test(s.trimStart())

export function compareTitles(a: string, b: string): number {
  return Number(startsWithHan(a)) - Number(startsWithHan(b)) || titleCollator.compare(a, b)
}

/** History lists the same page under slightly different URLs; fold them together. */
export function visitKey(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/+$/, '')
}

export function countVisits(items: { url?: string; visitCount?: number }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    if (!it.url) continue
    const k = visitKey(it.url)
    m.set(k, (m.get(k) ?? 0) + (it.visitCount ?? 0))
  }
  return m
}

/** Returns a new array; ties fall back to most recently added. */
export function sortBookmarks(list: Bookmark[], key: SortKey, visits?: Map<string, number>): Bookmark[] {
  const byAdded = (a: Bookmark, b: Bookmark) => b.created_at - a.created_at
  const v = (b: Bookmark) => visits?.get(visitKey(b.url)) ?? 0
  const out = [...list]
  switch (key) {
    case 'default':
      return out.sort(compareOrder)
    case 'added':
      return out.sort(byAdded)
    case 'visits':
      return out.sort((a, b) => v(b) - v(a) || byAdded(a, b))
    case 'title':
      return out.sort((a, b) => compareTitles(a.title || a.url, b.title || b.url) || byAdded(a, b))
  }
}

/** Matches all selected tags (AND) and the free-text query against title, url and tags. */
export function filterBookmarks(view: Bookmark[], query: string, selectedTags: string[]): Bookmark[] {
  const q = query.trim().toLowerCase()
  const keys = selectedTags.map(tagKey)
  return view.filter((b) => {
    if (!keys.every((k) => hasTag(b, k))) return false
    if (!q) return true
    return b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q))
  })
}
