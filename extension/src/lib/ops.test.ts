import { describe, expect, it } from 'vitest'
import { flattenTree, folderTree, parseBookmarksHtml, rankImport, summarize, type TreeNode } from './importer'
import {
  buildState,
  countVisits,
  filterBookmarks,
  makeCreateOp,
  makeDeleteOp,
  makeStashCreateOp,
  makeStashUpdateOp,
  makeTagOp,
  makeUpdateOp,
  mergePull,
  rankForTags,
  sortBookmarks,
} from './ops'
import { compareRank, rankBetween, rankSequence } from './rank'
import { buildTagList, normalizeTags, relatedTags, UNTAGGED } from './tags'
import type { Bookmark, Cache, TagMeta } from './types'

const bm = (id: string, url: string, tags: string[] = [], created_at = 1, rank = ''): Bookmark => ({
  id, url, title: url, favicon: '', tags, rank, created_at, updated_at: created_at,
})

const cacheOf = (bookmarks: Bookmark[], tags: TagMeta[] = []): Cache => ({
  version: 1,
  bookmarks: Object.fromEntries(bookmarks.map((b) => [b.id, b])),
  stashes: {},
  tags: Object.fromEntries(tags.map((t) => [t.name.toLowerCase(), t])),
})

const ids = (l: { id: string }[]) => l.map((b) => b.id)

describe('normalizeTags', () => {
  it('trims, dedupes case-insensitively and drops empties; "/" is just a character', () => {
    expect(normalizeTags([' Go ', 'go', '', 'Dev\u0001', ' A/B '])).toEqual(['Go', 'Dev', 'A/B'])
  })
})

describe('buildState', () => {
  it('layers pending ops on top of server state, in rank order', () => {
    const cache = cacheOf([bm('a', 'https://a', [], 1, 'G'), bm('b', 'https://b', [], 1, 'V')])
    const create = makeCreateOp({ url: 'https://c', title: 'C', rank: 'k' })
    const { bookmarks } = buildState(cache, [create, makeUpdateOp('a', { title: 'renamed', tags: ['x'], rank: 'z' }), makeDeleteOp('b')])
    expect(ids(bookmarks)).toEqual([create.id, 'a'])
    expect(bookmarks[1]).toMatchObject({ title: 'renamed', tags: ['x'], rank: 'z' })
  })

  it('creates, edits and deletes stashes', () => {
    const create = makeStashCreateOp([{ url: 'https://a', title: 'A' }, { url: 'https://b', title: 'B' }])
    const edit = makeStashUpdateOp(create.id, { name: '读书', items: [{ url: 'https://b', title: 'B' }] })
    const { stashes } = buildState(cacheOf([]), [create, edit])
    expect(stashes).toEqual([expect.objectContaining({ name: '读书', items: [{ url: 'https://b', title: 'B' }] })])
    expect(buildState(cacheOf([]), [create, makeDeleteOp(create.id, 'stash')]).stashes).toEqual([])
  })
})

describe('tag ops', () => {
  const cache = cacheOf(
    [bm('a', 'https://a', ['js', 'web']), bm('b', 'https://b', ['JavaScript']), bm('c', 'https://c')],
    [{ name: 'js', rank: 'a', pinned: true }, { name: 'javascript', rank: 'b', pinned: false }],
  )

  it('edits rank and pin; the untagged tag defaults to pinned', () => {
    const s = buildState(cache, [makeTagOp('JS', { rank: 'z' }), makeTagOp(UNTAGGED, { rank: '1' })])
    expect(s.tags.js).toEqual({ name: 'js', rank: 'z', pinned: true })
    expect(s.tags['']).toEqual({ name: '', rank: '1', pinned: true })
  })

  it('merges into an existing tag, which keeps its own meta', () => {
    const s = buildState(cache, [makeTagOp('js', { name: 'javascript' })])
    expect(s.bookmarks.find((b) => b.id === 'a')!.tags).toEqual(['javascript', 'web'])
    expect(s.tags).toEqual({ javascript: { name: 'javascript', rank: 'b', pinned: false } })
  })

  it('moves meta along with a plain rename', () => {
    const s = buildState(cache, [makeTagOp('js', { name: ' ECMAScript ' })])
    expect(s.bookmarks.find((b) => b.id === 'a')!.tags).toEqual(['ECMAScript', 'web'])
    expect(s.tags.ecmascript).toEqual({ name: 'ECMAScript', rank: 'a', pinned: true })
  })

  it('deletes a tag from every bookmark but keeps the bookmarks', () => {
    const s = buildState(cache, [makeDeleteOp('JS', 'tag')])
    expect(s.bookmarks.map((b) => b.tags)).toEqual([['web'], ['JavaScript'], []])
    expect(s.tags.js).toBeUndefined()
  })
})

