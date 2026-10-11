import type { SortKey } from '../lib/ops'

const OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'added', label: '最近添加' },
  { key: 'visits', label: '访问频率' },
  { key: 'title', label: '名称' },
]

export function SortSwitch({ value, onChange }: { value: SortKey; onChange(key: SortKey): void }) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800" role="radiogroup" aria-label="排序方式">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1 transition ${
            value === o.key
              ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
