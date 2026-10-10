import { normalizeTags } from './ops'
import type { ImportItem } from './types'

/** Structural subset of chrome.bookmarks.BookmarkTreeNode, so this stays testable. */
export interface TreeNode {
  title: string
  url?: string
  dateAdded?: number
  children?: TreeNode[]
}

/**
 * Flattens the browser bookmark tree. Folder names become tags, except the invisible
 * root and its direct children ("Bookmarks bar", "Other bookmarks", ...).
 */
export function flattenTree(roots: TreeNode[]): ImportItem[] {
  const out: ImportItem[] = []
  const walk = (node: TreeNode, depth: number, path: string[]) => {
    if (node.url) {
      if (/^https?:\/\//i.test(node.url)) {
        out.push({
          url: node.url,
          title: node.title || node.url,
          tags: normalizeTags(path),
          created_at: node.dateAdded ?? Date.now(),
        })
      }
      return
    }
    const nextPath = depth >= 2 && node.title ? [...path, node.title] : path
    for (const child of node.children ?? []) walk(child, depth + 1, nextPath)
  }
  for (const root of roots) walk(root, 0, [])
  return out
}

export function summarize(items: ImportItem[]): { total: number; tags: string[] } {
  const tags = new Set<string>()
  for (const it of items) for (const t of it.tags) tags.add(t)
  return { total: new Set(items.map((i) => i.url)).size, tags: [...tags] }
}
