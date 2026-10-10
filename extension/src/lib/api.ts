import type { ImportItem, ImportResponse, Op, OpsResponse, PullResponse, Settings } from './types'

/** status 0 means the request never got an HTTP response (offline, DNS, timeout...). */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }

  /** Network failures, server errors and throttling are worth retrying; other 4xx are not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500
  }
}

const TIMEOUT_MS = 20_000

async function request<T>(settings: Settings, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(settings.serverUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new ApiError(0, `无法连接服务端：${(e as Error).message}`)
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) msg = `${msg}: ${data.error}`
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

export const api = {
  postOps: (s: Settings, ops: Op[]) => request<OpsResponse>(s, 'POST', '/api/v1/ops', { ops }),
  pull: (s: Settings, since: number) => request<PullResponse>(s, 'GET', `/api/v1/bookmarks?since=${since}`),
  import: (s: Settings, bookmarks: ImportItem[]) => request<ImportResponse>(s, 'POST', '/api/v1/import', { bookmarks }),
  tags: (s: Settings) => request<{ tags: { name: string; count: number }[] }>(s, 'GET', '/api/v1/tags'),
}
