import { useEffect, useState } from 'react'
import { getItem, type StorageKey, type StorageSchema } from '../lib/storage'

/** Live view of a chrome.storage.local key; undefined until the first read resolves. */
export function useStorage<K extends StorageKey>(key: K): StorageSchema[K] | undefined {
  const [value, setValue] = useState<StorageSchema[K]>()

  useEffect(() => {
    let alive = true
    void getItem(key).then((v) => alive && setValue(v))
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) void getItem(key).then((v) => alive && setValue(v))
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [key])

  return value
}
