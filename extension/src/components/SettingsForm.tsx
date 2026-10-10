import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { send } from '../lib/messages'
import { getItem, normalizeServerUrl, setItem } from '../lib/storage'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; msg: string } | { kind: 'error'; msg: string }

function originPattern(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.host}/*`
  } catch {
    return null
  }
}

/**
 * Asks for host access so requests skip CORS. Must be the first await inside a click
 * handler, otherwise Chrome rejects it for lacking a user gesture. Denial is non-fatal
 * because the server also answers CORS for extension origins.
 */
async function requestHostAccess(serverUrl: string): Promise<void> {
  const origin = originPattern(serverUrl)
  if (!origin) return
  try {
    await chrome.permissions.request({ origins: [origin] })
  } catch {
    // ignored, see above
  }
}

export function SettingsForm({ onSaved, submitLabel = '保存' }: { onSaved?(): void; submitLabel?: string }) {
  const [serverUrl, setServerUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    void getItem('settings').then((s) => {
      setServerUrl(s.serverUrl)
      setToken(s.token)
    })
  }, [])

  const validate = (): string | null => {
    const url = normalizeServerUrl(serverUrl)
    if (!originPattern(url)) {
      setStatus({ kind: 'error', msg: '请输入有效的 http(s) 地址，例如 https://bookmarks.example.com' })
      return null
    }
    if (!token.trim()) {
      setStatus({ kind: 'error', msg: '请输入 Token' })
      return null
    }
    return url
  }

  const test = async () => {
    const url = validate()
    if (!url) return
    await requestHostAccess(url)
    setStatus({ kind: 'busy' })
    try {
      const { tags } = await api.tags({ serverUrl: url, token: token.trim() })
      setStatus({ kind: 'ok', msg: `连接成功（服务端共有 ${tags.length} 个标签）` })
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message })
    }
  }

  const save = async () => {
    const url = validate()
    if (!url) return
    await requestHostAccess(url)
    setStatus({ kind: 'busy' })
    try {
      await api.tags({ serverUrl: url, token: token.trim() })
    } catch (e) {
      setStatus({ kind: 'error', msg: `保存失败：${(e as Error).message}` })
      return
    }
    const prev = await getItem('settings')
    await setItem('settings', { serverUrl: url, token: token.trim() })
    setServerUrl(url)
    await send({ type: 'settingsChanged', serverChanged: prev.serverUrl !== url })
    setStatus({ kind: 'ok', msg: '已保存' })
    onSaved?.()
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">服务端地址</span>
        <input className="input" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://bookmarks.example.com" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Token</span>
        <div className="flex gap-2">
          <input
            className="input font-mono"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="与服务端 LINKPARK_TOKEN 一致"
            autoComplete="off"
          />
          <button type="button" className="btn-ghost shrink-0" onClick={() => setShowToken((s) => !s)}>
            {showToken ? '隐藏' : '显示'}
          </button>
        </div>
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary" disabled={status.kind === 'busy'}>
          {submitLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void test()} disabled={status.kind === 'busy'}>
          测试连接
        </button>
        {status.kind === 'busy' && <span className="text-sm text-zinc-400">请稍候…</span>}
        {status.kind === 'ok' && <span className="text-sm text-emerald-600">{status.msg}</span>}
        {status.kind === 'error' && <span className="text-sm text-red-600">{status.msg}</span>}
      </div>
    </form>
  )
}
