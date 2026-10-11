import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Favicon } from '../components/Favicon'
import { Highlight } from '../components/Highlight'
import { ArchiveIcon, ChevronRightIcon, EditIcon, ExternalLinkIcon, StarIcon, TrashIcon, XIcon } from '../components/icons'
import { send } from '../lib/messages'
import { makeDeleteOp, makeStashUpdateOp } from '../lib/ops'
import { defaultStashName, filterStashes, stashLabel, TABS_PERMISSION } from '../lib/stash'
import type { Stash, StashItem } from '../lib/types'
import { Toolbar } from './Toolbar'

interface Props {
  stashes: Stash[]
  query: string
  /** URLs that are already bookmarked. */
  saved: Set<string>
  /** Expanded groups. */
  open: Set<string>
  onToggle(id: string): void
  notify(msg: string): void
}

export function StashView({ stashes, query, saved, open, onToggle, notify }: Props) {
  const [busy, setBusy] = useState(false)
  const searching = query.trim() !== ''
  const matches = useMemo(() => filterStashes(stashes, query), [stashes, query])

  const stashWindow = async () => {
    // Request inside the click gesture. Chrome may close the popup while prompting;
    // the user then simply clicks again.
    const granted = await chrome.permissions.request(TABS_PERMISSION).catch(() => false)
    if (!granted) return notify('需要授权读取标签页才能暂存')
    setBusy(true)
    try {
      const win = await chrome.windows.getCurrent()
      const res = await send({ type: 'stashWindow', windowId: win.id ?? chrome.windows.WINDOW_ID_CURRENT })
      if (res.status === 'stashed') notify(`已暂存 ${res.count} 个标签页`)
      else if (res.status === 'empty') notify('当前窗口没有可暂存的网页')
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const total = stashes.reduce((n, s) => n + s.items.length, 0)
  const found = matches.reduce((n, m) => n + m.hits.length, 0)
  const summary = (
    <>
      <span className="font-semibold text-forest dark:text-mint">暂存区</span>
      {' · '}
      {searching ? `找到 ${found} 个标签页` : stashes.length ? `${stashes.length} 组 · ${total} 个标签页` : '空'}
    </>
  )

  return (
    <>
      <Toolbar summary={summary}>
        <button className="tool-btn h-6" disabled={busy} onClick={() => void stashWindow()}>
          <ArchiveIcon width={13} height={13} />
          <span className="text-box-cap">暂存当前窗口</span>
        </button>
      </Toolbar>
      <ul className="scroll-area mx-3 mt-2 flex-1 space-y-2 pb-2">
        {matches.map(({ stash: s, hits }) => (
          <StashCard
            key={s.id}
            stash={s}
            hits={hits}
            query={query}
            saved={saved}
            open={searching || open.has(s.id)}
            onToggle={searching ? undefined : () => onToggle(s.id)}
            notify={notify}
          />
        ))}
        {stashes.length === 0 && (
          <li className="py-16 text-center text-sm text-charcoal/40 dark:text-zinc-500">暂存区是空的。右键网页或工具栏图标，选择「暂存当前窗口的所有标签页」</li>
        )}
        {stashes.length > 0 && matches.length === 0 && (
          <li className="py-16 text-center text-sm text-charcoal/40 dark:text-zinc-500">没有匹配的暂存标签页</li>
        )}
      </ul>
    </>
  )
}

function StashCard({ stash: s, hits, query, saved, open, onToggle, notify }: {
  stash: Stash
  /** Indices of the items to show. */
  hits: number[]
  query: string
  saved: Set<string>
  open: boolean
  /** Absent while searching: matching groups stay expanded. */
  onToggle?(): void
  notify(msg: string): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const partial = hits.length < s.items.length

  const openAll = () => {
    for (const i of hits) void chrome.tabs.create({ url: s.items[i].url, active: false })
    notify(`已打开 ${hits.length} 个标签页`)
  }

  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true)
    void send({ type: 'ops', ops: [makeDeleteOp(s.id, 'stash')] })
  }

  const removeItem = (index: number) => {
    const items = s.items.filter((_, i) => i !== index)
    void send({ type: 'ops', ops: [items.length ? makeStashUpdateOp(s.id, { items }) : makeDeleteOp(s.id, 'stash')] })
  }

  const rename = (raw: string) => {
    setRenaming(false)
    // Clearing the name falls back to the creation time, like a new group.
    const name = raw.trim() || defaultStashName(s.created_at)
    if (name !== s.name) void send({ type: 'ops', ops: [makeStashUpdateOp(s.id, { name })] })
  }

  const hoverOnly = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'

  return (
    <li className="overflow-hidden rounded-lg border border-sage bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className={`group flex items-center gap-1.5 py-1.5 pr-2 pl-1.5 ${open ? 'border-b border-sage bg-sage/40 dark:border-zinc-800 dark:bg-zinc-800/40' : ''}`}
      >
        {renaming ? (
          <input
            className="input h-7 min-w-0 flex-1 py-0 text-sm"
            defaultValue={stashLabel(s)}
            maxLength={200}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <>
            <button
              className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${onToggle ? '' : 'cursor-default'}`}
              onClick={onToggle}
              aria-expanded={open}
              title={onToggle ? (open ? '收起' : '展开') : undefined}
            >
              <ChevronRightIcon width={14} height={14} className={`shrink-0 text-charcoal/40 transition dark:text-zinc-500 ${open ? 'rotate-90' : ''}`} />
              <span className="truncate text-sm font-medium text-forest dark:text-zinc-100">
                <Highlight text={stashLabel(s)} query={query} />
              </span>
              <span className="shrink-0 text-xs text-charcoal/45 dark:text-zinc-500">{partial ? `${hits.length}/${s.items.length}` : s.items.length}</span>
            </button>
            <button className={`btn-ghost shrink-0 p-1 ${hoverOnly}`} title="重命名" onClick={() => setRenaming(true)}>
              <EditIcon width={14} height={14} />
            </button>
          </>
        )}
        <button
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-mint/45 py-1 pr-2 pl-1.5 text-xs font-medium text-forest transition hover:bg-forest hover:text-white dark:bg-mint/15 dark:text-mint dark:hover:bg-mint dark:hover:text-forest"
          title="在新标签页中打开"
          onClick={openAll}
        >
          <ExternalLinkIcon width={12} height={12} />
          {partial ? `打开 ${hits.length} 个` : '全部打开'}
        </button>
        <button
          className={`btn-danger shrink-0 p-1 ${confirmDelete ? 'bg-red-50 px-2 text-xs dark:bg-red-950' : hoverOnly}`}
          title="删除这组暂存"
          onClick={remove}
        >
          {confirmDelete ? '确认删除' : <TrashIcon width={14} height={14} />}
        </button>
      </div>
      {open && (
        <ul className="px-1 py-1">
          {hits.map((i) => {
            const it = s.items[i]
            return <StashRow key={`${i}-${it.url}`} item={it} query={query} saved={saved.has(it.url)} onRemove={() => removeItem(i)} notify={notify} />
          })}
        </ul>
      )}
    </li>
  )
}

function StashRow({ item, query, saved, onRemove, notify }: { item: StashItem; query: string; saved: boolean; onRemove(): void; notify(msg: string): void }) {
  const open = (e: MouseEvent) => {
    const background = e.ctrlKey || e.metaKey || e.button === 1
    void chrome.tabs.create({ url: item.url, active: !background })
    if (!background) window.close()
  }

  const bookmark = async () => {
    try {
      const res = await send({ type: 'add', url: item.url, title: item.title })
      notify(res.status === 'exists' ? '该页面已收藏' : '已收藏')
    } catch (e) {
      notify((e as Error).message)
    }
  }

  return (
    <li className="group hover-row flex items-center gap-2.5 rounded-md px-2 py-0.5">
      <Favicon url={item.url} size={16} />
      <button className="min-w-0 flex-1 -translate-y-px truncate py-0.5 text-left text-sm leading-5" onClick={open} onAuxClick={open} title={`${item.title}\n${item.url}`}>
        <Highlight text={item.title || item.url} query={query} />
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          className={`btn-ghost p-1 ${saved ? 'text-amber-500' : ''}`}
          title={saved ? '已收藏' : '收藏为书签'}
          disabled={saved}
          onClick={() => void bookmark()}
        >
          <StarIcon width={14} height={14} fill={saved ? 'currentColor' : 'none'} />
        </button>
        <button className="btn-ghost p-1" title="从暂存区移除" onClick={onRemove}>
          <XIcon width={14} height={14} />
        </button>
      </div>
    </li>
  )
}
