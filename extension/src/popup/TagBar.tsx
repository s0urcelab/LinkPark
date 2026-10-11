import { useState } from 'react'
import { XIcon } from '../components/icons'
import { tagKey, tagLabel, type TagInfo } from '../lib/tags'

interface Props {
  /** Every tag, in user order. */
  tags: TagInfo[]
  /** Tags overlapping the current results, counted within them; used once something is selected. */
  related: TagInfo[]
  selected: string[]
  onChange(next: string[]): void
}

const RELATED_PREVIEW = 12

const chip = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition'
const idle = `${chip} bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700`
const active = `${chip} bg-indigo-600 text-white hover:bg-indigo-700`
const more = 'rounded-full px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800'

function Chip({ tag, onClick }: { tag: TagInfo; onClick(): void }) {
  return (
    <button className={`${idle} ${tag.virtual ? 'italic' : ''}`} onClick={onClick} title={tagLabel(tag.name)}>
      <span className="max-w-32 truncate">{tagLabel(tag.name)}</span>
      <span className="text-[10px] text-zinc-400">{tag.count}</span>
    </button>
  )
}

/**
 * Nothing selected: pinned tags, the rest behind "更多". Once tags are selected only
 * tags that still narrow the results are offered, so no choice ever leads to nothing.
 */
export function TagBar({ tags, related, selected, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (tags.length === 0) return null

  const add = (t: TagInfo) => onChange([...selected, t.name])

  if (selected.length === 0) {
    const pinned = tags.filter((t) => t.pinned)
    const shown = expanded ? tags : pinned
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${expanded ? 'max-h-36 overflow-y-auto' : ''}`}>
        {shown.map((t) => (
          <Chip key={t.key} tag={t} onClick={() => add(t)} />
        ))}
        {pinned.length < tags.length && (
          <button className={more} onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : pinned.length ? `更多 ${tags.length - pinned.length}` : `全部标签 ${tags.length}`}
          </button>
        )}
        {expanded && (
          <button
            className={more}
            title="排序、固定、重命名或删除标签"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html#tags') })}
          >
            管理标签
          </button>
        )}
      </div>
    )
  }

  const shownRelated = expanded ? related : related.slice(0, RELATED_PREVIEW)
  return (
    <div className="flex max-h-36 flex-wrap items-center gap-1.5 overflow-y-auto">
      {selected.map((name) => (
        <button key={tagKey(name)} className={active} onClick={() => onChange(selected.filter((s) => s !== name))} title="取消选择">
          <span className="max-w-32 truncate">{tagLabel(name)}</span>
          <XIcon width={10} height={10} />
        </button>
      ))}
      {shownRelated.map((t) => (
        <Chip key={t.key} tag={t} onClick={() => add(t)} />
      ))}
      {related.length > RELATED_PREVIEW && (
        <button className={more} onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : `更多 ${related.length - RELATED_PREVIEW}`}
        </button>
      )}
      <button className={more} onClick={() => onChange([])}>
        清除
      </button>
    </div>
  )
}
