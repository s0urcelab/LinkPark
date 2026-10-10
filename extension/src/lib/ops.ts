import type { Bookmark, Cache, CreatePayload, Op, PullResponse, UpdatePayload } from './types'

export const MAX_TAG_LEN = 64
export const MAX_TAGS = 32

export function newId(): string {
  return crypto.randomUUID()
}

/** Mirrors the server: strip control chars, trim, dedupe case-insensitively. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TAG_LEN)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === MAX_TAGS) break
  }
  return out
}

export function makeCreateOp(input: { url: string; title: string; favicon?: string; tags?: string[] }): Op {
  const now = Date.now()
  const payload: CreatePayload = {
    url: input.url.trim(),
    title: input.title.trim(),
    favicon: input.favicon ?? '',
    tags: normalizeTags(input.tags ?? []),
    created_at: now,
  }
  return { op_id: newId(), type: 'create', bookmark_id: newId(), payload, client_ts: now }
}

export function makeUpdateOp(id: string, patch: UpdatePayload): Op {
  const payload: UpdatePayload = { ...patch }
  if (payload.tags) payload.tags = normalizeTags(payload.tags)
  if (payload.title !== undefined) payload.title = payload.title.trim()
  if (payload.url !== undefined) payload.url = payload.url.trim()
  return { op_id: newId(), type: 'update', bookmark_id: id, payload, client_ts: Date.now() }
}

export function makeDeleteOp(id: string): Op {
  return { op_id: newId(), type: 'delete', bookmark_id: id, client_ts: Date.now() }
}

/** Applies one op to a bookmark map in place (optimistic local view). */
export function applyOp(map: Record<string, Bookmark>, op: Op): void {
  switch (op.type) {
    case 'create': {
      const p = op.payload as CreatePayload
      map[op.bookmark_id] = {
        id: op.bookmark_id,
        url: p.url,
        title: p.title,
        favicon: p.favicon,
        tags: p.tags,
        created_at: p.created_at,
        updated_at: op.client_ts,
      }
      break
    }
    case 'update': {
      const cur = map[op.bookmark_id]
      if (!cur) break
      const p = op.payload as UpdatePayload
      map[op.bookmark_id] = {
        ...cur,
        ...(p.url !== undefined && { url: p.url }),
        ...(p.title !== undefined && { title: p.title }),
        ...(p.favicon !== undefined && { favicon: p.favicon }),
        ...(p.tags !== undefined && { tags: p.tags }),
        updated_at: op.client_ts,
      }
      break
    }
    case 'delete':
      delete map[op.bookmark_id]
      break
  }
}

/** Server state with pending ops layered on top, newest first. */
export function buildView(cache: Cache, outbox: Op[]): Bookmark[] {
  const map = { ...cache.bookmarks }
  for (const op of outbox) applyOp(map, op)
  return Object.values(map).sort((a, b) => b.created_at - a.created_at)
}

export function mergePull(cache: Cache, res: PullResponse): Cache {
  const bookmarks = res.full ? {} : { ...cache.bookmarks }
  for (const b of res.bookmarks) {
    if (b.deleted_at) delete bookmarks[b.id]
    else bookmarks[b.id] = b
  }
  return { version: res.version, bookmarks }
}

export function findByUrl(view: Bookmark[], url: string): Bookmark | undefined {
  const u = url.trim()
  return view.find((b) => b.url === u)
}

export interface TagCount {
  name: string
  count: number
}

export function countTags(view: Bookmark[]): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const b of view) {
    for (const t of b.tags) {
      const key = t.toLowerCase()
      const cur = counts.get(key)
      if (cur) cur.count++
      else counts.set(key, { name: t, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Matches all selected tags (AND) and the free-text query against title, url and tags. */
export function filterBookmarks(view: Bookmark[], query: string, selectedTags: string[]): Bookmark[] {
  const q = query.trim().toLowerCase()
  const sel = selectedTags.map((t) => t.toLowerCase())
  return view.filter((b) => {
    const tags = b.tags.map((t) => t.toLowerCase())
    if (!sel.every((t) => tags.includes(t))) return false
    if (!q) return true
    return b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || tags.some((t) => t.includes(q))
  })
}
