import { useEffect, useState, type MouseEvent } from 'react'
import { Favicon } from '../components/Favicon'
import { ArchiveIcon, ChevronRightIcon, EditIcon, StarIcon, TrashIcon, XIcon } from '../components/icons'
import { send } from '../lib/messages'
import { makeDeleteOp, makeStashUpdateOp } from '../lib/ops'
import { defaultStashName, stashLabel, TABS_PERMISSION } from '../lib/stash'
import type { Stash, StashItem } from '../lib/types'

interface Props {
  stashes: Stash[]
  /** URLs that are already bookmarked. */
  saved: Set<string>
  /** Expanded groups. */
  open: Set<string>
  onToggle(id: string): void
  notify(msg: string): void
}

export function StashView({ stashes, saved, open, onToggle, notify }: Props) {
  const [busy, setBusy] = useState(false)

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

  return (
    <>
      <div className="mx-3 mt-2 flex items-center justify-between px-2">
        <span className="text-xs text-zinc-500">{stashes.length > 0 ? `${stashes.length} 组暂存` : ''}</span>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => void stashWindow()}>
          <ArchiveIcon width={14} height={14} /> 暂存当前窗口的标签页
        </button>
      </div>
      <ul className="scroll-area mx-3 mt-1 flex-1 space-y-2 pb-2">
        {stashes.map((s) => (
          <StashCard key={s.id} stash={s} saved={saved} open={open.has(s.id)} onToggle={() => onToggle(s.id)} notify={notify} />
        ))}
        {stashes.length === 0 && (
          <li className="py-16 text-center text-sm text-zinc-400">暂存区是空的。右键网页或工具栏图标，选择「暂存当前窗口的所有标签页」</li>
        )}
      </ul>
    </>
  )
}

function StashCard({ stash: s, saved, open, onToggle, notify }: {
  stash: Stash
  saved: Set<string>
  open: boolean
  onToggle(): void
  notify(msg: string): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const openAll = () => {
    for (const it of s.items) void chrome.tabs.create({ url: it.url, active: false })
    notify(`已打开 ${s.items.length} 个标签页`)
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

  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className={`group flex items-center gap-1.5 py-1.5 pr-2 pl-1.5 ${open ? 'border-b border-zinc-100 dark:border-zinc-800' : ''}`}>
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
            <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={onToggle} aria-expanded={open} title={open ? '收起' : '展开'}>
              <ChevronRightIcon width={14} height={14} className={`shrink-0 text-zinc-400 transition ${open ? 'rotate-90' : ''}`} />
              <span className="truncate text-sm font-medium">{stashLabel(s)}</span>
              <span className="shrink-0 text-xs text-zinc-400">{s.items.length}</span>
            </button>
            <button className="btn-ghost shrink-0 p-1 opacity-0 group-hover:opacity-100" title="重命名" onClick={() => setRenaming(true)}>
              <EditIcon width={14} height={14} />
            </button>
          </>
        )}
        <button className="btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={openAll}>
          全部打开
        </button>
        <button
          className={`btn-danger shrink-0 p-1 ${confirmDelete ? 'bg-red-50 px-2 text-xs dark:bg-red-950' : ''}`}
          title="删除这组暂存"
          onClick={remove}
        >
          {confirmDelete ? '确认删除' : <TrashIcon width={14} height={14} />}
        </button>
      </div>
      {open && (
        <ul className="px-1 py-1">
          {s.items.map((it, i) => (
            <StashRow key={`${i}-${it.url}`} item={it} saved={saved.has(it.url)} onRemove={() => removeItem(i)} notify={notify} />
          ))}
        </ul>
      )}
    </li>
  )
}

function StashRow({ item, saved, onRemove, notify }: { item: StashItem; saved: boolean; onRemove(): void; notify(msg: string): void }) {
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
    <li className="group flex items-center gap-2.5 rounded-md px-2 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <Favicon url={item.url} size={16} />
      <button className="min-w-0 flex-1 -translate-y-px truncate py-0.5 text-left text-sm leading-5" onClick={open} onAuxClick={open} title={`${item.title}\n${item.url}`}>
        {item.title || item.url}
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
