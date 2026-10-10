import { api } from '../lib/api'
import type { AddResult, Message, Reply } from '../lib/messages'
import { buildView, findByUrl, makeCreateOp, makeDeleteOp, makeUpdateOp } from '../lib/ops'
import { getItem, isConfigured, patchItem, setItem } from '../lib/storage'
import { createSyncEngine } from '../lib/sync'
import { describeSync, type SyncTone } from '../lib/syncStatus'
import type { ImportItem } from '../lib/types'

const MENU_PAGE = 'linkpark-add-page'
const MENU_LINK = 'linkpark-add-link'
const MENU_SYNC = 'linkpark-sync-now'
const RETRY_ALARM = 'linkpark-retry'
const PERIODIC_ALARM = 'linkpark-periodic'
// chrome.alarms cannot fire sooner than 30s; shorter backoffs use a timer while the worker is alive.
const MIN_ALARM_MS = 30_000
const IMPORT_CHUNK = 1000

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
  const view = buildView(await getItem('cache'), await getItem('outbox'))
  const existing = findByUrl(view, url)
  if (existing) return { status: 'exists', id: existing.id }

  const op = makeCreateOp({ ...input, url, title: input.title || url })
  await engine.enqueue(op)
  syncSoon()
  return { status: 'added', id: op.bookmark_id }
}

async function runImport(items: ImportItem[]): Promise<{ imported: number; skipped: number }> {
  const settings = await getItem('settings')
  if (!isConfigured(settings)) throw new Error('请先配置服务端')
  let imported = 0
  let skipped = 0
  for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
    const res = await api.import(settings, items.slice(i, i + IMPORT_CHUNK))
    imported += res.imported
    skipped += res.skipped
  }
  await patchItem('onboarding', { importDone: true })
  await engine.sync({ full: true })
  return { imported, skipped }
}

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'add':
      return addBookmark(msg)
    case 'update':
      await engine.enqueue(makeUpdateOp(msg.id, msg.patch))
      syncSoon()
      return
    case 'delete':
      await engine.enqueue(makeDeleteOp(msg.id))
      syncSoon()
      return
    case 'sync':
      void engine.sync()
      return
    case 'resync':
      await engine.resetAndResync()
      return
    case 'import':
      return runImport(msg.items)
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
    chrome.contextMenus.create({ id: MENU_SYNC, title: '立即同步', contexts: ['action'] })
  })
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') })
  }
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SYNC) return engine.sync({ full: true })
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