describe('mergePull', () => {
  it('applies upserts and tombstones incrementally, replaces on full, always replaces tag meta', () => {
    const cache = cacheOf([bm('a', 'https://a'), bm('b', 'https://b')], [{ name: 'old', rank: 'V', pinned: true }])
    const inc = mergePull(cache, {
      version: 4,
      full: false,
      bookmarks: [{ ...bm('b', ''), deleted_at: 9 }, bm('c', 'https://c')],
      stashes: [{ id: 's', name: '', items: [], created_at: 1, updated_at: 1 }],
      tags: [{ name: 'Go', rank: 'k', pinned: false }],
    })
    expect(Object.keys(inc.bookmarks).sort()).toEqual(['a', 'c'])
    expect(Object.keys(inc.stashes)).toEqual(['s'])
    expect(inc.tags).toEqual({ go: { name: 'Go', rank: 'k', pinned: false } })
    expect(inc.version).toBe(4)

    const full = mergePull(cache, { version: 5, full: true, bookmarks: [bm('z', 'https://z')], stashes: [], tags: [] })
    expect(Object.keys(full.bookmarks)).toEqual(['z'])
  })
})

describe('tag list, related tags and filtering', () => {
  const view = [
    bm('a', 'https://go.dev', ['技术', '后端', 'Go']),
    bm('b', 'https://react.dev', ['技术', '前端']),
    bm('c', 'https://vite.dev', ['技术', '前端', '工具']),
    bm('d', 'https://x.com'),
    bm('e', 'https://y.com'),
  ]
  const meta = cacheOf([], [
    { name: '前端', rank: 'k', pinned: true },
    { name: '技术', rank: 'G', pinned: true },
    { name: '后端', rank: 'V', pinned: false },
    { name: 'Go', rank: 'X', pinned: false },
  ]).tags

  it('orders by rank: untagged first until moved, unranked last by name', () => {
    const list = buildTagList(view, meta)
    expect(list.map((t) => [t.name, t.count, t.pinned])).toEqual([
      ['', 2, true],
      ['技术', 3, true],
      ['后端', 1, false],
      ['Go', 1, false],
      ['前端', 2, true],
      ['工具', 1, false],
    ])
    const moved = buildTagList(view, { ...meta, '': { name: '', rank: 'z', pinned: false } })
    expect(moved.map((t) => t.name).slice(-2)).toEqual(['', '工具'])
  })

  it('offers only tags overlapping the results, counted within them', () => {
    const list = buildTagList(view, meta)
    const results = filterBookmarks(view, '', ['技术'])
    expect(relatedTags(results, ['技术'], list).map((t) => [t.name, t.count])).toEqual([['后端', 1], ['Go', 1], ['前端', 2], ['工具', 1]])
    expect(relatedTags(filterBookmarks(view, '', ['前端']), ['前端'], list).map((t) => t.name)).toEqual(['技术', '工具'])
  })

  it('ANDs selections; the untagged tag matches bookmarks without tags', () => {
    expect(ids(filterBookmarks(view, '', ['技术', '前端']))).toEqual(['b', 'c'])
    expect(ids(filterBookmarks(view, '', ['技术', 'go']))).toEqual(['a'])
    expect(ids(filterBookmarks(view, '', [UNTAGGED]))).toEqual(['d', 'e'])
    expect(ids(filterBookmarks(view, 'react', []))).toEqual(['b'])
  })
})

describe('rankForTags', () => {
  const ordered = [
    bm('a', 'https://a', ['技术', 'Go'], 1, 'G'),
    bm('b', 'https://b', ['技术', '前端'], 1, 'V'),
    bm('c', 'https://c', ['技术', '前端'], 1, 'X'),
    bm('d', 'https://d', ['技术'], 1, 'k'),
  ]

  it('goes right after the last bookmark of the most specific tag', () => {
    const r = rankForTags(ordered, ['技术', '前端'])
    expect(r > 'X' && r < 'k').toBe(true)
    const g = rankForTags(ordered, ['go', '前端'])
    expect(g > 'G' && g < 'V').toBe(true)
  })

  it('goes to the end without tags or for new tags', () => {
    expect(rankForTags(ordered, []) > 'k').toBe(true)
    expect(rankForTags(ordered, ['新标签']) > 'k').toBe(true)
    expect(rankForTags([], ['x'])).toBe('V')
  })
})

