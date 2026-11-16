// A tiny API client with a session cookie and the Origin header the CSRF check expects.
export interface ApiResponse<T = any> {
  status: number
  body: T
}

export class Client {
  private cookie = ''
  constructor(private baseUrl: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, opts: { origin?: string | null; form?: FormData } = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {}
    if (this.cookie) headers.cookie = this.cookie
    if (opts.origin !== null) headers.origin = opts.origin ?? this.baseUrl
    let payload: BodyInit | undefined
    if (opts.form) payload = opts.form
    else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, { method, headers, body: payload })
    const set = res.headers.getSetCookie().find((c) => c.startsWith('sb_session='))
    if (set) this.cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : await res.arrayBuffer()) as T }
  }

  get = <T = any>(path: string) => this.req<T>('GET', path)
  post = <T = any>(path: string, body: unknown = {}) => this.req<T>('POST', path, body)
  patch = <T = any>(path: string, body: unknown) => this.req<T>('PATCH', path, body)
  put = <T = any>(path: string, body: unknown) => this.req<T>('PUT', path, body)
  del = <T = any>(path: string) => this.req<T>('DELETE', path)

  async login(email: string, password: string) {
    const r = await this.post('/auth/login', { email, password })
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`)
    return r
  }

  /** Wait for a background job to finish. */
  async job(id: string, timeoutMs = 20_000) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const r = await this.get(`/jobs/${id}`)
      if (r.body.state === 'done' || r.body.state === 'failed') return r.body
      if (Date.now() > end) throw new Error(`job ${id} still ${r.body.state}`)
      await new Promise((res) => setTimeout(res, 150))
    }
  }
}
