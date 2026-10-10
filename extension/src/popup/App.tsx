import { useEffect, useMemo, useState } from 'react'
import { PlusIcon, SearchIcon, SettingsIcon } from '../components/icons'
import { SyncIndicator } from '../components/SyncIndicator'
import { useStorage } from '../components/useStorage'
import { send } from '../lib/messages'
import { buildView, countTags, filterBookmarks } from '../lib/ops'
import { isConfigured } from '../lib/storage'
import { BookmarkItem } from './BookmarkItem'
import { TagBar } from './TagBar'

const PAGE_SIZE = 100

export function App() {
  const cache = useStorage('cache')
  const outbox = useStorage('outbox')
  const failed = useStorage('failed')
  const syncState = useStorage('syncState')
  const settings = useStorage('settings')

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    void send({ type: 'sync' }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const view = useMemo(() => (cache && outbox ? buildView(cache, outbox) : []), [cache, outbox])
  const tags = useMemo(() => countTags(view), [view])
  const filtered = useMemo(() => filterBookmarks(view, query, selected), [view, query, selected])

  useEffect(() => setLimit(PAGE_SIZE), [query, selected])

  // Drop selections for tags that no longer exist (e.g. after deleting the last bookmark).
  useEffect(() => {
    const names = new Set(tags.map((t) => t.name.toLowerCase()))
    setSelected((s) => (s.every((t) => names.has(t.toLowerCase())) ? s : s.filter((t) => names.has(t.toLowerCase()))))
  }, [tags])

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

  if (!cache || !outbox || !failed || !syncState || !settings) return <div className="h-[520px] w-[380px]" />

  const configured = isConfigured(settings)

  return (
    <div className="relative flex h-[560px] w-[380px] flex-col">
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-col">
          <span className="text-base font-semibold tracking-tight">LinkPark</span>
          <SyncIndicator state={configured ? syncState : { ...syncState, status: 'unconfigured' }} pending={outbox.length} failed={failed.length} />
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost p-2" title="收藏当前页面" onClick={addCurrent} disabled={!configured}>
            <PlusIcon />
          </button>
          <button className="btn-ghost p-2" title="设置" onClick={() => chrome.runtime.openOptionsPage()}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      {!configured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-sm text-zinc-500">
          <p>尚未连接服务端，请先填写服务端地址和 Token。</p>
          <button className="btn-primary" onClick={() => chrome.runtime.openOptionsPage()}>
            前往设置
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-4 pt-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
              <input className="input pl-9" placeholder="搜索标题、链接或标签" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            <TagBar tags={tags} selected={selected} onChange={setSelected} />
          </div>

          <ul
            className="mt-2 flex-1 overflow-y-auto px-2 pb-2"
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && limit < filtered.length) setLimit((l) => l + PAGE_SIZE)
            }}
          >
            {filtered.slice(0, limit).map((b) => (
              <BookmarkItem
                key={b.id}
                bookmark={b}
                pending={outbox.some((o) => o.bookmark_id === b.id)}
                editing={editing === b.id}
                allTags={tags.map((t) => t.name)}
                onEdit={() => setEditing(b.id)}
                onDone={() => setEditing(null)}
                onTagClick={(t) => setSelected((s) => (s.some((x) => x.toLowerCase() === t.toLowerCase()) ? s : [...s, t]))}
              />
            ))}
            {filtered.length === 0 && (
              <li className="py-16 text-center text-sm text-zinc-400">
                {view.length === 0 ? '还没有书签，右键网页即可添加' : '没有匹配的书签'}
              </li>
            )}
          </ul>

          <footer className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
            <span>
              {filtered.length === view.length ? `共 ${view.length} 个书签` : `${filtered.length} / ${view.length}`}
            </span>
            {syncState.notice && <span className="truncate pl-2">{syncState.notice}</span>}
          </footer>
        </>
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
          <span className="rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900">{toast}</span>
        </div>
      )}
    </div>
  )
}
