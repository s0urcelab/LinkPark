import { describe, expect, it } from 'vitest'
import { splitMatches } from './highlight'
import { filterStashes } from './stash'
import type { Stash } from './types'

const stash = (id: string, name: string, urls: string[]): Stash => ({
  id,
  name,
  items: urls.map((url) => ({ url, title: url.replace('https://', '') })),
  created_at: 1,
  updated_at: 1,
})

describe('filterStashes', () => {
  const list = [
    stash('a', '调研', ['https://github.com/yjs', 'https://crdt.tech', 'https://github.com/automerge']),
    stash('b', '周末', ['https://news.ycombinator.com']),
    stash('c', 'GitHub 收藏', ['https://example.com']),
  ]

  it('keeps everything without a query', () => {
    expect(filterStashes(list, '  ').map((m) => m.hits)).toEqual([[0, 1, 2], [0], [0]])
  })

  it('keeps matching items with their original indices and drops empty groups', () => {
    const res = filterStashes(list, 'GITHUB')
    expect(res.map((m) => [m.stash.id, m.hits])).toEqual([
      ['a', [0, 2]],
      ['c', [0]],
    ])
  })

  it('keeps every item of a group whose name matches', () => {
    expect(filterStashes(list, '周末')).toEqual([{ stash: list[1], hits: [0] }])
  })
})

describe('splitMatches', () => {
  it('marks every case-insensitive occurrence', () => {
    expect(splitMatches('Go and go', 'GO')).toEqual([
      { text: 'Go', match: true },
      { text: ' and ', match: false },
      { text: 'go', match: true },
    ])
  })

  it('treats the query literally', () => {
    expect(splitMatches('a.b axb', '.')).toEqual([
      { text: 'a', match: false },
      { text: '.', match: true },
      { text: 'b axb', match: false },
    ])
  })

  it('returns the text unchanged for a blank query', () => {
    expect(splitMatches('abc', ' ')).toEqual([{ text: 'abc', match: false }])
  })
})
