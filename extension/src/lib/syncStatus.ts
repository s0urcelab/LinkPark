import type { SyncState } from './types'

export type SyncTone = 'ok' | 'busy' | 'warn' | 'error'

export interface SyncSummary {
  configured: boolean
  state: SyncState
  pending: number
  failed: number
}

export function describeSync({ configured, state, pending, failed }: SyncSummary): { label: string; tone: SyncTone } {
  if (!configured || state.status === 'unconfigured') return { label: '未配置服务端', tone: 'warn' }
  if (state.status === 'auth_error') return { label: 'Token 无效', tone: 'error' }
  if (failed > 0) return { label: `${failed} 批修改提交失败`, tone: 'error' }
  if (state.status === 'retrying') return { label: `连接失败，待同步 ${pending} 条，将自动重试`, tone: 'warn' }
  if (state.status === 'syncing') return { label: '同步中', tone: 'busy' }
  if (pending > 0) return { label: `待同步 ${pending} 条`, tone: 'busy' }
  return { label: '已同步', tone: 'ok' }
}
