import type { ReactNode } from 'react'

/** Row between the filters and the list: a summary on the left, view actions on the right. */
export function Toolbar({ summary, children }: { summary: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-3 mt-2 flex h-8 shrink-0 items-center justify-between gap-2 border-b border-sage text-xs text-charcoal/50 dark:border-zinc-800 dark:text-zinc-500">
      <span className="min-w-0 truncate">{summary}</span>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  )
}
