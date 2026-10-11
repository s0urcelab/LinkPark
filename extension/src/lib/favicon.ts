/**
 * Chrome serves a generic globe when a page has no cached favicon. Comparing against
 * that image (probed once per size) tells a real icon from the placeholder, so a dead
 * site can still show the copy saved at import time.
 */

/** A 32px PNG data URL fits comfortably; anything larger is dropped instead of truncated. */
export const MAX_FAVICON_LEN = 65536

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/]+={0,2}$/i

/** A URL Chrome has never visited, so `/_favicon/` answers with the default globe. */
const PROBE_URL = 'https://favicon.invalid/'

const CAPTURE_SIZE = 32
const CAPTURE_CONCURRENCY = 8

export type FaviconSource = 'cache' | 'stored'

/** Keeps a compact raster data URL. Remote URLs and anything else are discarded. */
export function usableFavicon(raw?: string): string {
  if (!raw) return ''
  const s = raw.replace(/\s+/g, '')
  if (s.length > MAX_FAVICON_LEN || !DATA_IMAGE.test(s)) return ''
  return s
}

/** Live cache when Chrome has a real icon; the stored copy only when it has the globe. */
export function chooseFavicon(page: Uint8Array | null, fallback: Uint8Array | null): FaviconSource {
  if (!page || !fallback || page.length !== fallback.length) return 'cache'
  for (let i = 0; i < page.length; i++) if (page[i] !== fallback[i]) return 'cache'
  return 'stored'
}

export function faviconCacheURL(pageUrl: string, size: number): string {
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`
}

async function fetchIcon(pageUrl: string, size: number): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await fetch(faviconCacheURL(pageUrl, size))
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytes.length) return null
    const mime = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim().toLowerCase()
    return { bytes, mime: mime.startsWith('image/') ? mime : 'image/png' }
  } catch {
    return null
  }
}

const defaultIcon = new Map<number, Promise<Uint8Array | null>>()

function globe(size: number): Promise<Uint8Array | null> {
  let pending = defaultIcon.get(size)
  if (!pending) {
    pending = fetchIcon(PROBE_URL, size).then((icon) => icon?.bytes ?? null)
    defaultIcon.set(size, pending)
  }
  return pending
}

function toDataURL(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step))
  return usableFavicon(`data:${mime};base64,${btoa(bin)}`)
}

/**
 * Fills missing favicons from Chrome's cache. The globe placeholder is not stored,
 * and an icon already present (for example from an HTML export) is left as-is.
 */
export async function fillFavicons<T extends { url: string; favicon?: string }>(
  items: T[],
  onProgress?: (done: number, total: number) => void,
): Promise<T[]> {
  const known = new Map<string, string>()
  for (const it of items) {
    const icon = usableFavicon(it.favicon)
    if (icon && !known.has(it.url)) known.set(it.url, icon)
  }
  const urls = [...new Set(items.map((it) => it.url))].filter((url) => !known.has(url))
  if (urls.length) {
    const def = await globe(CAPTURE_SIZE)
    let done = 0
    let cursor = 0
    const worker = async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++]
        const icon = await fetchIcon(url, CAPTURE_SIZE)
        if (def && icon && chooseFavicon(icon.bytes, def) === 'cache') {
          const data = toDataURL(icon.bytes, icon.mime)
          if (data) known.set(url, data)
        }
        done++
        if (onProgress && (done === 1 || done === urls.length || done % 25 === 0)) onProgress(done, urls.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CAPTURE_CONCURRENCY, urls.length) }, () => worker()))
  }

  return items.map((it) => {
    const icon = known.get(it.url)
    if (!icon) {
      if (!it.favicon) return it
      const copy = { ...it }
      delete copy.favicon
      return copy
    }
    return it.favicon === icon ? it : { ...it, favicon: icon }
  })
}

const choice = new Map<string, FaviconSource>()

/** Which image to show: Chrome's cache, unless it only has the globe and a copy was stored. */
export async function pickFaviconSrc(pageUrl: string, stored: string, size: number): Promise<string> {
  const cacheSrc = faviconCacheURL(pageUrl, size)
  const key = `${size}\n${pageUrl}`
  const prev = choice.get(key)
  if (prev === 'cache') return cacheSrc
  if (prev === 'stored') return stored
  const [icon, def] = await Promise.all([fetchIcon(pageUrl, size), globe(size)])
  const src = chooseFavicon(icon?.bytes ?? null, def)
  choice.set(key, src)
  return src === 'stored' ? stored : cacheSrc
}
