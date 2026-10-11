import { useState } from 'react'
import { ChevronDownIcon, SettingsIcon, XIcon } from '../components/icons'
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

const idle = 'chip bg-sage text-charcoal/75 hover:bg-mint/60 hover:text-forest dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-mint'
const active = 'chip bg-mint font-medium text-forest hover:bg-mint/80 dark:bg-mint/20 dark:text-mint dark:hover:bg-mint/30'
const more = 'rounded-full px-2 py-0.5 text-xs text-charcoal/50 hover:bg-sage hover:text-forest dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-mint'
const iconBtn = 'grid size-6 place-items-center rounded-full text-charcoal/50 transition hover:bg-sage hover:text-forest dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-mint'

function ToggleButton({ expanded, hidden, onClick }: { expanded: boolean; hidden: string; onClick(): void }) {
  const label = expanded ? '收起' : hidden
  return (
    <button className={iconBtn} onClick={onClick} title={label} aria-label={label} aria-expanded={expanded}>
      <ChevronDownIcon width={14} height={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  )
}

function Chip({ tag, onClick }: { tag: TagInfo; onClick(): void }) {
  return (
    <button className={`${idle} ${tag.virtual ? 'italic' : ''}`} onClick={onClick} title={`${tagLabel(tag.name)}（${tag.count}）`}>
      <span className="max-w-32 truncate">{tagLabel(tag.name)}</span>
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
          <ToggleButton
            expanded={expanded}
            hidden={pinned.length ? `更多 ${tags.length - pinned.length} 个标签` : `全部标签（${tags.length}）`}
            onClick={() => setExpanded(!expanded)}
          />
        )}
        {expanded && (
          <button
            className={`${more} inline-flex h-5 items-center gap-1`}
            title="排序、固定、重命名或删除标签"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html#tags') })}
          >
            <SettingsIcon width={12} height={12} />
            <span className="text-box-cap">管理标签</span>
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
        <ToggleButton expanded={expanded} hidden={`更多 ${related.length - RELATED_PREVIEW} 个标签`} onClick={() => setExpanded(!expanded)} />
      )}
      <button className={more} onClick={() => onChange([])}>
        清除
      </button>
    </div>
  )
}
