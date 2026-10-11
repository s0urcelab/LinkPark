import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, SortIcon } from '../components/icons'
import type { SortKey } from '../lib/ops'

const OPTIONS: { key: SortKey; label: string; hint?: string }[] = [
  { key: 'default', label: '默认', hint: '可拖拽调整顺序' },
  { key: 'added', label: '最近添加' },
  { key: 'visits', label: '访问频率', hint: '需授权读取历史记录' },
  { key: 'title', label: '名称' },
]

export function SortMenu({ value, onChange }: { value: SortKey; onChange(key: SortKey): void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0]

  return (
    <div ref={ref} className="relative">
      <button
        className={`tool-btn ${open ? 'bg-sage text-charcoal dark:bg-zinc-800 dark:text-zinc-200' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="排序方式"
        onClick={() => setOpen(!open)}
      >
        <SortIcon width={13} height={13} />
        {current.label}
        <ChevronDownIcon width={12} height={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border border-sage bg-white p-1 shadow-lg shadow-forest/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/30"
        >
          {OPTIONS.map((o) => {
            const active = o.key === value
            return (
              <button
                key={o.key}
                role="menuitemradio"
                aria-checked={active}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sage/70 dark:hover:bg-zinc-700 ${active ? 'bg-mint/30 dark:bg-mint/10' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (!active) onChange(o.key)
                }}
              >
                <span className="mt-px w-3.5 shrink-0 text-forest dark:text-mint">{active && <CheckIcon width={13} height={13} />}</span>
                <span>
                  <span className={`block ${active ? 'font-medium' : ''}`}>{o.label}</span>
                  {o.hint && <span className="block text-[10px] text-charcoal/50 dark:text-zinc-400">{o.hint}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
