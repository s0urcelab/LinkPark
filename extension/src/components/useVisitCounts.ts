import { useEffect, useState } from 'react'
import { countVisits } from '../lib/ops'

export const HISTORY_PERMISSION: chrome.permissions.Permissions = { permissions: ['history'] }

/**
 * Visit counts from browser history, keyed by visitKey(url). `granted` is undefined
 * while checking; re-runs when the optional "history" permission is granted later.
 */
export function useVisitCounts(enabled: boolean): { visits?: Map<string, number>; granted?: boolean } {
  const [visits, setVisits] = useState<Map<string, number>>()
  const [granted, setGranted] = useState<boolean>()
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const onAdded = () => setNonce((n) => n + 1)
    chrome.permissions.onAdded.addListener(onAdded)
    return () => chrome.permissions.onAdded.removeListener(onAdded)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    void (async () => {
      const ok = await chrome.permissions.contains(HISTORY_PERMISSION)
      if (!alive) return
      setGranted(ok)
      if (!ok) return
      const items = await chrome.history.search({ text: '', startTime: 0, maxResults: 100_000 })
      if (alive) setVisits(countVisits(items))
    })()
    return () => {
      alive = false
    }
  }, [enabled, nonce])

  return { visits, granted }
}
