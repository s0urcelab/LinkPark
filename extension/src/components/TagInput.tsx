import { useState, type KeyboardEvent } from 'react'
import { normalizeTags } from '../lib/tags'

interface Props {
  value: string[]
  onChange(tags: string[]): void
  suggestions?: string[]
  autoFocus?: boolean
}

export function TagInput({ value, onChange, suggestions = [], autoFocus }: Props) {
  const [draft, setDraft] = useState('')

  const commit = (text = draft) => {
    const parts = text.split(/[,，]/)
    const next = normalizeTags([...value, ...parts])
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const q = draft.trim().toLowerCase()
  const lowerValue = value.map((t) => t.toLowerCase())
  const matches = q
    ? suggestions.filter((s) => s.toLowerCase().includes(q) && !lowerValue.includes(s.toLowerCase())).slice(0, 6)
    : []

  return (
    <div className="relative">
      <div className="input flex flex-wrap items-center gap-1 py-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-mint/40 px-1.5 py-0.5 text-xs text-forest dark:bg-mint/15 dark:text-mint">
            {t}
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`移除 ${t}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-16 flex-1 bg-transparent text-sm outline-none"
          value={draft}
          autoFocus={autoFocus}
          placeholder={value.length ? '' : '添加标签，回车确认'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft && commit()}
        />
      </div>
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(normalizeTags([...value, m]))
                  setDraft('')
                }}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
