import { api, ApiError } from '../utils/api'
import { canSubmit as stateAllowsSubmit } from '#shared/workflow'
import type { SitePartDoc } from '#shared/site-parts'
import type { FieldIssue } from '#shared/issues'
import type { SitePartDetail } from '../utils/site-parts'
import { cloneDraft } from '#shared/clone'

export type PartSaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

export function useSitePartEditor(id: MaybeRefOrGetter<string>) {
  const detail = ref<SitePartDetail | null>(null)
  const doc = ref<SitePartDoc | null>(null)
  const revision = ref(0)
  const saveStatus = ref<PartSaveStatus>('saved')
  const error = ref('')
  const warnings = ref<FieldIssue[]>([])
  const conflict = ref<{ message: string; current: { revision: number; doc: SitePartDoc } } | null>(null)
  const submitting = ref(false)
  const dirty = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null

  const part = computed(() => detail.value?.part ?? null)
  const hasUnpublishedChanges = computed(() => {
    const p = part.value
    return !!p && !!p.publishedVersionId && p.publishedVersionId !== p.draftVersionId
  })
  const canSubmitNow = computed(() => {
    const p = part.value
    if (!p || !doc.value) return false
    if (!stateAllowsSubmit(p.workflowState)) return false
    return p.draftVersionId !== p.publishedVersionId
  })

  async function load() {
    error.value = ''
    const data = await api<SitePartDetail>(`/site-parts/${toValue(id)}`)
    detail.value = data
    doc.value = cloneDraft(data.doc)
    revision.value = data.revision
    warnings.value = data.checks.warnings
    dirty.value = false
    conflict.value = null
    saveStatus.value = 'saved'
  }

  function scheduleSave() {
    if (!doc.value || conflict.value) return
    dirty.value = true
    saveStatus.value = 'saving'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, 600)
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (inflight) await inflight
    if (!doc.value || conflict.value || !dirty.value) return
    const base = revision.value
    saveStatus.value = 'saving'
    error.value = ''
    inflight = (async () => {
      try {
        const sending = cloneDraft(doc.value)
        const result = await api<{ revision: number; doc: SitePartDoc; warnings: FieldIssue[]; reviewWithdrawn?: boolean }>(`/site-parts/${toValue(id)}/ops`, {
          method: 'POST',
          body: { baseRevision: base, ops: [{ op: 'replace', doc: sending }] },
        })
        revision.value = result.revision
        warnings.value = result.warnings ?? []
        if (detail.value) {
          detail.value.part.draftRevision = result.revision
          if (result.reviewWithdrawn) detail.value.part.workflowState = detail.value.part.publishedVersionId ? 'published' : 'draft'
        }
        dirty.value = false
        saveStatus.value = 'saved'
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict') {
          const current = (err.details as { current?: { revision: number; doc: SitePartDoc } }).current
          if (current) {
            conflict.value = { message: err.message, current }
            saveStatus.value = 'conflict'
            return
          }
        }
        error.value = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not save this change.'
        saveStatus.value = 'error'
      } finally {
        inflight = null
      }
    })()
    await inflight
  }

  function keepMine() {
    if (!conflict.value) return
    revision.value = conflict.value.current.revision
    conflict.value = null
    dirty.value = true
    void flush()
  }

  function useTheirs() {
    if (!conflict.value) return
    doc.value = cloneDraft(conflict.value.current.doc)
    revision.value = conflict.value.current.revision
    conflict.value = null
    dirty.value = false
    saveStatus.value = 'saved'
  }

  async function submit(note?: string) {
    await flush()
    if (conflict.value || saveStatus.value === 'error') return
    submitting.value = true
    error.value = ''
    try {
      await api(`/site-parts/${toValue(id)}/submit`, { method: 'POST', body: note ? { note } : {} })
      await load()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Could not submit this for approval.'
    } finally {
      submitting.value = false
    }
  }

  function patch(next: SitePartDoc) {
    doc.value = next
    scheduleSave()
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    void flush()
  })

  return { detail, part, doc, revision, saveStatus, error, warnings, conflict, submitting, hasUnpublishedChanges, canSubmitNow, load, flush, patch, keepMine, useTheirs, submit }
}
