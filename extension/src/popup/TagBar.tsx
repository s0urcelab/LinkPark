import { useState } from 'react'
import type { TagCount } from '../lib/ops'

const COLLAPSED = 12

interface Props {
  tags: TagCount[]
  selected: string[]
  onChange(selected: string[]): void
}

export function TagBar({ tags, selected, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (tags.length === 0) return null

  const isSel = (name: string) => selected.some((s) => s.toLowerCase() === name.toLowerCase())
  const toggle = (name: string) =>
    onChange(isSel(name) ? selected.filter((s) => s.toLowerCase() !== name.toLowerCase()) : [...selected, name])

  // Keep selected tags visible even when collapsed.
  const visible = expanded ? tags : [...tags.filter((t) => isSel(t.name)), ...tags.filter((t) => !isSel(t.name))].slice(0, COLLAPSED)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((t) => (
        <button
          key={t.name}
          onClick={() => toggle(t.name)}
          className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
            isSel(t.name)
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-zinc-200 text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300'
          }`}
        >
          {t.name}
          <span className="ml-1 opacity-60">{t.count}</span>
        </button>
      ))}
      {tags.length > COLLAPSED && (
        <button className="px-1 text-xs text-zinc-400 hover:text-indigo-600" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '收起' : `+${tags.length - COLLAPSED}`}
        </button>
      )}
      {selected.length > 0 && (
        <button className="px-1 text-xs text-zinc-400 hover:text-red-500" onClick={() => onChange([])}>
          清除
        </button>
      )}
    </div>
  )
}
