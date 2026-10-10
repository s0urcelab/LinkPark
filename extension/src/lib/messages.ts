import type { ImportItem, ImportResponse, UpdatePayload } from './types'

export type Message =
  | { type: 'add'; url: string; title: string; favicon?: string; tags?: string[] }
  | { type: 'update'; id: string; patch: UpdatePayload }
  | { type: 'delete'; id: string }
  | { type: 'sync' }
  | { type: 'resync' }
  | { type: 'import'; items: ImportItem[] }
  | { type: 'retryFailed' }
  | { type: 'discardFailed' }
  | { type: 'settingsChanged'; serverChanged: boolean }

export type AddResult = { status: 'added'; id: string } | { status: 'exists'; id: string } | { status: 'unconfigured' }

export interface ReplyMap {
  add: AddResult
  import: Omit<ImportResponse, 'version'>
}

type ReplyOf<M extends Message> = M['type'] extends keyof ReplyMap ? ReplyMap[M['type']] : void

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

export async function send<M extends Message>(msg: M): Promise<ReplyOf<M>> {
  const reply = (await chrome.runtime.sendMessage(msg)) as Reply<ReplyOf<M>> | undefined
  if (!reply) throw new Error('后台服务无响应')
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}
