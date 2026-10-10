import { describeSync, type SyncSummary } from '../lib/syncStatus'

const dot = {
  ok: 'bg-emerald-500',
  busy: 'bg-indigo-500 animate-pulse',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
}

export function SyncIndicator(props: SyncSummary) {
  const { label, tone } = describeSync(props)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" title={props.state.lastError ?? label}>
      <span className={`size-1.5 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  )
}
