import type { ImportPlan } from './importer'
import type { ImportResponse, Op, UpdatePayload } from './types'

export type Message =
  | { type: 'add'; url: string; title: string; favicon?: string; tags?: string[] }
  | { type: 'update'; id: string; patch: UpdatePayload }
  | { type: 'delete'; id: string }
  /** Prebuilt ops from the UI (reordering, tag management, stashes). */
  | { type: 'ops'; ops: Op[] }
  /** Saves every web tab of the window; the sender must already hold the "tabs" permission. */
  | { type: 'stashWindow'; windowId: number }
  | { type: 'sync' }
  | { type: 'resync' }
  | ({ type: 'import' } & ImportPlan)
  | { type: 'retryFailed' }
  | { type: 'discardFailed' }
  | { type: 'settingsChanged'; serverChanged: boolean }

export type AddResult = { status: 'added'; id: string } | { status: 'exists'; id: string } | { status: 'unconfigured' }

export type StashResult = { status: 'stashed'; count: number } | { status: 'empty' } | { status: 'unconfigured' }

export interface ReplyMap {
  add: AddResult
  stashWindow: StashResult
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
