import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { fillFavicons } from '../lib/favicon'
import { flattenTree, folderTree, parseBookmarksHtml, summarize, type FolderNode, type TreeNode } from '../lib/importer'
import { send } from '../lib/messages'
import { ChevronRightIcon } from './icons'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'importing'; icons?: { done: number; total: number } }
  | { kind: 'done'; imported: number; skipped: number; stashes: number }
  | { kind: 'error'; msg: string }

type Source = { kind: 'browser' } | { kind: 'file'; name: string }

export function ImportPanel({ onFinished, onSkip }: { onFinished?(): void; onSkip?(): void }) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [stashKeys, setStashKeys] = useState<Set<string>>(new Set())
  const [source, setSource] = useState<Source>({ kind: 'browser' })
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const load = (t: TreeNode[], src: Source) => {
    setTree(t)
    setStashKeys(new Set())
    setSource(src)
    setPhase({ kind: 'ready' })
  }

  const loadBrowser = () => {
    setPhase({ kind: 'loading' })
    void chrome.bookmarks.getTree().then((t) => load(t, { kind: 'browser' }))
  }

  useEffect(loadBrowser, [])

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      load(parseBookmarksHtml(await file.text()), { kind: 'file', name: file.name })
    } catch (err) {
      setPhase({ kind: 'error', msg: `无法解析文件：${(err as Error).message}` })
    }
  }

  const folders = useMemo(() => folderTree(tree), [tree])
  const plan = useMemo(() => flattenTree(tree, stashKeys), [tree, stashKeys])
  const { total, tags, pinned, untagged, stashed } = summarize(plan)

  const toggle = (key: string) =>
    setStashKeys((s) => {
      const next = new Set([...s].filter((k) => !k.startsWith(`${key}.`)))
      if (s.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const run = async () => {
    setPhase({ kind: 'importing' })
    try {
      const items = await fillFavicons(plan.items, (done, total) => {
        if (total > 0) setPhase({ kind: 'importing', icons: { done, total } })
      })
      setPhase({ kind: 'importing' })
      const res = await send({ type: 'import', ...plan, items })
      setPhase({ kind: 'done', ...res, stashes: plan.stashes.length })
      onFinished?.()
    } catch (e) {
      setPhase({ kind: 'error', msg: (e as Error).message })
    }
  }

  if (phase.kind === 'loading') return <p className="text-sm text-zinc-400">正在读取浏览器书签…</p>

  if (phase.kind === 'done') {
    return (
      <p className="text-sm text-emerald-600">
        导入完成：新增 {phase.imported} 个书签
        {phase.skipped > 0 && `，跳过 ${phase.skipped} 个重复或无效链接`}
        {phase.stashes > 0 && `，${phase.stashes} 组放入暂存区`}。
      </p>
    )
  }

  const busy = phase.kind === 'importing'

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {source.kind === 'browser' ? '在浏览器中' : <>在文件 <b>{source.name}</b> 中</>}找到 <b>{total}</b> 个要导入的网页书签，默认排序会保持原有的文件夹顺序。
        {tags > 0 && (
          <>
            路径上的每一级文件夹都会成为一个标签（共 <b>{tags}</b> 个）
            {pinned > 0 && <>，书签栏上的 <b>{pinned}</b> 个文件夹会固定到标签栏</>}。
          </>
        )}
        {untagged > 0 && <>不在任何文件夹里的 <b>{untagged}</b> 个书签归入“未分类”。</>}
        {stashed > 0 && (
          <>
            另有 <b>{stashed}</b> 个链接按文件夹分成 <b>{plan.stashes.length}</b> 组放入暂存区，不作为书签导入。
          </>
        )}
        能读到的网站图标会一并保存，以后站点失效也能显示。已存在于服务端的链接会自动跳过。
      </p>

      {folders.length > 0 && (
        <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-600 select-none dark:text-zinc-300">
            选择直接放入暂存区的文件夹（可选）{stashKeys.size > 0 && <span className="text-indigo-600">· 已选 {stashKeys.size} 个</span>}
          </summary>
          <p className="px-3 pb-1 text-xs text-zinc-500">勾选的文件夹（含子文件夹）会以文件夹名为组名进入暂存区，其中的链接不会导入为书签。</p>
          <ul className="max-h-72 overflow-y-auto px-2 pb-2">
            {folders.map((f) => (
              <FolderRow key={f.key} folder={f} depth={0} selected={stashKeys} inherited={false} onToggle={toggle} disabled={busy} />
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => void run()} disabled={busy || total + stashed === 0}>
          {phase.kind === 'importing'
            ? phase.icons
              ? `正在读取图标 ${phase.icons.done}/${phase.icons.total}`
              : '导入中…'
            : total > 0
              ? `导入 ${total} 个书签`
              : '放入暂存区'}
        </button>
        <label className={`btn-ghost border border-zinc-200 dark:border-zinc-700 ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
          从 HTML 文件导入…
          <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => void loadFile(e)} />
        </label>
        {source.kind === 'file' && (
          <button className="btn-ghost" onClick={loadBrowser} disabled={busy}>
            改用浏览器书签
          </button>
        )}
        {onSkip && (
          <button className="btn-ghost" onClick={onSkip} disabled={busy}>
            跳过
          </button>
        )}
      </div>
      {phase.kind === 'error' && <p className="text-sm text-red-600">导入失败：{phase.msg}（可重试）</p>}
    </div>
  )
}

function FolderRow({ folder: f, depth, selected, inherited, onToggle, disabled }: {
  folder: FolderNode
  depth: number
  selected: Set<string>
  /** An ancestor is already selected, which covers this folder. */
  inherited: boolean
  onToggle(key: string): void
  disabled: boolean
}) {
  // Top-level containers ("书签栏", "其他书签") start open.
  const [open, setOpen] = useState(depth === 0)
  const checked = inherited || selected.has(f.key)
  return (
    <li>
      <div className="flex items-center gap-1.5 rounded py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60" style={{ paddingLeft: depth * 16 }}>
        <button
          className={`p-0.5 text-zinc-400 ${f.children.length ? '' : 'invisible'}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? '收起' : '展开'}
        >
          <ChevronRightIcon width={12} height={12} className={`transition ${open ? 'rotate-90' : ''}`} />
        </button>
        <label className={`flex min-w-0 flex-1 items-center gap-2 text-sm ${inherited ? 'text-zinc-400' : 'cursor-pointer'}`}>
          <input type="checkbox" checked={checked} disabled={inherited || disabled} onChange={() => onToggle(f.key)} />
          <span className="truncate">{f.title || '未命名文件夹'}</span>
          <span className="shrink-0 text-xs text-zinc-400">{f.count}</span>
        </label>
      </div>
      {open && f.children.length > 0 && (
        <ul>
          {f.children.map((c) => (
            <FolderRow key={c.key} folder={c} depth={depth + 1} selected={selected} inherited={checked} onToggle={onToggle} disabled={disabled} />
          ))}
        </ul>
      )}
    </li>
  )
}
