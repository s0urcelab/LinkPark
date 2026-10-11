import { useEffect, useState, type ReactNode } from 'react'
import { ImportPanel } from '../components/ImportPanel'
import { RefreshIcon } from '../components/icons'
import { SettingsForm } from '../components/SettingsForm'
import { SyncIndicator } from '../components/SyncIndicator'
import { useStorage } from '../components/useStorage'
import { rasterizeIcon } from '../lib/icon'
import { send } from '../lib/messages'
import { isConfigured, setItem } from '../lib/storage'
import { TagManager } from './TagManager'

type View = 'settings' | 'tags'

const viewFromHash = (): View => (location.hash === '#tags' ? 'tags' : 'settings')

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function Options() {
  const [view, setView] = useState<View>(viewFromHash)

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const views: { key: View; label: string }[] = [
    { key: 'settings', label: '设置' },
    { key: 'tags', label: '标签管理' },
  ]

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">LinkPark</h1>
          <p className="mt-1 text-sm text-zinc-500">连接你的自托管服务端，书签会自动在各设备间同步。</p>
        </div>
        <nav className="inline-flex shrink-0 rounded-lg bg-zinc-100 p-0.5 text-sm dark:bg-zinc-800">
          {views.map((v) => (
            <a
              key={v.key}
              href={v.key === 'tags' ? '#tags' : '#'}
              aria-current={view === v.key ? 'page' : undefined}
              className={`rounded-md px-3 py-1 transition ${
                view === v.key
                  ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {v.label}
            </a>
          ))}
        </nav>
      </header>
      {view === 'settings' ? (
        <>
          <Section title="服务端">
            <SettingsForm />
          </Section>
          <IconSection />
          <SyncSection />
          <ImportSection />
        </>
      ) : (
        <Section title="标签管理">
          <TagManager />
        </Section>
      )}
    </main>
  )
}

const DEFAULT_ICON = '/icons/icon-128.png'

function IconSection() {
  const icon = useStorage('icon')
  const [error, setError] = useState<string | null>(null)
  const custom = icon?.dataUrl ?? ''

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      await setItem('icon', { dataUrl: await rasterizeIcon(file) })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取这张图片')
    }
  }

  return (
    <Section title="图标">
      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sage/70 p-1 dark:bg-zinc-800">
          <img src={custom || DEFAULT_ICON} alt="" className="size-full object-contain" />
        </span>
        <div className="space-y-2">
          <p className="text-sm text-zinc-500">替换浏览器工具栏上的 LinkPark 图标。正方形图片效果最好。</p>
          <div className="flex flex-wrap gap-2">
            <label className="btn-ghost cursor-pointer border border-zinc-200 dark:border-zinc-700">
              上传图片
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  void onFile(file)
                }}
              />
            </label>
            {custom && (
              <button type="button" className="btn-ghost" onClick={() => void setItem('icon', { dataUrl: '' }).then(() => setError(null))}>
                恢复默认
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </Section>
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
          <SyncIndicator configured={configured} state={syncState} pending={outbox.length} failed={failed.length} />
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
    <Section title="导入书签">
      {isConfigured(settings) ? (
        <div className="space-y-3">
          {onboarding.importDone && <p className="text-sm text-zinc-500">已导入过；再次导入时重复的链接会被跳过。</p>}
          <ImportPanel />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">请先配置服务端。</p>
      )}
    </Section>
  )
}
