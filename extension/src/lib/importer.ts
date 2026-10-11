import { rankBetween, rankSequence } from './rank'
import { normalizeTag, normalizeTags, tagKey, UNTAGGED } from './tags'
import type { ImportItem, StashItem, TagMeta } from './types'

/** Structural subset of chrome.bookmarks.BookmarkTreeNode, so this stays testable. */
export interface TreeNode {
  id?: string
  title: string
  url?: string
  dateAdded?: number
  folderType?: string
  children?: TreeNode[]
}

/** Ranks are assigned when the import is sent, after whatever already exists. */
export type ImportDraft = Omit<ImportItem, 'rank'>

export interface ImportTagDraft {
  name: string
  pinned: boolean
}

/** A folder sent to the stash instead of being imported; named after the folder. */
export interface ImportStashDraft {
  name: string
  items: StashItem[]
}

export interface ImportPlan {
  /** Depth-first folder order, which becomes the global bookmark order. */
  items: ImportDraft[]
  /** In order of first appearance. */
  tags: ImportTagDraft[]
  /** In folder order. */
  stashes: ImportStashDraft[]
}

/** A folder as offered for "send to stash"; `key` is its index path in the tree. */
export interface FolderNode {
  key: string
  title: string
  /** Web links anywhere below. */
  count: number
  children: FolderNode[]
}

/** Server limit per stash; bigger folders are split into numbered groups. */
const MAX_STASH_ITEMS = 1000

/** The server replaces non-positive timestamps with "now", so the oldest usable value is 1. */
const OLDEST = 1

const known = (ts?: number) => (ts && ts > 0 ? ts : undefined)

const isWebUrl = (url: string) => /^https?:\/\//i.test(url)

/** Chrome marks the bar with folderType; older versions only by its fixed id "1". */
const isBarFolder = (node: TreeNode) => node.folderType === 'bookmarks-bar' || node.id === '1'

/**
 * Flattens the browser bookmark tree depth-first. Every folder on a bookmark's path
 * becomes one flat tag ("技术/IT/前端" -> 技术, IT, 前端), excluding the invisible root and
 * its direct children ("Bookmarks bar", "Other bookmarks", ...); loose links in those
 * containers get no tags. Folders directly on the bookmarks bar become pinned tags.
 *
 * Folders listed in `stashKeys` (see folderTree) skip all that: every link below them
 * goes, in order, into one stash group named after the folder.
 *
 * Very old bookmarks may lack dateAdded. They borrow the previous sibling's date, then
 * the enclosing folder's, and must never default to "now" or they jump to the top of
 * "recently added".
 */
export function flattenTree(roots: TreeNode[], stashKeys: ReadonlySet<string> = new Set()): ImportPlan {
  const items: ImportDraft[] = []
  const tags = new Map<string, ImportTagDraft>()
  const stashes: ImportStashDraft[] = []
  const walk = (node: TreeNode, key: string, depth: number, path: string[], onBar: boolean, fallback: number) => {
    const date = known(node.dateAdded) ?? fallback
    if (node.url) {
      if (isWebUrl(node.url)) items.push({ url: node.url, title: node.title || node.url, tags: normalizeTags(path), created_at: date })
      return
    }
    if (stashKeys.has(key)) {
      stashes.push(...stashGroups(node))
      return
    }
    let nextPath = path
    const name = depth >= 2 ? normalizeTag(node.title) : ''
    if (name) {
      nextPath = [...path, name]
      const t = tags.get(tagKey(name))
      const pinned = onBar && depth === 2
      if (t) t.pinned ||= pinned
      else tags.set(tagKey(name), { name, pinned })
    }
    const childOnBar = onBar || (depth === 1 && isBarFolder(node))
    let prev = date
    node.children?.forEach((child, i) => {
      walk(child, `${key}.${i}`, depth + 1, nextPath, childOnBar, prev)
      if (child.url) prev = known(child.dateAdded) ?? prev
    })
  }
  roots.forEach((root, i) => walk(root, String(i), 0, [], false, OLDEST))

  const used = new Set(items.flatMap((i) => i.tags.map(tagKey)))
  return { items, tags: [...tags.values()].filter((t) => used.has(tagKey(t.name))), stashes }
}

function stashGroups(folder: TreeNode): ImportStashDraft[] {
  const links: StashItem[] = []
  const collect = (node: TreeNode) => {
    if (node.url) {
      if (isWebUrl(node.url)) links.push({ url: node.url, title: (node.title || node.url).trim() })
    } else node.children?.forEach(collect)
  }
  collect(folder)
  const name = folder.title.trim().slice(0, 100) || '未命名文件夹'
  const parts = Math.ceil(links.length / MAX_STASH_ITEMS)
  return Array.from({ length: parts }, (_, i) => ({
    name: parts > 1 ? `${name} (${i + 1})` : name,
    items: links.slice(i * MAX_STASH_ITEMS, (i + 1) * MAX_STASH_ITEMS),
  }))
}

