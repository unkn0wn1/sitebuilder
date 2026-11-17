// Browser client for /api/v1. The session cookie is sent automatically; the browser sets Origin on writes.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (data.error ?? {}) as Record<string, unknown>
    throw new ApiError(res.status, typeof err.code === 'string' ? err.code : 'internal', typeof err.message === 'string' ? err.message : 'Something went wrong.', err)
  }
  return data as T
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (data.error ?? {}) as Record<string, unknown>
    throw new ApiError(res.status, typeof err.code === 'string' ? err.code : 'internal', typeof err.message === 'string' ? err.message : 'Something went wrong.', err)
  }
  return data as T
}

export async function waitForJob(id: string, timeoutMs = 20_000): Promise<{ state: string; lastError: string | null }> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const job = await api<{ state: string; lastError: string | null }>(`/jobs/${id}`)
    if (job.state === 'done' || job.state === 'failed') return job
    if (Date.now() > end) throw new ApiError(408, 'timeout', 'Making web-friendly sizes is taking longer than expected. Refresh in a moment.')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
