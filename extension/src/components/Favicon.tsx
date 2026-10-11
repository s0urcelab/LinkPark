import { useEffect, useState } from 'react'
import { faviconCacheURL, pickFaviconSrc, usableFavicon } from '../lib/favicon'

/**
 * Chrome's favicon cache when this profile has a real icon (so a site that changes
 * its icon shows the new one after a visit), otherwise the copy stored at import.
 */
export function Favicon({ url, stored, size = 16 }: { url: string; stored?: string; size?: number }) {
  const fallback = usableFavicon(stored)
  const px = size * 2
  const [src, setSrc] = useState(() => (fallback ? '' : faviconCacheURL(url, px)))

  useEffect(() => {
    if (!fallback) {
      setSrc(faviconCacheURL(url, px))
      return
    }
    let cancel = false
    void pickFaviconSrc(url, fallback, px).then((next) => {
      if (!cancel) setSrc(next)
    })
    return () => {
      cancel = true
    }
  }, [url, fallback, px])

  if (!src) return <span className="block shrink-0" style={{ width: size, height: size }} />
  return <img src={src} width={size} height={size} alt="" className="block shrink-0 rounded-sm" loading="lazy" />
}
