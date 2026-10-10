/** Uses Chrome's built-in favicon cache (requires the "favicon" permission). */
export function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=${size * 2}`
  return <img src={src} width={size} height={size} alt="" className="block shrink-0 rounded-sm" loading="lazy" />
}
