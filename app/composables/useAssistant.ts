import { api, ApiError } from '../utils/api'
import type { PageEditor } from '../utils/page-editor'
import type { PageDoc } from '#shared/page'
import type { PageMeta } from '#shared/ops'
import type { WorkflowState } from '#shared/workflow'

export type AssistantState =
  | 'ready'
  | 'thinking'
  | 'working'
  | 'checking'
  | 'needs_you'
  | 'done'
  | 'stopped'
  | 'limit'
  | 'monthly'
  | 'unavailable'
  | 'off'

export interface AssistantStatus {
  enabled: boolean
  available: boolean
  reason: string
  message: string | null
}

export interface ChatLine {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  tool?: string
  needsYou?: unknown
}

export interface AssistantNeedsYou {
  tool: string
  result: Record<string, unknown>
}

export function useAssistant(editor: MaybeRefOrGetter<PageEditor | null>) {
  const status = ref<AssistantStatus | null>(null)
  const state = ref<AssistantState>('ready')
  const sessionId = ref<string | null>(null)
  const lines = ref<ChatLine[]>([])
  const needsYou = ref<AssistantNeedsYou | null>(null)
  const draft = ref('')
  const error = ref('')
  let line = 0

  const available = computed(() => status.value?.available === true)
  const greeting = 'I can help you write and change this page. Ask me to add a section, tighten the wording, or check how it looks.'
  const suggestions = ['Shorten the hero heading', 'Add a quote from a volunteer', 'Draft a call to action']

  async function refreshStatus() {
    try {
      status.value = await api<AssistantStatus>('/ai/status')
      if (!status.value.available) state.value = status.value.reason === 'off' ? 'off' : status.value.reason === 'monthly' ? 'monthly' : 'unavailable'
      else if (state.value === 'off' || state.value === 'unavailable' || state.value === 'monthly') state.value = 'ready'
    } catch {
      status.value = { enabled: false, available: false, reason: 'unavailable', message: "The assistant isn't available right now. Everything else works as normal." }
      state.value = 'unavailable'
    }
  }

  async function ensureSession() {
    const page = toValue(editor)
    if (!page || sessionId.value) return sessionId.value
    const data = await api<{ session: { id: string } }>('/ai/sessions', { method: 'POST', body: { taskType: 'page_edit', targetId: page.pageId } })
    sessionId.value = data.session.id
    try {
      const stored = await api<{ messages: { id: string; role: 'user' | 'assistant' | 'tool'; content: Record<string, unknown> }[] }>(`/ai/sessions/${data.session.id}`)
      for (const row of stored.messages) {
        if (row.role === 'user' && typeof row.content.text === 'string') push('user', row.content.text, row.id)
        else if (row.role === 'assistant' && typeof row.content.text === 'string' && row.content.text.trim()) push('assistant', row.content.text, row.id)
      }
    } catch {
      /* a missing history is fine */
    }
    return sessionId.value
  }

  function push(role: ChatLine['role'], text: string, id?: string, extra: Partial<ChatLine> = {}) {
    lines.value.push({ id: id ?? `line_${++line}`, role, text, ...extra })
  }

  async function reloadPage() {
    const page = toValue(editor)
    if (!page) return
    try {
      const data = await api<{ doc: PageDoc; revision: number; page: { title: string; path: string; slug: string; parentId: string | null; workflowState: WorkflowState } }>(`/pages/${page.pageId}`)
      page.replaceFromServer({
        doc: data.doc,
        revision: data.revision,
        meta: { slug: data.page.slug, parentId: data.page.parentId } satisfies PageMeta,
        path: data.page.path,
        title: data.page.title,
        state: data.page.workflowState,
      })
    } catch {
      /* the next autosave or reload will catch up */
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !available.value) return
    error.value = ''
    needsYou.value = null
    draft.value = ''
    const page = toValue(editor)
    if (page) await page.flush()
    push('user', trimmed)
    state.value = 'thinking'
    let id: string | null = null
    try {
      id = await ensureSession()
    } catch (err) {
      state.value = 'unavailable'
      error.value = err instanceof ApiError ? err.message : "The assistant isn't available right now. Everything else works as normal."
      return
    }
    if (!id) return

    try {
      const res = await fetch(`/api/v1/ai/sessions/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok) {
        const body = type.includes('json') ? ((await res.json()) as { error?: { message?: string; code?: string } }) : null
        if (body?.error?.code === 'ai_unavailable') {
          state.value = /budget/i.test(body.error.message ?? '') ? 'monthly' : 'unavailable'
          error.value = body.error.message ?? "The assistant isn't available right now. Everything else works as normal."
          return
        }
        throw new Error(body?.error?.message ?? 'The assistant could not reply.')
      }
      if (!res.body) throw new Error('The assistant could not reply.')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistant = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const evName = chunk.match(/^event: (\w+)/m)?.[1]
          const dataLine = chunk
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('')
          if (!evName || !dataLine) continue
          const data = JSON.parse(dataLine) as Record<string, unknown>
          if (evName === 'text' && typeof data.text === 'string') {
            assistant += data.text
            const last = lines.value.at(-1)
            if (last?.role === 'assistant' && last.id.startsWith('live_')) last.text = assistant
            else push('assistant', assistant, 'live_assistant')
          } else if (evName === 'tool_started') {
            state.value = data.tool === 'preview_screenshot' || data.tool === 'run_checks' ? 'checking' : 'working'
            push('tool', `Using ${String(data.tool).replaceAll('_', ' ')}…`, undefined, { tool: String(data.tool) })
          } else if (evName === 'tool_result') {
            if (data.ok) await reloadPage()
          } else if (evName === 'needs_you') {
            state.value = 'needs_you'
            needsYou.value = { tool: String(data.tool), result: (data.result ?? {}) as Record<string, unknown> }
          } else if (evName === 'finished') {
            const reason = String(data.reason ?? 'done') as AssistantState
            state.value = reason === 'done' ? 'done' : reason === 'limit' ? 'limit' : reason === 'monthly' ? 'monthly' : reason === 'stopped' ? 'stopped' : reason === 'unavailable' ? 'unavailable' : 'done'
            const message = typeof data.message === 'string' ? data.message : ''
            if (message && !assistant.includes(message)) push('assistant', message)
          } else if (evName === 'error') {
            state.value = 'unavailable'
            error.value = typeof data.message === 'string' ? data.message : "The assistant isn't available right now. Everything else works as normal."
          }
        }
      }
      if (state.value === 'thinking' || state.value === 'working' || state.value === 'checking') state.value = 'done'
    } catch (err) {
      state.value = 'unavailable'
      error.value = err instanceof Error ? err.message : "The assistant isn't available right now. Everything else works as normal."
    }
  }

  async function stop() {
    if (!sessionId.value) return
    try {
      await api(`/ai/sessions/${sessionId.value}/cancel`, { method: 'POST', body: { endSession: false } })
    } catch {
      /* the stream will close on its own */
    }
  }

  return { status, state, available, greeting, suggestions, lines, needsYou, draft, error, refreshStatus, ensureSession, send, stop }
}
