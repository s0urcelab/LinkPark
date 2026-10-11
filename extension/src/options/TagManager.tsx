import { useMemo, useState } from 'react'
import { EditIcon, GripIcon, PinIcon, TrashIcon } from '../components/icons'
import { useDragReorder } from '../components/useDragReorder'
import { useStorage } from '../components/useStorage'
import { send } from '../lib/messages'
import { buildState, makeDeleteOp, makeTagOp } from '../lib/ops'
import { rankBetween, rankSequence } from '../lib/rank'
import { buildTagList, normalizeTag, tagKey, tagLabel, UNTAGGED, type TagInfo } from '../lib/tags'
import type { Op } from '../lib/types'

const sendOps = (ops: Op[]) => void send({ type: 'ops', ops })

export function TagManager() {
  const cache = useStorage('cache')
  const outbox = useStorage('outbox')
  const [renaming, setRenaming] = useState<string | null>(null)

  const tags = useMemo(() => {
    if (!cache || !outbox) return []
    const s = buildState(cache, outbox)
    return buildTagList(s.bookmarks, s.tags)
  }, [cache, outbox])

  const byKey = useMemo(() => new Map(tags.map((t) => [t.key, t])), [tags])

  const reorder = useDragReorder(
    tags.map((t) => t.key),
    (key, prev, next) => {
      if (tags.every((t) => t.rank)) {
        return sendOps([makeTagOp(byKey.get(key)!.name, { rank: rankBetween(prev && byKey.get(prev)?.rank, next && byKey.get(next)?.rank) })])
      }
      // Some tags have no rank yet (created by hand): give everyone a fresh, evenly spaced one.
      const order = tags.filter((t) => t.key !== key)
      order.splice(next === undefined ? order.length : order.findIndex((t) => t.key === next), 0, byKey.get(key)!)
      const ranks = rankSequence(null, order.length)
      sendOps(order.flatMap((t, i) => (t.rank === ranks[i] ? [] : [makeTagOp(t.name, { rank: ranks[i] })])))
    },
    renaming === null,
  )

  if (!cache || !outbox) return null
  if (tags.length === 0) return <p className="text-sm text-zinc-500">还没有标签。</p>

  const rename = (t: TagInfo, raw: string) => {
    setRenaming(null)
    const to = normalizeTag(raw)
    if (!to || to === t.name) return
    const target = byKey.get(tagKey(to))
    if (target && target.key !== t.key && !target.virtual) {
      if (!confirm(`标签“${target.name}”已存在。合并后，“${t.name}”的 ${t.count} 个书签都会改用“${target.name}”，顺序和固定状态以“${target.name}”为准。继续？`)) return
    }
    sendOps([makeTagOp(t.name, { name: to })])
  }

  const remove = (t: TagInfo) => {
    if (!confirm(`删除标签“${t.name}”？它会从 ${t.count} 个书签上移除，书签本身保留。`)) return
    sendOps([makeDeleteOp(t.name, 'tag')])
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        拖动调整顺序，弹窗标签栏按此顺序显示；固定的标签直接显示，其余收在“更多”里。“{tagLabel(UNTAGGED)}”汇总没有任何标签的书签，不能重命名或删除。
      </p>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tags.map((t, i) => (
          <li key={t.key} {...reorder.rowProps(i)} className={`group flex items-center gap-2 px-3 py-1.5 ${reorder.rowClass(i)}`}>
            <GripIcon width={14} height={14} className="shrink-0 cursor-grab text-zinc-300 dark:text-zinc-600" />
            {renaming === t.key ? (
              <input
                className="input h-7 flex-1 py-0 text-sm"
                defaultValue={t.name}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => rename(t, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <span className={`min-w-0 flex-1 truncate text-sm ${t.virtual ? 'text-zinc-500 italic' : ''}`}>{tagLabel(t.name)}</span>
            )}
            <span className="w-10 shrink-0 text-right text-xs text-zinc-400">{t.count}</span>
            <button
              className={`btn-ghost shrink-0 p-1.5 ${t.pinned ? 'text-forest dark:text-mint' : 'text-zinc-400'}`}
              title={t.pinned ? '取消固定' : '固定到标签栏'}
              aria-pressed={t.pinned}
              onClick={() => sendOps([makeTagOp(t.name, { pinned: !t.pinned })])}
            >
              <PinIcon width={14} height={14} filled={t.pinned} />
            </button>
            <button
              className="btn-ghost shrink-0 p-1.5 disabled:invisible"
              title="重命名（改成已有的名称会合并两个标签）"
              disabled={t.virtual}
              onClick={() => setRenaming(t.key)}
            >
              <EditIcon width={14} height={14} />
            </button>
            <button className="btn-danger shrink-0 p-1.5 disabled:invisible" title="删除标签（保留书签）" disabled={t.virtual} onClick={() => remove(t)}>
              <TrashIcon width={14} height={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
