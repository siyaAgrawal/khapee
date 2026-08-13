const TOKEN_KEY = 'tablo.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage disabled — session simply won't persist */
  }
}

export class ApiError extends Error {
  status: number
  reason?: string
  constructor(message: string, status: number, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  }

  const text = await res.text()
  const data = text ? safeParse(text) : {}
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.reason)
  }
  return data as T
}

function safeParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return { error: 'Unexpected response from the server.' }
  }
}

/** Opens the SSE stream, falling back silently if the browser blocks it. */
export function openStream(onEvent: (type: string, payload: any) => void): () => void {
  const token = getToken()
  let source: EventSource | null = null
  try {
    source = new EventSource(`/api/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`)
  } catch {
    return () => {}
  }
  const handle = (type: string) => (e: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(e.data))
    } catch {
      onEvent(type, null)
    }
  }
  source.addEventListener('order:new', handle('order:new'))
  source.addEventListener('order:update', handle('order:update'))
  return () => source?.close()
}
