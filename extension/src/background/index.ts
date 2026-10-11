import { api } from '../lib/api'
import { chunkImport, rankImport, type ImportPlan } from '../lib/importer'
import type { AddResult, Message, Reply, StashResult } from '../lib/messages'
import { buildState, findByUrl, makeCreateOp, makeDeleteOp, makeStashCreateOp, makeUpdateOp, rankForTags } from '../lib/ops'
import { stashItemsFromTabs, TABS_PERMISSION } from '../lib/stash'
import { getItem, isConfigured, patchItem, setItem } from '../lib/storage'
import { createSyncEngine } from '../lib/sync'
import { describeSync, type SyncTone } from '../lib/syncStatus'
import type { UpdatePayload } from '../lib/types'

const MENU_PAGE = 'linkpark-add-page'
const MENU_LINK = 'linkpark-add-link'
const MENU_STASH = 'linkpark-stash-window'
const MENU_SYNC = 'linkpark-sync-now'
const RETRY_ALARM = 'linkpark-retry'
const PERIODIC_ALARM = 'linkpark-periodic'
// chrome.alarms cannot fire sooner than 30s; shorter backoffs use a timer while the worker is alive.
const MIN_ALARM_MS = 30_000
const IMPORT_CHUNK = 1000
// Favicons are data URLs; 1000 of them can exceed the 16MB request limit.
const IMPORT_CHUNK_BYTES = 8 << 20

let retryTimer: ReturnType<typeof setTimeout> | undefined

const engine = createSyncEngine({
  get: getItem,
  set: setItem,
  api,
  scheduleRetry(delay) {
    clearTimeout(retryTimer)
    if (delay < MIN_ALARM_MS) retryTimer = setTimeout(() => void engine.sync(), delay)
    chrome.alarms.create(RETRY_ALARM, { when: Date.now() + Math.max(delay, MIN_ALARM_MS) })
  },
  cancelRetry() {
    clearTimeout(retryTimer)
    void chrome.alarms.clear(RETRY_ALARM)
  },
  onChange: () => void updateBadge(),
})

// ---------- badge ----------

let flashing = false

const TONE_COLORS: Record<SyncTone, string> = {
  ok: '#4f46e5',
  busy: '#4f46e5',
  warn: '#d97706',
  error: '#dc2626',
}

/** The toolbar icon is the sync status indicator: badge for state, tooltip for details. */
async function updateBadge(): Promise<void> {
  const [outbox, failed, state, settings] = await Promise.all([getItem('outbox'), getItem('failed'), getItem('syncState'), getItem('settings')])
  const configured = isConfigured(settings)
  const { label, tone } = describeSync({ configured, state, pending: outbox.length, failed: failed.length })

  const lines = [`LinkPark · ${label}`]
  if (state.lastError && tone !== 'ok') lines.push(state.lastError)
  if (configured && state.lastSyncAt) lines.push(`上次同步：${new Date(state.lastSyncAt).toLocaleString()}`)
  if (state.notice) lines.push(state.notice)
  if (!configured) lines.push('右键点击图标打开设置')
  await chrome.action.setTitle({ title: lines.join('\n') })

  if (flashing) return
  let text = ''
  if (!configured) text = '?'
  else if (tone === 'error') text = '!'
  else if (outbox.length > 0) text = outbox.length > 99 ? '99+' : String(outbox.length)
  await setBadge(text, TONE_COLORS[tone])
}

async function setBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
}

async function flash(text: string, color: string): Promise<void> {
  flashing = true
  await setBadge(text, color)
  setTimeout(() => {
    flashing = false
    void updateBadge()
  }, 1500)
}

// ---------- actions ----------

let syncTimer: ReturnType<typeof setTimeout> | undefined

/** Coalesces bursts of edits into one batch. */
function syncSoon(): void {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void engine.sync(), 300)
}

async function addBookmark(input: { url: string; title: string; favicon?: string; tags?: string[] }): Promise<AddResult> {
  const settings = await getItem('settings')
  if (!isConfigured(settings)) {
    await chrome.runtime.openOptionsPage()
    return { status: 'unconfigured' }
  }
  const url = input.url.trim()
  if (!url) throw new Error('链接为空')
  const { bookmarks } = buildState(await getItem('cache'), await getItem('outbox'))
  const existing = findByUrl(bookmarks, url)
  if (existing) return { status: 'exists', id: existing.id }

  const op = makeCreateOp({ ...input, url, title: input.title || url, rank: rankForTags(bookmarks, input.tags ?? []) })
  await engine.enqueue(op)
  syncSoon()
  return { status: 'added', id: op.id }
}

/** A bookmark filed out of "未分类" moves next to its new tag; later tag edits keep its place. */
async function updateBookmark(id: string, patch: UpdatePayload): Promise<void> {
  if (patch.tags?.length && patch.rank === undefined) {
    const { bookmarks } = buildState(await getItem('cache'), await getItem('outbox'))
    const cur = bookmarks.find((b) => b.id === id)
    if (cur && cur.tags.length === 0) {
      patch = { ...patch, rank: rankForTags(bookmarks.filter((b) => b.id !== id), patch.tags) }
    }
  }
  await engine.enqueue(makeUpdateOp(id, patch))
  syncSoon()
}