/** Folders that contain web links, below the invisible root; keys match flattenTree's. */
export function folderTree(roots: TreeNode[]): FolderNode[] {
  const build = (node: TreeNode, key: string): FolderNode => {
    const children: FolderNode[] = []
    let count = 0
    node.children?.forEach((child, i) => {
      if (child.url) {
        if (isWebUrl(child.url)) count++
        return
      }
      const f = build(child, `${key}.${i}`)
      count += f.count
      if (f.count) children.push(f)
    })
    return { key, title: node.title, count, children }
  }
  return roots.flatMap((root, i) => build(root, String(i)).children)
}

export function summarize(plan: ImportPlan): { total: number; tags: number; pinned: number; untagged: number; stashed: number } {
  return {
    total: new Set(plan.items.map((i) => i.url)).size,
    tags: plan.tags.length,
    pinned: plan.tags.filter((t) => t.pinned).length,
    untagged: plan.items.filter((i) => !i.tags.length).length,
    stashed: plan.stashes.reduce((n, s) => n + s.items.length, 0),
  }
}

/**
 * Places an import after everything that already exists: bookmarks keep their folder
 * order at the end of the global order, new tags follow the existing ones. The virtual
 * untagged tag gets a pinned first slot, which the server only applies if it has none.
 */
export function rankImport(
  plan: ImportPlan,
  existing: { lastBookmarkRank?: string; firstTagRank?: string; lastTagRank?: string },
): { items: ImportItem[]; tags: TagMeta[] } {
  const bookmarkRanks = rankSequence(existing.lastBookmarkRank, plan.items.length)
  const tagRanks = rankSequence(existing.lastTagRank, plan.tags.length)
  const tags: TagMeta[] = plan.tags.map((t, i) => ({ name: t.name, rank: tagRanks[i], pinned: t.pinned }))
  tags.unshift({ name: UNTAGGED, rank: rankBetween(null, existing.firstTagRank ?? tagRanks[0]), pinned: true })
  return { items: plan.items.map((it, i) => ({ ...it, rank: bookmarkRanks[i] })), tags }
}

// ---------- Netscape bookmark file (the HTML every browser exports) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)?.[1]
}

/** ADD_DATE is in seconds in every known exporter; tolerate ms and µs anyway. */
function parseDate(raw?: string): number | undefined {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n) || n <= 0) return undefined
  if (n < 1e11) return n * 1000
  if (n < 1e14) return n
  return Math.floor(n / 1000)
}

const text = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, '')).trim()

/**
 * Parses an exported bookmarks HTML file into the same shape as chrome.bookmarks.getTree():
 * one invisible root whose children are the top-level containers. The folder flagged
 * PERSONAL_TOOLBAR_FOLDER becomes the bar; loose top-level entries go to "其他书签".
 */
export function parseBookmarksHtml(html: string): TreeNode[] {
  const containers: TreeNode[] = []
  const loose: TreeNode[] = []
  // Folders whose <DL> is open; null is the file's top-level list.
  const stack: (TreeNode | null)[] = []
  let pending: TreeNode | null = null
  const re = /<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>|<DL\b[^>]*>|<\/DL>/gi

  for (const m of html.matchAll(re)) {
    const parent = stack.length ? stack[stack.length - 1] : null
    const siblings = parent ? (parent.children ??= []) : loose
    if (m[2] !== undefined) {
      const folder: TreeNode = { title: text(m[2]), dateAdded: parseDate(attr(m[1], 'ADD_DATE')), children: [] }
      if (!parent && /PERSONAL_TOOLBAR_FOLDER\s*=\s*"true"/i.test(m[1])) {
        folder.folderType = 'bookmarks-bar'
        containers.push(folder)
      } else if (!parent && /UNFILED_BOOKMARKS_FOLDER\s*=\s*"true"/i.test(m[1])) {
        containers.push(folder)
      } else {
        siblings.push(folder)
      }
      pending = folder
    } else if (m[4] !== undefined) {
      siblings.push({ title: text(m[4]), url: decodeEntities(attr(m[3], 'HREF') ?? ''), dateAdded: parseDate(attr(m[3], 'ADD_DATE')) })
      pending = null
    } else if (m[0][1] === '/') {
      stack.pop()
    } else {
      stack.push(pending ?? parent)
      pending = null
    }
  }

  if (loose.length) containers.push({ title: '其他书签', children: loose })
  return [{ title: '', children: containers }]
}
