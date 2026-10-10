import type { SyncState } from '../lib/types'

interface Props {
  state: SyncState
  pending: number
  failed: number
}

export function describeSync({ state, pending, failed }: Props): { label: string; tone: 'ok' | 'busy' | 'warn' | 'error' } {
  if (state.status === 'unconfigured') return { label: '未配置服务端', tone: 'warn' }
  if (state.status === 'auth_error') return { label: 'Token 无效', tone: 'error' }
  if (failed > 0) return { label: `${failed} 批提交失败`, tone: 'error' }
  if (state.status === 'syncing') return { label: '同步中', tone: 'busy' }
  if (state.status === 'retrying') {
    const secs = state.nextRetryAt ? Math.max(0, Math.round((state.nextRetryAt - Date.now()) / 1000)) : 0
    return { label: `离线，待同步 ${pending} 条${secs ? `（${secs}s 后重试）` : ''}`, tone: 'warn' }
  }
  if (pending > 0) return { label: `待同步 ${pending} 条`, tone: 'busy' }
  return { label: '已同步', tone: 'ok' }
}

const dot = {
  ok: 'bg-emerald-500',
  busy: 'bg-indigo-500 animate-pulse',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
}

export function SyncIndicator(props: Props) {
  const { label, tone } = describeSync(props)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" title={props.state.lastError ?? label}>
      <span className={`size-1.5 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  )
}
