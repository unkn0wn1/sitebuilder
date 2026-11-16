import { beforeAll, describe, expect, inject, it } from 'vitest'
import { Client } from './client'

const baseUrl = inject('baseUrl')
const users = inject('users')
const editor = new Client(baseUrl)
const approver = new Client(baseUrl)
const admin = new Client(baseUrl)

beforeAll(async () => {
  await editor.login(users.editor, users.password)
  await approver.login(users.approver, users.password)
  await admin.login(users.admin, users.password)
})

const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('pages over HTTP', () => {
  it('create, edit with conflicts, submit, approve the pinned version, publish, unpublish, bin and restore', async () => {
    const created = await editor.post('/pages', { title: 'Winter appeal', template: 'standard' })
    expect(created.status).toBe(200)
    const id = created.body.page.id as string
    expect(created.body.page.path).toBe('/winter-appeal')

    const e1 = await editor.post(`/pages/${id}/ops`, { baseRevision: 0, ops: [{ op: 'add_block', block: { type: 'RichText', props: { content: para('Help us keep animals warm.') } } }] })
    expect(e1.status).toBe(200)
    const blockId = e1.body.doc.blocks[0].id as string

    // Both have seen revision 1. The editor changes the text first; the approver's change to the same text conflicts.
    const e2 = await editor.post(`/pages/${id}/ops`, { baseRevision: e1.body.revision, ops: [{ op: 'update_props', blockId, props: { content: para('Help us keep every animal warm.') } }] })
    expect(e2.status).toBe(200)
    const c = await approver.post(`/pages/${id}/ops`, { baseRevision: e1.body.revision, ops: [{ op: 'update_props', blockId, props: { content: para('Different words.') } }] })
    expect(c.status).toBe(409)
    expect(c.body.error.code).toBe('conflict')
    expect(c.body.error.current.revision).toBe(e2.body.revision)
    // A change to something else from the same old revision goes through.
    expect((await approver.post(`/pages/${id}/ops`, { baseRevision: e1.body.revision, ops: [{ op: 'set_seo', description: 'Our winter appeal' }] })).status).toBe(200)

    const bad = await editor.post(`/pages/${id}/ops`, { baseRevision: e2.body.revision, ops: [{ op: 'add_block', block: { type: 'Script', props: {} } }] })
    expect(bad.status).toBe(400)

    const sub = await editor.post(`/pages/${id}/submit`, { note: 'Ready' })
    expect(sub.status).toBe(200)
    expect((await editor.get('/reviews')).body.items.map((r: { id: string }) => r.id)).toContain(sub.body.reviewId)

    const wrong = await approver.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: 'ver_wrong' })
    expect(wrong.status).toBe(409)
    expect((await editor.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })).status).toBe(403)
    const ok = await approver.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })
    expect(ok.status).toBe(200)
    expect((await approver.job(ok.body.jobId)).state).toBe('done')
    const live = await editor.get(`/pages/${id}`)
    expect(live.body.page.workflowState).toBe('published')
    expect(live.body.page.publishedVersionId).toBe(sub.body.versionId)
    expect((await approver.get('/releases')).body.items[0].manifest.pages[id].path).toBe('/winter-appeal')

    expect((await editor.post(`/pages/${id}/unpublish`, {})).status).toBe(403)
    const off = await approver.post(`/pages/${id}/unpublish`, { redirectTo: '/' })
    await approver.job(off.body.jobId)
    expect((await editor.get(`/pages/${id}`)).body.page.workflowState).toBe('unpublished')
    expect((await approver.get('/redirects')).body.items).toEqual([expect.objectContaining({ fromPath: '/winter-appeal', toPath: '/', source: 'unpublish' })])

    expect((await approver.del(`/pages/${id}`)).status).toBe(200)
    expect((await editor.get(`/pages/${id}`)).status).toBe(404)
    expect((await approver.get('/pages/bin')).body.items.map((p: { id: string }) => p.id)).toContain(id)
    const back = await approver.post(`/pages/${id}/restore`)
    expect(back.status).toBe(200)
    expect(back.body.page.path).toBe('/winter-appeal')
  })

  it('undo and history', async () => {
    const { body } = await editor.post('/pages', { title: 'Our team', template: 'standard' })
    const id = body.page.id
    const e = await editor.post(`/pages/${id}/ops`, { baseRevision: 0, ops: [{ op: 'set_meta', title: 'The team' }] })
    const undo = await editor.post(`/pages/${id}/undo`, { opId: e.body.opIds[0] })
    expect(undo.body.doc.title).toBe('Our team')
    expect((await editor.post(`/pages/${id}/checkpoint`, { summary: 'Before the big rewrite' })).status).toBe(200)
    const versions = await editor.get(`/pages/${id}/versions`)
    expect(versions.body.items.some((v: { summary: string }) => v.summary === 'Before the big rewrite')).toBe(true)
  })
})

describe('site parts over HTTP', () => {
  it('admin edits the main menu, another approver approves it', async () => {
    const parts = (await editor.get('/site-parts')).body.items as { id: string; key: string }[]
    const menu = parts.find((p) => p.key === 'main')!
    const doc = { schemaVersion: 1, items: [{ id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' } }] }
    expect((await editor.post(`/site-parts/${menu.id}/ops`, { baseRevision: 0, ops: [{ op: 'replace', doc }] })).status).toBe(403)
    const current = (await admin.get(`/site-parts/${menu.id}`)).body
    const e = await admin.post(`/site-parts/${menu.id}/ops`, { baseRevision: current.revision, ops: [{ op: 'replace', doc }] })
    expect(e.status).toBe(200)
    const sub = await admin.post(`/site-parts/${menu.id}/submit`, {})
    expect(sub.status).toBe(200)
    expect((await admin.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })).status).toBe(403)
    const ok = await approver.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })
    await approver.job(ok.body.jobId)
    expect((await admin.get(`/site-parts/${menu.id}`)).body.part.workflowState).toBe('published')
  })
})
