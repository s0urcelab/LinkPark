import { useState, type ReactNode } from 'react'
import { ImportPanel } from '../components/ImportPanel'
import { RefreshIcon } from '../components/icons'
import { SettingsForm } from '../components/SettingsForm'
import { SyncIndicator } from '../components/SyncIndicator'
import { useStorage } from '../components/useStorage'
import { send } from '../lib/messages'
import { isConfigured } from '../lib/storage'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function Options() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">LinkPark 设置</h1>
        <p className="mt-1 text-sm text-zinc-500">连接你的自托管服务端，书签会自动在各设备间同步。</p>
      </header>
      <Section title="服务端">
        <SettingsForm />
      </Section>
      <SyncSection />
      <ImportSection />
    </main>
  )
}

function SyncSection() {
  const settings = useStorage('settings')
  const syncState = useStorage('syncState')
  const outbox = useStorage('outbox')
  const failed = useStorage('failed')
  const cache = useStorage('cache')
  const [busy, setBusy] = useState(false)

  if (!settings || !syncState || !outbox || !failed || !cache) return null
  const configured = isConfigured(settings)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="同步">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <SyncIndicator state={configured ? syncState : { ...syncState, status: 'unconfigured' }} pending={outbox.length} failed={failed.length} />
          <span className="text-zinc-500">本地缓存 {Object.keys(cache.bookmarks).length} 个书签</span>
          {syncState.lastSyncAt && <span className="text-zinc-500">上次同步 {new Date(syncState.lastSyncAt).toLocaleString()}</span>}
        </div>
        {syncState.lastError && syncState.status !== 'idle' && <p className="text-red-600">{syncState.lastError}</p>}

        <div className="flex gap-2">
          <button className="btn-ghost border border-zinc-200 dark:border-zinc-700" disabled={!configured || busy} onClick={() => void act(() => send({ type: 'sync' }))}>
            <RefreshIcon width={14} height={14} /> 立即同步
          </button>
          <button className="btn-ghost border border-zinc-200 dark:border-zinc-700" disabled={!configured || busy} onClick={() => void act(() => send({ type: 'resync' }))}>
            清空缓存并全量同步
          </button>
        </div>

        {failed.length > 0 && (
          <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
            <p className="font-medium text-red-700 dark:text-red-300">
              {failed.length} 批修改被服务端拒绝（共 {failed.reduce((n, f) => n + f.ops.length, 0)} 项操作）
            </p>
            <ul className="space-y-1 text-xs text-red-600 dark:text-red-400">
              {failed.map((f) => (
                <li key={f.at + f.ops[0]?.op_id}>
                  {new Date(f.at).toLocaleString()}：{f.error}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => void act(() => send({ type: 'retryFailed' }))}>
                重新提交
              </button>
              <button className="btn-danger" disabled={busy} onClick={() => void act(() => send({ type: 'discardFailed' }))}>
                丢弃这些修改
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

function ImportSection() {
  const onboarding = useStorage('onboarding')
  const settings = useStorage('settings')
  if (!onboarding || !settings) return null

  return (
    <Section title="导入浏览器书签">
      {onboarding.importDone ? (
        <p className="text-sm text-zinc-500">已完成导入。</p>
      ) : isConfigured(settings) ? (
        <ImportPanel />
      ) : (
        <p className="text-sm text-zinc-500">请先配置服务端。</p>
      )}
    </Section>
  )
}
