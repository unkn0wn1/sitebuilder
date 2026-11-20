import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { agentChanges, auditEvents } from '../server/db/schema'
import { readDoc, requirePage } from '../server/services/pages'
import { requireSitePart, readSitePartDoc } from '../server/services/site-parts'
import * as G from '../server/services/agent/gateway'
import * as S from '../server/services/agent/schemas'
import { drain, SIGNUP, world, type World } from './agent-helpers'

const parse = <T extends { parse: (v: unknown) => unknown }>(schema: T, v: unknown) => schema.parse(v) as ReturnType<T['parse']>

describe('the 3am takedown', () => {
  let w: World
  beforeEach(async () => {
    w = await world()
  })

  it('finds the link everywhere it is used, in live and draft', () => {
    const r = G.findLinksFor(w.ctx, parse(S.findLinksInput, { url: SIGNUP }) as never) as any
    expect(r.total).toBe(3)
    expect(r.pages_affected).toBe(1)
    expect(r.site_parts_affected).toEqual(['Menu'])
    expect(r.results.every((x: any) => x.in_live)).toBe(true)
    expect(r.results.map((x: any) => x.link.kind).sort()).toEqual(['button', 'menu_target', 'text_link'])
  })

  it('removes the link as one draft, and a rule lets it go live', async () => {
    const r = G.removeLink(w.ctx, w.agent, parse(S.removeLinkInput, { url: SIGNUP, everywhere: true, expected_matches: 3, reason: 'Event cancelled, asked by Claire' }) as never) as any
    expect(r.change.status).toBe('open')
    expect(r.result.links_removed).toBe(3)
    expect(r.result.complete).toBe(true)
    expect(r.if_you_publish.outcome).toBe('goes_live')
    // Nothing is live yet.
    expect(JSON.stringify(readDoc(w.ctx, requirePage(w.ctx, w.pageId).publishedVersionId!))).toContain(SIGNUP)

    const p = G.publishChange(w.ctx, w.agent, { change_id: r.change.id }) as any
    expect(p.result.published).toBe(true)
    expect(p.change.status).toBe('publishing')
    await drain(w)

    const row = w.ctx.db.select().from(agentChanges).where(eq(agentChanges.id, r.change.id)).get()!
    expect(G.getChangeFor(w.ctx, w.agent, { change_id: r.change.id }).change.status).toBe('published')
    expect(row.id).toBe(r.change.id)
    const page = requirePage(w.ctx, w.pageId)
    const live = JSON.stringify(readDoc(w.ctx, page.publishedVersionId!))
    expect(live).not.toContain(SIGNUP)
    expect(live).toContain('Join us ')
    expect(live).toContain('tonight')
    const menu = readSitePartDoc(w.ctx, requireSitePart(w.ctx, w.menuId), requireSitePart(w.ctx, w.menuId).publishedVersionId)
    expect(JSON.stringify(menu)).not.toContain(SIGNUP)
    expect((menu as any).items.map((i: any) => i.label)).toEqual(['Home'])
    expect(G.findLinksFor(w.ctx, parse(S.findLinksInput, { url: SIGNUP }) as never).total).toBe(0)
    // Audit trail names the agent.
    const events = w.ctx.db.select().from(auditEvents).all().filter((e) => e.actorType === 'agent')
    expect(events.length).toBeGreaterThan(0)
  })

  it('refuses when the expected count is wrong, and changes nothing', () => {
    expect(() => G.removeLink(w.ctx, w.agent, parse(S.removeLinkInput, { url: SIGNUP, everywhere: true, expected_matches: 1, reason: 'Event cancelled' }) as never)).toThrowError(/expected 1 match/)
    expect(w.ctx.db.select().from(agentChanges).all()).toHaveLength(0)
  })

  it('undo restores the old links through the same rules', async () => {
    const r = G.removeLink(w.ctx, w.agent, parse(S.removeLinkInput, { url: SIGNUP, everywhere: true, reason: 'Event cancelled' }) as never) as any
    G.publishChange(w.ctx, w.agent, { change_id: r.change.id })
    await drain(w)
    const u = G.undoChangeFor(w.ctx, w.agent, parse(S.undoChangeInput, { change_id: r.change.id, reason: 'Claire said the event is back on' }) as never) as any
    expect(u.result.undo_goes_live || u.result.undo_sent_for_review).toBe(true)
  })
})
