import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ComfortableIcon, CompactIcon, PlusIcon, SearchIcon } from '../components/icons'
import { useStorage } from '../components/useStorage'
import { HISTORY_PERMISSION, useVisitCounts } from '../components/useVisitCounts'
import { send } from '../lib/messages'
import { buildView, countTags, filterBookmarks, sortBookmarks, visitKey, type SortKey } from '../lib/ops'
import { getItem, isConfigured, setItem, type PopupState } from '../lib/storage'
import { BookmarkItem } from './BookmarkItem'
import { SortSwitch } from './SortSwitch'
import { TagBar } from './TagBar'

const PAGE_SIZE = 100
const SAVE_DELAY_MS = 150

export function App() {
  const cache = useStorage('cache')
  const outbox = useStorage('outbox')
  const settings = useStorage('settings')
  const prefs = useStorage('prefs')

  const [restored, setRestored] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const listRef = useRef<HTMLUListElement>(null)
  const pendingScroll = useRef<number | null>(null)
  const scrollTop = useRef(0)

  useEffect(() => {
    void send({ type: 'sync' }).catch(() => undefined)
    void getItem('popupState').then((s) => {
      setQuery(s.query)
      setSelected(s.tags)
      setLimit(Math.max(PAGE_SIZE, s.limit))
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

  const view = useMemo(() => (cache && outbox ? buildView(cache, outbox) : []), [cache, outbox])
  const tags = useMemo(() => countTags(view), [view])
  const filtered = useMemo(() => filterBookmarks(view, query, selected), [view, query, selected])

  const sort = prefs?.sort ?? 'added'
  const { visits, granted: historyGranted } = useVisitCounts(sort === 'visits')
  const needsHistory = sort === 'visits' && historyGranted === false
  const effectiveSort: SortKey = needsHistory ? 'added' : sort
  const sorted = useMemo(() => sortBookmarks(filtered, effectiveSort, visits), [filtered, effectiveSort, visits])
  // Visit-ordered lists reshuffle once history loads; restore scroll only after that.
  const orderSettled = effectiveSort !== 'visits' || visits !== undefined

  // ---- persistence of the popup view ----

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef<Omit<PopupState, 'scrollTop'>>({ query: '', tags: [], limit: PAGE_SIZE })
  latest.current = { query, tags: selected, limit }
  // Scrolling doesn't re-render, so read the live scroll ref at save time.
  const persist = () => void setItem('popupState', { ...latest.current, scrollTop: scrollTop.current })

  const scheduleSave = () => {
    if (!restored) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, SAVE_DELAY_MS)
  }

  useEffect(scheduleSave, [query, selected, limit, restored])

  useEffect(() => {
    // The popup can close at any moment; flush on hide as a best effort.
    const flush = () => restored && persist()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [restored])

  // The list only mounts once every storage key has loaded, which may happen on a render
  // where `sorted` didn't change, so mounting itself must re-trigger the restore.
  const listMounted = !!(cache && outbox && settings && prefs && restored && isConfigured(settings))

  useLayoutEffect(() => {
    const el = listRef.current
    if (pendingScroll.current === null || !el || !orderSettled || sorted.length === 0) return
    el.scrollTop = pendingScroll.current
    pendingScroll.current = null
  }, [listMounted, sorted, orderSettled])

  /** User-initiated changes to the result set start from the top again. */
  const resetPosition = () => {
    setLimit(PAGE_SIZE)
    pendingScroll.current = null
    scrollTop.current = 0
    if (listRef.current) listRef.current.scrollTop = 0
  }

  const updateQuery = (q: string) => {
    setQuery(q)
    resetPosition()
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
    const names = new Set(tags.map((t) => t.name.toLowerCase()))
    setSelected((s) => (s.every((t) => names.has(t.toLowerCase())) ? s : s.filter((t) => names.has(t.toLowerCase()))))
  }, [tags, cache, outbox, restored])

  const addCurrent = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) return setToast('无法获取当前页面')
    try {
      const res = await send({ type: 'add', url: tab.url, title: tab.title ?? tab.url, favicon: tab.favIconUrl })
      if (res.status === 'added') {
        setToast('已添加')
        setEditing(res.id)
      } else if (res.status === 'exists') {
        setToast('该页面已收藏')
        setEditing(res.id)
      }
    } catch (e) {
      setToast((e as Error).message)
    }
  }

  if (!cache || !outbox || !settings || !prefs || !restored) return <div className="h-[560px] w-[380px]" />

  if (!isConfigured(settings)) {
    return (
      <div className="flex h-[560px] w-[380px] flex-col items-center justify-center gap-3 px-8 text-center text-sm text-zinc-500">
        <p>尚未连接服务端，请先填写服务端地址和 Token。</p>
        <button className="btn-primary" onClick={() => chrome.runtime.openOptionsPage()}>
          前往设置
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex h-[560px] w-[380px] flex-col select-none">
      <div className="space-y-2 px-3 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
            <input
              className="input pl-9"
              placeholder="搜索标题、链接或标签"
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
            />
          </div>
          <button className="btn-ghost p-2" title="收藏当前页面" onClick={addCurrent}>
            <PlusIcon />
          </button>
        </div>
        <TagBar tags={tags} selected={selected} onChange={updateSelected} />
        <div className="flex items-center justify-between">
          <SortSwitch value={sort} onChange={(k) => void changeSort(k)} />
          <div className="flex items-center gap-2">
            {needsHistory && (
              <button className="text-xs text-indigo-600 hover:underline" onClick={() => void changeSort('visits')}>
                授权读取历史记录
              </button>
            )}
            <button
              className="btn-ghost p-1.5"
              title={compact ? '切换到标准视图' : '切换到紧凑视图'}
              aria-pressed={compact}
              onClick={toggleCompact}
            >
              {compact ? <ComfortableIcon width={14} height={14} /> : <CompactIcon width={14} height={14} />}
            </button>
          </div>
        </div>
      </div>

      <ul
        ref={listRef}
        className="scroll-area mx-3 mt-2 flex-1 pb-2"
        onScroll={(e) => {
          const el = e.currentTarget
          scrollTop.current = el.scrollTop
          scheduleSave()
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && limit < sorted.length) setLimit((l) => l + PAGE_SIZE)
        }}
      >
        {sorted.slice(0, limit).map((b) => (
          <BookmarkItem
            key={b.id}
            bookmark={b}
            compact={compact}
            visits={effectiveSort === 'visits' ? (visits?.get(visitKey(b.url)) ?? 0) : undefined}
            pending={outbox.some((o) => o.bookmark_id === b.id)}
            editing={editing === b.id}
            allTags={tags.map((t) => t.name)}
            onEdit={() => setEditing(b.id)}
            onDone={() => setEditing(null)}
            onTagClick={(t) => updateSelected((s) => (s.some((x) => x.toLowerCase() === t.toLowerCase()) ? s : [...s, t]))}
          />
        ))}
        {filtered.length === 0 && (
          <li className="py-16 text-center text-sm text-zinc-400">
            {view.length === 0 ? '还没有书签，右键网页即可添加' : '没有匹配的书签'}
          </li>
        )}
      </ul>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <span className="rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900">{toast}</span>
        </div>
      )}
    </div>
  )
}
