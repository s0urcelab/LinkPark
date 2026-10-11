import { useEffect, useState, type HTMLAttributes, type MouseEvent } from 'react'
import { Favicon } from '../components/Favicon'
import { EditIcon, TrashIcon } from '../components/icons'
import { TagInput } from '../components/TagInput'
import { send } from '../lib/messages'
import type { Bookmark, UpdatePayload } from '../lib/types'

interface Props {
  bookmark: Bookmark
  pending: boolean
  /** Title-only single-line row. */
  compact?: boolean
  /** Shown only when sorting by visit frequency. */
  visits?: number
  editing: boolean
  allTags: string[]
  onEdit(): void
  onDone(): void
  onTagClick(tag: string): void
  /** Extra attributes (e.g. drag handlers) and classes for the row element. */
  rowProps?: HTMLAttributes<HTMLElement>
  rowClass?: string
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function BookmarkItem({ bookmark: b, pending, compact, visits, editing, allTags, onEdit, onDone, onTagClick, rowProps, rowClass = '' }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  if (editing) return <Editor bookmark={b} allTags={allTags} onDone={onDone} />

  const open = (e: MouseEvent) => {
    const background = e.ctrlKey || e.metaKey || e.button === 1
    void chrome.tabs.create({ url: b.url, active: !background })
    if (!background) window.close()
  }

  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true)
    void send({ type: 'delete', id: b.id })
  }

  const actions = (
    <div className={`flex shrink-0 items-center gap-0.5 ${confirmDelete ? '' : 'opacity-0 group-hover:opacity-100'}`}>
      {!confirmDelete && (
        <button className={`btn-ghost ${compact ? 'p-1' : 'p-1.5'}`} title="编辑" onClick={onEdit}>
          <EditIcon width={14} height={14} />
        </button>
      )}
      <button
        className={`btn-danger ${compact ? 'p-1' : 'p-1.5'} ${confirmDelete ? 'bg-red-50 text-xs dark:bg-red-950' : ''}`}
        title="删除"
        onClick={remove}
      >
        {confirmDelete ? '确认删除' : <TrashIcon width={14} height={14} />}
      </button>
    </div>
  )

  if (compact) {
    const tooltip = [b.title, b.url, visits !== undefined ? `访问 ${visits} 次` : ''].filter(Boolean).join('\n')
    return (
      <li {...rowProps} className={`group flex items-center gap-2.5 rounded-md px-2 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${rowClass}`}>
        <Favicon url={b.url} stored={b.favicon} size={16} />
        {/* CJK glyphs sit low in the line box; nudge up to center against the icon */}
        <button className="min-w-0 flex-1 -translate-y-px truncate py-0.5 text-left text-sm leading-5" onClick={open} onAuxClick={open} title={tooltip}>
          {b.title || b.url}
        </button>
        {actions}
      </li>
    )
  }

  return (
    <li {...rowProps} className={`group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${rowClass}`}>
      <div className="pt-0.5">
        <Favicon url={b.url} stored={b.favicon} />
      </div>
      <div className="min-w-0 flex-1">
        <button className="block w-full text-left" onClick={open} onAuxClick={open} title={b.url}>
          <div className="truncate text-sm font-medium">{b.title || b.url}</div>
          <div className="flex items-center gap-1.5 truncate text-xs text-zinc-400">
            {pending && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="待同步" />}
            <span className="truncate">{hostname(b.url)}</span>
            {visits !== undefined && <span className="shrink-0">· 访问 {visits} 次</span>}
          </div>
        </button>
        {b.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {b.tags.map((t) => (
              <button
                key={t}
                onClick={() => onTagClick(t)}
                className="rounded bg-zinc-100 px-1.5 py-px text-[11px] text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      {actions}
    </li>
  )
}

function Editor({ bookmark: b, allTags, onDone }: { bookmark: Bookmark; allTags: string[]; onDone(): void }) {
  const [title, setTitle] = useState(b.title)
  const [url, setUrl] = useState(b.url)
  const [tags, setTags] = useState(b.tags)

  const save = () => {
    const patch: UpdatePayload = {}
    if (title.trim() !== b.title) patch.title = title
    if (url.trim() && url.trim() !== b.url) patch.url = url
    if (tags.join('\u0000') !== b.tags.join('\u0000')) patch.tags = tags
    if (Object.keys(patch).length) void send({ type: 'update', id: b.id, patch })
    onDone()
  }

  return (
    <li className="my-1 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" onKeyDown={(e) => e.key === 'Enter' && save()} />
      <input className="input text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="链接" />
      <TagInput value={tags} onChange={setTags} suggestions={allTags} autoFocus />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onDone}>
          取消
        </button>
        <button className="btn-primary" onClick={save}>
          保存
        </button>
      </div>
    </li>
  )
}
