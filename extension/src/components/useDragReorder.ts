import { useState, type HTMLAttributes } from 'react'

/**
 * HTML5 drag-and-drop reordering for a vertical list. On drop, `onMove` receives the
 * dragged id and its new neighbours (undefined at either end); the caller turns that
 * into a rank between the two.
 */
export function useDragReorder(ids: string[], onMove: (id: string, prev?: string, next?: string) => void, enabled = true) {
  // `over` is the insertion index: the dragged item lands before ids[over].
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)

  const drop = () => {
    if (!drag || drag.over === null) return
    const from = ids.indexOf(drag.id)
    const to = drag.over
    if (from < 0 || to === from || to === from + 1) return
    const rest = ids.filter((id) => id !== drag.id)
    const at = to > from ? to - 1 : to
    onMove(drag.id, rest[at - 1], rest[at])
  }

  const rowProps = (i: number): HTMLAttributes<HTMLElement> =>
    enabled
      ? {
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.effectAllowed = 'move'
            setDrag({ id: ids[i], over: null })
          },
          onDragOver: (e) => {
            if (!drag) return
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const over = e.clientY > r.top + r.height / 2 ? i + 1 : i
            if (over !== drag.over) setDrag({ ...drag, over })
          },
          onDrop: (e) => {
            e.preventDefault()
            drop()
            setDrag(null)
          },
          onDragEnd: () => setDrag(null),
        }
      : {}

  /** Dims the dragged row and draws an insertion line. */
  const rowClass = (i: number): string => {
    if (!drag) return ''
    const cls: string[] = []
    if (drag.id === ids[i]) cls.push('opacity-40')
    if (drag.over === i) cls.push('shadow-[inset_0_2px_0_0_var(--color-forest)] dark:shadow-[inset_0_2px_0_0_var(--color-mint)]')
    else if (drag.over === i + 1 && i === ids.length - 1)
      cls.push('shadow-[inset_0_-2px_0_0_var(--color-forest)] dark:shadow-[inset_0_-2px_0_0_var(--color-mint)]')
    return cls.join(' ')
  }

  return { rowProps, rowClass }
}
