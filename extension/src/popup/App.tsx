import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArchiveIcon, ComfortableIcon, CompactIcon, PlusIcon, SearchIcon, XIcon } from '../components/icons'
import { useDragReorder } from '../components/useDragReorder'
import { useStorage } from '../components/useStorage'
import { HISTORY_PERMISSION, useVisitCounts } from '../components/useVisitCounts'
import { send } from '../lib/messages'
import { buildState, filterBookmarks, makeUpdateOp, sortBookmarks, visitKey, type SortKey } from '../lib/ops'
import { rankBetween } from '../lib/rank'
import { getItem, isConfigured, setItem, type PopupState, type PopupTab } from '../lib/storage'
import { buildTagList, relatedTags, tagKey } from '../lib/tags'
import { BookmarkItem } from './BookmarkItem'
import { SortMenu } from './SortMenu'
import { StashView } from './StashView'
import { TagBar } from './TagBar'
import { Toolbar } from './Toolbar'

const SAVE_DELAY_MS = 150

export function App() {
  const cache = useStorage('cache')
  const outbox = useStorage('outbox')
  const settings = useStorage('settings')
  const prefs = useStorage('prefs')

  const [restored, setRestored] = useState(false)
  const [tab, setTab] = useState<PopupTab>('all')
  const [queries, setQueries] = useState<Record<PopupTab, string>>({ all: '', stash: '' })
  const [selected, setSelected] = useState<string[]>([])
  const [stashOpen, setStashOpen] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pendingScroll = useRef<number | null>(null)
  const scrollTop = useRef(0)

  useEffect(() => {
    void send({ type: 'sync' }).catch(() => undefined)
    void getItem('popupState').then((s) => {
      setTab(s.tab === 'stash' ? 'stash' : 'all')
      setQueries({ all: s.queries?.all ?? '', stash: s.queries?.stash ?? '' })
      setSelected(s.tags)
      setStashOpen(s.stashOpen)
      scrollTop.current = s.scrollTop
      pendingScroll.current = s.scrollTop
      setRestored(true)
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const state = useMemo(() => (cache && outbox ? buildState(cache, outbox) : { bookmarks: [], stashes: [], tags: {} }), [cache, outbox])
  const view = state.bookmarks
  const tags = useMemo(() => buildTagList(view, state.tags), [view, state.tags])
  const tagNames = useMemo(() => tags.filter((t) => !t.virtual).map((t) => t.name), [tags])
  const query = queries[tab]
  const filtered = useMemo(() => filterBookmarks(view, queries.all, selected), [view, queries.all, selected])
  const related = useMemo(() => (selected.length ? relatedTags(filtered, selected, tags) : []), [filtered, selected, tags])

  const sort = prefs?.sort ?? 'default'
  const { visits, granted: historyGranted } = useVisitCounts(tab === 'all' && sort === 'visits')
  const needsHistory = sort === 'visits' && historyGranted === false
  const effectiveSort: SortKey = needsHistory ? 'added' : sort
  const sorted = useMemo(() => sortBookmarks(filtered, effectiveSort, visits), [filtered, effectiveSort, visits])
  // Visit-ordered lists reshuffle once history loads; restore scroll only after that.
  const orderSettled = effectiveSort !== 'visits' || visits !== undefined

  // ---- persistence of the popup view ----

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef<Omit<PopupState, 'scrollTop'>>({ tab: 'all', queries: { all: '', stash: '' }, tags: [], stashOpen: [] })
  latest.current = { tab, queries, tags: selected, stashOpen }
  // Scrolling doesn't re-render, so read the live scroll ref at save time.
  const persist = () => void setItem('popupState', { ...latest.current, scrollTop: scrollTop.current })

  const scheduleSave = () => {
    if (!restored) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, SAVE_DELAY_MS)
  }

  useEffect(scheduleSave, [tab, queries, selected, stashOpen, restored])

  useEffect(() => {
    // The popup can close at any moment; flush on hide as a best effort.
    const flush = () => restored && persist()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [restored])

  // The list only mounts once every storage key has loaded, which may happen on a render
  // where `sorted` didn't change, so mounting itself must re-trigger the restore.
  const listMounted = !!(cache && outbox && settings && prefs && restored && isConfigured(settings) && tab === 'all')

  useLayoutEffect(() => {
    const el = listRef.current
    if (pendingScroll.current === null || !el || !orderSettled || sorted.length === 0) return
    el.scrollTop = pendingScroll.current
    pendingScroll.current = null
  }, [listMounted, sorted, orderSettled])

  /** User-initiated changes to the result set start from the top again. */
  const resetPosition = () => {
    pendingScroll.current = null
    scrollTop.current = 0
    if (listRef.current) listRef.current.scrollTop = 0
  }

  const switchTab = (next: PopupTab) => {
    // Coming back to the list restores where it was left.
    if (next === 'all' && tab !== 'all') pendingScroll.current = scrollTop.current
    setEditing(null)
    setTab(next)
    searchRef.current?.focus()
  }

  const updateQuery = (q: string) => {
    setQueries((qs) => ({ ...qs, [tab]: q }))
    if (tab === 'all') resetPosition()
  }

  const updateSelected = (next: string[] | ((s: string[]) => string[])) => {
    setSelected(next)
    resetPosition()
  }

  const compact = prefs?.compact ?? false

  const toggleCompact = () => {
    resetPosition()
    void setItem('prefs', { sort, ...prefs, compact: !compact })
  }

  const changeSort = async (key: SortKey) => {
    // Request first so it runs inside the click gesture; the popup may close while
    // Chrome shows the prompt, so persist the choice before awaiting the answer.
    const request = key === 'visits' ? chrome.permissions.request(HISTORY_PERMISSION) : null
    resetPosition()
    await setItem('prefs', { compact, ...prefs, sort: key })
    if (request && !(await request.catch(() => false))) {
      setToast('未授权读取历史记录，暂按最近添加排序')
    }
  }

  // Drop selections for tags that no longer exist (e.g. after deleting the last bookmark).
  useEffect(() => {
    if (!cache || !outbox || !restored) return
    const keys = new Set(tags.map((t) => t.key))
    setSelected((s) => (s.every((t) => keys.has(tagKey(t))) ? s : s.filter((t) => keys.has(tagKey(t)))))
  }, [tags, cache, outbox, restored])

  const showTag = (t: string) => updateSelected((s) => (s.some((x) => tagKey(x) === tagKey(t)) ? s : [...s, t]))

  const pending = useMemo(() => new Set(outbox?.filter((o) => o.entity === 'bookmark').map((o) => o.id)), [outbox])
  const byId = useMemo(() => new Map(view.map((b) => [b.id, b])), [view])
  // Manual order is the global order, so it can only be edited while viewing it.
  const reorder = useDragReorder(
    sorted.map((b) => b.id),
    (id, prev, next) => {
      const rank = rankBetween(prev && byId.get(prev)?.rank, next && byId.get(next)?.rank)
      void send({ type: 'ops', ops: [makeUpdateOp(id, { rank })] })
    },
    effectiveSort === 'default' && editing === null,
  )

  const addCurrent = async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!active?.url) return setToast('无法获取当前页面')
    try {
      const res = await send({ type: 'add', url: active.url, title: active.title ?? active.url, favicon: active.favIconUrl })
      if (res.status === 'unconfigured') return
      setToast(res.status === 'added' ? '已添加' : '该页面已收藏')
      switchTab('all')
      setEditing(res.id)
    } catch (e) {
      setToast((e as Error).message)
    }
  }

  if (!cache || !outbox || !settings || !prefs || !restored) return <div className="h-[560px] w-[380px]" />

  if (!isConfigured(settings)) {
    return (
      <div className="flex h-[560px] w-[380px] flex-col items-center justify-center gap-3 px-8 text-center text-sm text-charcoal/60 dark:text-zinc-400">
        <p>尚未连接服务端，请先填写服务端地址和 Token。</p>
        <button className="btn-primary" onClick={() => chrome.runtime.openOptionsPage()}>
          前往设置
        </button>
      </div>
    )
  }

  const inStash = tab === 'stash'
  const stashCount = state.stashes.length
  const LeadIcon = inStash ? ArchiveIcon : SearchIcon

  return (
    <div className="relative flex h-[560px] w-[380px] flex-col bg-white select-none dark:bg-zinc-900">
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <div className="relative min-w-0 flex-1">
          <LeadIcon
            width={15}
            height={15}
            className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 ${inStash ? 'text-forest dark:text-mint' : 'text-charcoal/40 dark:text-zinc-500'}`}
          />
          <input
            ref={searchRef}
            className="input pr-8 pl-9"
            placeholder={inStash ? '在暂存区中搜索' : '搜索书签标题、链接或标签'}
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                updateQuery('')
              }
            }}
            autoFocus
          />
          {query && (
            <button
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-charcoal/40 hover:bg-sage hover:text-charcoal dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              title="清空 (Esc)"
              onClick={() => {
                updateQuery('')
                searchRef.current?.focus()
              }}
            >
              <XIcon width={12} height={12} />
            </button>
          )}
        </div>
        <button
          className="icon-btn"
          aria-pressed={inStash}
          title={inStash ? '返回书签' : stashCount ? `打开暂存区（${stashCount} 组）` : '打开暂存区'}
          onClick={() => switchTab(inStash ? 'all' : 'stash')}
        >
          <ArchiveIcon width={16} height={16} />
          {!inStash && stashCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-forest px-1 text-center text-[10px] leading-4 font-medium text-white ring-2 ring-white dark:bg-mint dark:text-forest dark:ring-zinc-900">
              {stashCount > 99 ? '99+' : stashCount}
            </span>
          )}
        </button>
        <button className="icon-btn" title="收藏当前页面" onClick={addCurrent}>
          <PlusIcon width={16} height={16} />
        </button>
      </div>

      {tab === 'all' && (
        <>
          {tags.length > 0 && (
            <div className="px-3 pt-2.5">
              <TagBar tags={tags} related={related} selected={selected} onChange={updateSelected} />
            </div>
          )}
          <Toolbar summary={queries.all.trim() || selected.length ? `找到 ${filtered.length} 个书签` : `${view.length} 个书签`}>
            {needsHistory && (
              <button className="tool-btn font-medium text-forest! dark:text-mint!" onClick={() => void changeSort('visits')}>
                授权历史记录
              </button>
            )}
            <SortMenu value={sort} onChange={(k) => void changeSort(k)} />
            <span className="mx-0.5 h-3 w-px bg-sage dark:bg-zinc-700" />
            <button className="tool-btn px-1!" title={compact ? '切换到标准视图' : '切换到紧凑视图'} aria-pressed={compact} onClick={toggleCompact}>
              {compact ? <ComfortableIcon width={13} height={13} /> : <CompactIcon width={13} height={13} />}
            </button>
          </Toolbar>

          <ul
            ref={listRef}
            className="scroll-area mx-3 mt-1.5 flex-1 pb-2"
            onScroll={(e) => {
              scrollTop.current = e.currentTarget.scrollTop
              scheduleSave()
            }}
          >
            {sorted.map((b, i) => (
              <BookmarkItem
                key={b.id}
                bookmark={b}
                compact={compact}
                query={queries.all}
                visits={effectiveSort === 'visits' ? (visits?.get(visitKey(b.url)) ?? 0) : undefined}
                pending={pending.has(b.id)}
                editing={editing === b.id}
                allTags={tagNames}
                onEdit={() => setEditing(b.id)}
                onDone={() => setEditing(null)}
                onTagClick={showTag}
                rowProps={reorder.rowProps(i)}
                rowClass={reorder.rowClass(i)}
              />
            ))}
            {filtered.length === 0 && (
              <li className="py-16 text-center text-sm text-charcoal/40 dark:text-zinc-500">
                {view.length === 0 ? '还没有书签，右键网页即可添加' : '没有匹配的书签'}
              </li>
            )}
          </ul>
        </>
      )}

      {tab === 'stash' && (
        <StashView
          stashes={state.stashes}
          query={queries.stash}
          saved={new Set(view.map((b) => b.url))}
          open={new Set(stashOpen)}
          onToggle={(id) =>
            setStashOpen((o) => {
              const alive = o.filter((x) => x !== id && state.stashes.some((st) => st.id === x))
              return o.includes(id) ? alive : [...alive, id]
            })
          }
          notify={setToast}
        />
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <span className="rounded-full bg-forest/95 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-mint/95 dark:text-forest">{toast}</span>
        </div>
      )}
    </div>
  )
}