async function stashWindow(windowId: number): Promise<StashResult> {
  const settings = await getItem('settings')
  if (!isConfigured(settings)) {
    await chrome.runtime.openOptionsPage()
    return { status: 'unconfigured' }
  }
  const items = stashItemsFromTabs(await chrome.tabs.query({ windowId }))
  if (items.length === 0) return { status: 'empty' }
  await engine.enqueue(makeStashCreateOp(items))
  syncSoon()
  return { status: 'stashed', count: items.length }
}

async function runImport(plan: ImportPlan): Promise<{ imported: number; skipped: number }> {
  const settings = await getItem('settings')
  if (!isConfigured(settings)) throw new Error('请先配置服务端')
  const view = buildState(await getItem('cache'), await getItem('outbox'))
  const tagRanks = Object.values(view.tags).map((t) => t.rank).filter(Boolean).sort()
  const { items, tags } = rankImport(plan, {
    lastBookmarkRank: view.bookmarks.at(-1)?.rank,
    firstTagRank: tagRanks[0],
    lastTagRank: tagRanks.at(-1),
  })
  let imported = 0
  let skipped = 0
  const chunks = items.length ? chunkImport(items, IMPORT_CHUNK, IMPORT_CHUNK_BYTES) : [[]]
  for (const [i, chunk] of chunks.entries()) {
    const res = await api.import(settings, chunk, i === 0 ? tags : [])
    imported += res.imported
    skipped += res.skipped
  }
  // Stashes list newest first; stepping the timestamps back keeps folder order top-down.
  const now = Date.now()
  for (const [i, s] of plan.stashes.entries()) await engine.enqueue(makeStashCreateOp(s.items, s.name, now - i))
  await patchItem('onboarding', { importDone: true })
  await engine.sync({ full: true })
  return { imported, skipped }
}

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'add':
      return addBookmark(msg)
    case 'update':
      return updateBookmark(msg.id, msg.patch)
    case 'delete':
      await engine.enqueue(makeDeleteOp(msg.id))
      syncSoon()
      return
    case 'ops':
      for (const op of msg.ops) await engine.enqueue(op)
      syncSoon()
      return
    case 'stashWindow':
      return stashWindow(msg.windowId)
    case 'sync':
      void engine.sync()
      return
    case 'resync':
      await engine.resetAndResync()
      return
    case 'import':
      return runImport({ items: msg.items, tags: msg.tags, stashes: msg.stashes })
    case 'retryFailed':
      await engine.retryFailed()
      return
    case 'discardFailed':
      await engine.discardFailed()
      return
    case 'settingsChanged':
      if (msg.serverChanged) await engine.resetAndResync()
      else await engine.sync({ full: true })
      return
  }
}

// ---------- event wiring (must be registered synchronously at top level) ----------

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handle(msg).then(
    (data) => sendResponse({ ok: true, data } satisfies Reply<unknown>),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Reply<unknown>),
  )
  return true
})

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: '添加到 LinkPark', contexts: ['page'] })
    chrome.contextMenus.create({ id: MENU_LINK, title: '添加链接到 LinkPark', contexts: ['link'] })
    chrome.contextMenus.create({ id: MENU_STASH, title: '暂存当前窗口的所有标签页', contexts: ['page', 'action'] })
    chrome.contextMenus.create({ id: MENU_SYNC, title: '立即同步', contexts: ['action'] })
  })
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') })
  }
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SYNC) return engine.sync({ full: true })
  if (info.menuItemId === MENU_STASH) {
    // The menu click is the user gesture; request before awaiting anything else.
    const granted = chrome.permissions.request(TABS_PERMISSION).catch(() => false)
    try {
      if (!(await granted)) return await flash('×', '#dc2626')
      const res = await stashWindow(tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT)
      if (res.status === 'stashed') await flash(res.count > 99 ? '99+' : String(res.count), '#16a34a')
      else if (res.status === 'empty') await flash('0', '#6b7280')
    } catch {
      await flash('×', '#dc2626')
    }
    return
  }
  const isLink = info.menuItemId === MENU_LINK
  const url = (isLink ? info.linkUrl : info.pageUrl || tab?.url) ?? ''
  const title = isLink ? info.selectionText || url : tab?.title || url
  try {
    const res = await addBookmark({ url, title, favicon: isLink ? '' : tab?.favIconUrl })
    if (res.status === 'added') await flash('+', '#16a34a')
    else if (res.status === 'exists') await flash('=', '#6b7280')
  } catch {
    await flash('×', '#dc2626')
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM || alarm.name === PERIODIC_ALARM) void engine.sync()
})

chrome.runtime.onStartup.addListener(() => void engine.sync())

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'settings' in changes) void updateBadge()
})

self.addEventListener('online', () => void engine.sync())

void (async () => {
  if (!(await chrome.alarms.get(PERIODIC_ALARM))) {
    await chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: 30 })
  }
  // Resume anything left over if the worker was restarted mid-retry.
  if ((await getItem('outbox')).length > 0) void engine.sync()
  await updateBadge()
})()
