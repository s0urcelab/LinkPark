import type { TagMeta } from './types'

export const MAX_TAG_LEN = 64
export const MAX_TAGS = 32

/** Key of the virtual tag that holds every bookmark without tags. */
export const UNTAGGED = ''
export const UNTAGGED_LABEL = '未分类'

/** Slices by code point so surrogate pairs are never split. */
const clip = (s: string, n: number) => [...s].slice(0, n).join('')

/** Mirrors the server: strip control chars and surrounding space, cap the length. */
export function normalizeTag(raw: string): string {
  return clip(raw.replace(/[\u0000-\u001f\u007f]/g, '').trim(), MAX_TAG_LEN).trim()
}

/** Normalizes, dedupes case-insensitively and caps the count. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = normalizeTag(raw)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === MAX_TAGS) break
  }
  return out
}

export const tagKey = (name: string) => name.toLowerCase()

export const tagLabel = (name: string) => (name === UNTAGGED ? UNTAGGED_LABEL : name)

/** True if the bookmark carries the tag; the virtual tag matches bookmarks with none. */
export function hasTag(b: { tags: string[] }, key: string): boolean {
  return key === UNTAGGED ? b.tags.length === 0 : b.tags.some((t) => t.toLowerCase() === key)
}

export interface TagInfo {
  name: string
  key: string
  count: number
  rank: string
  pinned: boolean
  virtual: boolean
}

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// Unranked tags (created by hand) go last. The virtual tag goes first until it is moved.
const sortKey = (t: TagInfo) => t.rank || (t.virtual ? '' : '\uffff')

export function compareTags(a: TagInfo, b: TagInfo): number {
  const ka = sortKey(a)
  const kb = sortKey(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  return nameCollator.compare(a.name, b.name)
}

export function metaFor(meta: Record<string, TagMeta>, key: string): Pick<TagInfo, 'rank' | 'pinned'> {
  const m = meta[key]
  return { rank: m?.rank ?? '', pinned: m?.pinned ?? key === UNTAGGED }
}

/** Every tag in use, in user order. The virtual tag is listed while it holds bookmarks. */
export function buildTagList(bookmarks: { tags: string[] }[], meta: Record<string, TagMeta>): TagInfo[] {
  const byKey = new Map<string, TagInfo>()
  let untagged = 0
  for (const b of bookmarks) {
    if (!b.tags.length) untagged++
    for (const name of b.tags) {
      const key = tagKey(name)
      const t = byKey.get(key)
      if (t) t.count++
      else byKey.set(key, { name, key, count: 1, ...metaFor(meta, key), virtual: false })
    }
  }
  const list = [...byKey.values()]
  if (untagged) list.push({ name: UNTAGGED, key: UNTAGGED, count: untagged, ...metaFor(meta, UNTAGGED), virtual: true })
  return list.sort(compareTags)
}

/**
 * Tags that narrow the current results further: present in them but not selected, in
 * user order, counted within the results. Tags with no overlap are never offered.
 */
export function relatedTags(results: { tags: string[] }[], selected: string[], list: TagInfo[]): TagInfo[] {
  const sel = new Set(selected.map(tagKey))
  const counts = new Map<string, number>()
  for (const b of results) {
    if (!b.tags.length) counts.set(UNTAGGED, (counts.get(UNTAGGED) ?? 0) + 1)
    for (const t of b.tags) counts.set(tagKey(t), (counts.get(tagKey(t)) ?? 0) + 1)
  }
  return list.filter((t) => !sel.has(t.key) && counts.has(t.key)).map((t) => ({ ...t, count: counts.get(t.key)! }))
}
