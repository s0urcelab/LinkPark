import { normalizeTags } from './ops'
import type { ImportItem } from './types'

/** Structural subset of chrome.bookmarks.BookmarkTreeNode, so this stays testable. */
export interface TreeNode {
  title: string
  url?: string
  dateAdded?: number
  children?: TreeNode[]
}

/** The server replaces non-positive timestamps with "now", so the oldest usable value is 1. */
const OLDEST = 1

const known = (ts?: number) => (ts && ts > 0 ? ts : undefined)

/**
 * Flattens the browser bookmark tree. Folder names become tags, except the invisible
 * root and its direct children ("Bookmarks bar", "Other bookmarks", ...).
 *
 * Very old bookmarks may lack dateAdded. They borrow the previous sibling's date, then
 * the enclosing folder's, and must never default to "now" or they jump to the top of
 * "recently added".
 */
export function flattenTree(roots: TreeNode[]): ImportItem[] {
  const out: ImportItem[] = []
  const walk = (node: TreeNode, depth: number, path: string[], fallback: number) => {
    const date = known(node.dateAdded) ?? fallback
    if (node.url) {
      if (/^https?:\/\//i.test(node.url)) {
        out.push({ url: node.url, title: node.title || node.url, tags: normalizeTags(path), created_at: date })
      }
      return
    }
    const nextPath = depth >= 2 && node.title ? [...path, node.title] : path
    let prev = date
    for (const child of node.children ?? []) {
      walk(child, depth + 1, nextPath, prev)
      if (child.url) prev = known(child.dateAdded) ?? prev
    }
  }
  for (const root of roots) walk(root, 0, [], OLDEST)
  return out
}

export function summarize(items: ImportItem[]): { total: number; tags: string[] } {
  const tags = new Set<string>()
  for (const it of items) for (const t of it.tags) tags.add(t)
  return { total: new Set(items.map((i) => i.url)).size, tags: [...tags] }
}
