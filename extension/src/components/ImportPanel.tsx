import { useEffect, useState } from 'react'
import { flattenTree, summarize } from '../lib/importer'
import { send } from '../lib/messages'
import type { ImportItem } from '../lib/types'

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'importing' } | { kind: 'done'; imported: number; skipped: number } | { kind: 'error'; msg: string }

export function ImportPanel({ onFinished, onSkip }: { onFinished?(): void; onSkip?(): void }) {
  const [items, setItems] = useState<ImportItem[]>([])
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    void chrome.bookmarks.getTree().then((tree) => {
      setItems(flattenTree(tree))
      setPhase({ kind: 'ready' })
    })
  }, [])

  const { total, tags } = summarize(items)

  const run = async () => {
    setPhase({ kind: 'importing' })
    try {
      const res = await send({ type: 'import', items })
      setPhase({ kind: 'done', ...res })
      onFinished?.()
    } catch (e) {
      setPhase({ kind: 'error', msg: (e as Error).message })
    }
  }

  if (phase.kind === 'loading') return <p className="text-sm text-zinc-400">正在读取浏览器书签…</p>

  if (phase.kind === 'done') {
    return (
      <p className="text-sm text-emerald-600">
        导入完成：新增 {phase.imported} 个书签{phase.skipped > 0 && `，跳过 ${phase.skipped} 个重复或无效链接`}。
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        在浏览器中找到 <b>{total}</b> 个网页书签{tags.length > 0 && <>，其中的文件夹会转换为 <b>{tags.length}</b> 个标签</>}。
        已存在于服务端的链接会自动跳过。此操作只需执行一次。
      </p>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 30).map((t) => (
            <span key={t} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {t}
            </span>
          ))}
          {tags.length > 30 && <span className="text-xs text-zinc-400">等 {tags.length} 个</span>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={() => void run()} disabled={phase.kind === 'importing' || total === 0}>
          {phase.kind === 'importing' ? '导入中…' : `导入 ${total} 个书签`}
        </button>
        {onSkip && (
          <button className="btn-ghost" onClick={onSkip} disabled={phase.kind === 'importing'}>
            跳过
          </button>
        )}
        {phase.kind === 'error' && <span className="text-sm text-red-600">导入失败：{phase.msg}（可重试）</span>}
      </div>
    </div>
  )
}
