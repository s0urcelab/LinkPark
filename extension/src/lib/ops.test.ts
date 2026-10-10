import { describe, expect, it } from 'vitest'
import { flattenTree, type TreeNode } from './importer'
import { buildView, countTags, countVisits, filterBookmarks, makeCreateOp, makeDeleteOp, makeUpdateOp, mergePull, normalizeTags, sortBookmarks } from './ops'
import type { Bookmark, Cache } from './types'

const bm = (id: string, url: string, tags: string[] = [], created_at = 1): Bookmark => ({
  id, url, title: url, favicon: '', tags, created_at, updated_at: created_at,
})

describe('normalizeTags', () => {
  it('trims, dedupes case-insensitively and drops empties', () => {
    expect(normalizeTags([' Go ', 'go', '', 'Dev\u0001'])).toEqual(['Go', 'Dev'])
  })
})

describe('buildView', () => {
  it('layers pending ops on top of server state', () => {
    const cache: Cache = { version: 3, bookmarks: { a: bm('a', 'https://a'), b: bm('b', 'https://b') } }
    const create = makeCreateOp({ url: 'https://c', title: 'C' })
    const view = buildView(cache, [create, makeUpdateOp('a', { title: 'renamed', tags: ['x'] }), makeDeleteOp('b')])
    expect(view.map((b) => b.id)).toEqual([create.bookmark_id, 'a'])
    expect(view[1]).toMatchObject({ title: 'renamed', tags: ['x'] })
  })
})

describe('mergePull', () => {
  it('applies upserts and tombstones incrementally, replaces on full', () => {
    const cache: Cache = { version: 2, bookmarks: { a: bm('a', 'https://a'), b: bm('b', 'https://b') } }
    const inc = mergePull(cache, { version: 4, full: false, bookmarks: [{ ...bm('b', ''), deleted_at: 9 }, bm('c', 'https://c')] })
    expect(Object.keys(inc.bookmarks).sort()).toEqual(['a', 'c'])
    expect(inc.version).toBe(4)

    const full = mergePull(cache, { version: 5, full: true, bookmarks: [bm('z', 'https://z')] })
    expect(Object.keys(full.bookmarks)).toEqual(['z'])
  })
})

describe('filter and tags', () => {
  const view = [bm('a', 'https://go.dev', ['Go', 'dev']), bm('b', 'https://react.dev', ['dev']), bm('c', 'https://x.com')]
  it('counts tags', () => {
    expect(countTags(view)).toEqual([{ name: 'dev', count: 2 }, { name: 'Go', count: 1 }])
  })
  it('requires all selected tags and matches the query', () => {
    expect(filterBookmarks(view, '', ['dev']).map((b) => b.id)).toEqual(['a', 'b'])
    expect(filterBookmarks(view, '', ['dev', 'go']).map((b) => b.id)).toEqual(['a'])
    expect(filterBookmarks(view, 'react', []).map((b) => b.id)).toEqual(['b'])
  })
})

describe('sortBookmarks', () => {
  const list = [
    { ...bm('a', 'https://b.com/', [], 1), title: '苹果' },
    { ...bm('b', 'https://a.com', [], 3), title: 'Banana' },
    { ...bm('c', 'https://c.com', [], 2), title: 'apple 10' },
    { ...bm('d', 'https://d.com', [], 4), title: 'apple 9' },
  ]
  const ids = (l: Bookmark[]) => l.map((b) => b.id)

  it('sorts by most recently added', () => {
    expect(ids(sortBookmarks(list, 'added'))).toEqual(['d', 'b', 'c', 'a'])
  })
  it('sorts by visit count, folding URL variants, ties by added', () => {
    const visits = countVisits([
      { url: 'https://b.com', visitCount: 3 },
      { url: 'https://b.com/#top', visitCount: 2 },
      { url: 'https://c.com/', visitCount: 4 },
    ])
    expect(ids(sortBookmarks(list, 'visits', visits))).toEqual(['a', 'c', 'd', 'b'])
  })
  it('sorts by title: natural numbers, Latin before Han', () => {
    expect(ids(sortBookmarks(list, 'title'))).toEqual(['d', 'c', 'b', 'a'])
  })
  it('does not mutate the input', () => {
    sortBookmarks(list, 'title')
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('flattenTree', () => {
  it('turns nested folder names into tags, skipping root folders', () => {
    const tree: TreeNode[] = [{
      title: '',
      children: [
        {
          title: '书签栏',
          children: [
            { title: 'Top', url: 'https://top.com' },
            { title: '技术', children: [{ title: 'Go', children: [{ title: 'Go docs', url: 'https://go.dev' }] }] },
            { title: 'bookmarklet', url: 'javascript:void(0)' },
          ],
        },
        { title: '其他书签', children: [{ title: '', url: 'https://other.com' }] },
      ],
    }]
    expect(flattenTree(tree)).toEqual([
      expect.objectContaining({ url: 'https://top.com', tags: [] }),
      expect.objectContaining({ url: 'https://go.dev', tags: ['技术', 'Go'] }),
      expect.objectContaining({ url: 'https://other.com', title: 'https://other.com', tags: [] }),
    ])
  })
})