describe('rank', () => {
  it('always finds a key between neighbours, staying ordered', () => {
    const keys: string[] = []
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 300; i++) {
      const at = Math.floor(rand() * (keys.length + 1))
      const k = rankBetween(keys[at - 1], keys[at])
      if (at > 0) expect(k > keys[at - 1]).toBe(true)
      if (at < keys.length) expect(k < keys[at]).toBe(true)
      expect(k).toMatch(/^[0-9A-Za-z]*[1-9A-Za-z]$/)
      keys.splice(at, 0, k)
    }
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(20)
  })

  it('appends repeatedly without throwing, and survives equal neighbours', () => {
    let last: string | undefined
    for (let i = 0; i < 100; i++) {
      const k = rankBetween(last, null)
      if (last) expect(k > last).toBe(true)
      last = k
    }
    expect(rankBetween('V', 'V') > 'V').toBe(true)
  })

  it('generates short evenly spaced sequences after an existing key', () => {
    const seq = rankSequence('V', 900)
    expect(seq.every((k, i) => k > 'V' && (i === 0 || k > seq[i - 1]))).toBe(true)
    expect(Math.max(...seq.map((k) => k.length))).toBeLessThanOrEqual(3)
    expect(rankSequence(null, 3)).toEqual(['F', 'V', 'k'])
  })

  it('breaks rank ties by id', () => {
    const items = [{ id: 'b', rank: 'V' }, { id: 'a', rank: 'V' }, { id: 'c', rank: 'G' }]
    expect(items.sort(compareRank).map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('sortBookmarks', () => {
  const list = [
    { ...bm('a', 'https://b.com/', [], 1, 'k'), title: '苹果' },
    { ...bm('b', 'https://a.com', [], 3, 'G'), title: 'Banana' },
    { ...bm('c', 'https://c.com', [], 2, 'V'), title: 'apple 10' },
    { ...bm('d', 'https://d.com', [], 4, 'V'), title: 'apple 9' },
  ]

  it('sorts by the global order, equal ranks by age', () => {
    expect(ids(sortBookmarks(list, 'default'))).toEqual(['b', 'c', 'd', 'a'])
  })
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
  const tree: TreeNode[] = [{
    title: '',
    children: [
      {
        id: '1',
        title: '书签栏',
        children: [
          { title: 'Top', url: 'https://top.com' },
          { title: '技术', children: [{ title: 'Go', children: [{ title: 'Go docs', url: 'https://go.dev' }] }, { title: 'misc', url: 'https://t.com' }] },
          { title: 'bookmarklet', url: 'javascript:void(0)' },
          { title: 'A/B 测试', children: [{ title: 'ab', url: 'https://ab.com' }] },
        ],
      },
      {
        id: '2',
        title: '其他书签',
        children: [
          { title: '', url: 'https://other.com' },
          { title: '杂项', children: [] },
          { title: 'go', children: [{ title: 'x', url: 'https://x.com' }] },
        ],
      },
    ],
  }]

  it('turns every folder on the path into a flat tag, in depth-first order', () => {
    const plan = flattenTree(tree)
    expect(plan.items.map((i) => [i.url, i.tags])).toEqual([
      ['https://top.com', []],
      ['https://go.dev', ['技术', 'Go']],
      ['https://t.com', ['技术']],
      ['https://ab.com', ['A/B 测试']],
      ['https://other.com', []],
      ['https://x.com', ['go']],
    ])
    // Folders on the bar become pinned tags; same-named folders share one tag; empty ones vanish.
    expect(plan.tags).toEqual([
      { name: '技术', pinned: true },
      { name: 'Go', pinned: false },
      { name: 'A/B 测试', pinned: true },
    ])
    expect(summarize(plan)).toEqual({ total: 6, tags: 3, pinned: 2, untagged: 2, stashed: 0 })
  })

  it('sends selected folders to the stash instead of importing them', () => {
    // Keys are index paths: root 0 -> 书签栏 0.0 -> 技术 0.0.1; 其他书签 0.1.
    const keys = folderTree(tree).map((f) => [f.key, f.title, f.count, f.children.map((c) => c.key)])
    expect(keys).toEqual([['0.0', '书签栏', 4, ['0.0.1', '0.0.3']], ['0.1', '其他书签', 2, ['0.1.2']]])

    const plan = flattenTree(tree, new Set(['0.0.1', '0.1']))
    expect(plan.items.map((i) => i.url)).toEqual(['https://top.com', 'https://ab.com'])
    expect(plan.stashes).toEqual([
      { name: '技术', items: [{ url: 'https://go.dev', title: 'Go docs' }, { url: 'https://t.com', title: 'misc' }] },
      { name: '其他书签', items: [{ url: 'https://other.com', title: 'https://other.com' }, { url: 'https://x.com', title: 'x' }] },
    ])
    expect(plan.tags.map((t) => t.name)).toEqual(['A/B 测试'])
    expect(summarize(plan)).toMatchObject({ total: 2, stashed: 4 })
  })

  it('ranks the import after existing data', () => {
    const { items, tags } = rankImport(flattenTree(tree), { lastBookmarkRank: 'V', firstTagRank: 'G', lastTagRank: 'k' })
    expect(items.every((it, i) => it.rank > 'V' && (i === 0 || it.rank > items[i - 1].rank))).toBe(true)
    expect(tags[0]).toMatchObject({ name: '', pinned: true })
    expect(tags[0].rank < 'G').toBe(true)
    expect(tags.slice(1).every((t, i) => t.rank > 'k' && (i === 0 || t.rank > tags[i].rank))).toBe(true)
  })

  it('never stamps bookmarks without dateAdded with the current time', () => {
    const dated: TreeNode[] = [{
      title: '',
      children: [{
        title: '书签栏',
        children: [
          { title: 'orphan', url: 'https://orphan.com' },
          {
            title: '吉他',
            dateAdded: 100,
            children: [
              { title: 'first', url: 'https://first.com' },
              { title: 'a', url: 'https://a.com', dateAdded: 300 },
              { title: 'b', url: 'https://b.com', dateAdded: 0 },
              { title: 'c', url: 'https://c.com', dateAdded: 500 },
            ],
          },
        ],
      }],
    }]
    const dates = Object.fromEntries(flattenTree(dated).items.map((i) => [i.url, i.created_at]))
    expect(dates).toEqual({
      'https://orphan.com': 1,
      'https://first.com': 100,
      'https://a.com': 300,
      'https://b.com': 300,
      'https://c.com': 500,
    })
  })
})

describe('parseBookmarksHtml', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1741152341" LAST_MODIFIED="1791703489" PERSONAL_TOOLBAR_FOLDER="true">收藏夹栏</H3>
    <DL><p>
        <DT><H3 ADD_DATE="1721461271">PT &amp; BT</H3>
        <DL><p>
            <DT><A HREF="https://a.com/?x=1&amp;y=2" ADD_DATE="1689615354" ICON="data:image/png;base64,AAA">A &lt;1&gt;</A>
            <DT><H3 ADD_DATE="1">深层</H3>
            <DL><p>
                <DT><A HREF="https://deep.com">Deep</A>
            </DL><p>
        </DL><p>
        <DT><A HREF="https://top.com" ADD_DATE="1700000000">Top &#39;quoted&#39;</A>
    </DL><p>
    <DT><A HREF="https://loose.com" ADD_DATE="1600000000">Loose</A>
    <DT><H3>其他文件夹</H3>
    <DL><p>
        <DT><A HREF="https://other.com">Other</A>
    </DL><p>
</DL><p>`

  it('rebuilds the tree, decoding entities and converting dates to ms', () => {
    const plan = flattenTree(parseBookmarksHtml(html))
    expect(plan.items).toEqual([
      { url: 'https://a.com/?x=1&y=2', title: 'A <1>', tags: ['PT & BT'], created_at: 1689615354000, favicon: 'data:image/png;base64,AAA' },
      { url: 'https://deep.com', title: 'Deep', tags: ['PT & BT', '深层'], created_at: 1000 },
      { url: 'https://top.com', title: "Top 'quoted'", tags: [], created_at: 1700000000000 },
      { url: 'https://loose.com', title: 'Loose', tags: [], created_at: 1600000000000 },
      // Undated folder: inherits the previous sibling's date.
      { url: 'https://other.com', title: 'Other', tags: ['其他文件夹'], created_at: 1600000000000 },
    ])
    expect(plan.tags).toEqual([
      { name: 'PT & BT', pinned: true },
      { name: '深层', pinned: false },
      { name: '其他文件夹', pinned: false },
    ])
  })
})
