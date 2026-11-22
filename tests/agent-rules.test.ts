import { describe, expect, it } from 'vitest'
import { RULE_PRESETS } from '../shared/agent/presets'
import {
  decideChange,
  globMatches,
  isMoneyBlockType,
  isNeverBlockType,
  MONEY_BLOCK_TYPES,
  normaliseRules,
  stagingDenial,
  type AgentRule,
  type PartFacts,
  type PartTarget,
} from '../shared/agent/rules'

const page: PartTarget = { type: 'page', id: 'pg_1', path: '/privacy', template: 'legal', label: 'Privacy', holdsMoney: false }
const menu: PartTarget = { type: 'site_part', id: 'sp_1', partKind: 'menu', label: 'Menu' }
const stats = { sectionsTouched: 1, wordsChanged: 5, linksAdded: 0, linksRemoved: 0, newLinkDomains: [] as string[] }
const facts = (over: Partial<PartFacts> = {}): PartFacts => ({ target: page, actions: ['edit_text'], stats, floor: [], ...over })
const rules = (...r: unknown[]): AgentRule[] => {
  const n = normaliseRules(r)
  if (!n.ok) throw new Error(n.message)
  return n.rules
}
const input = (r: AgentRule[], extra: Partial<{ alwaysAllow: boolean; publishesLastHourByRule: Record<string, number> }> = {}) => ({ rules: r, alwaysAllow: false, publishesLastHourByRule: {}, ...extra })

describe('rule decisions', () => {
  it('sends everything to review when there are no rules', () => {
    const d = decideChange([facts()], input([]))
    expect(d.outcome).toBe('review')
    expect(d.reasons[0]).toMatch(/No rule lets this token publish "edit_text"/)
  })

  it('publishes when a rule covers the action and target and the limits hold', () => {
    const r = rules({ label: 'Legal wording', actions: ['edit_text'], targets: { pageTemplates: ['legal'] }, result: 'publish', limits: { maxWords: 50 } })
    const d = decideChange([facts()], input(r))
    expect(d.outcome).toBe('publish')
    expect(d.ruleIds).toEqual(['r1'])
    expect(d.viaAlwaysAllow).toBe(false)
  })

  it('goes to review when a limit is exceeded, and says which', () => {
    const r = rules({ label: 'Small edits', actions: '*', result: 'publish', limits: { maxWords: 3 } })
    const d = decideChange([facts()], input(r))
    expect(d.outcome).toBe('review')
    expect(d.reasons[0]).toMatch(/changes 5 words, over the limit of 3/)
  })

  it('treats new links as review unless the rule allows them, and checks the domain', () => {
    const withLink = facts({ actions: ['add_link'], stats: { ...stats, linksAdded: 1, newLinkDomains: ['evil.example'] } })
    expect(decideChange([withLink], input(rules({ label: 'a', actions: ['add_link'], result: 'publish' }))).outcome).toBe('review')
    expect(decideChange([withLink], input(rules({ label: 'a', actions: ['add_link'], result: 'publish', limits: { allowNewLinks: true } }))).outcome).toBe('publish')
    const picky = rules({ label: 'a', actions: ['add_link'], result: 'publish', limits: { allowNewLinks: true, allowedLinkDomains: ['good.example'] } })
    expect(decideChange([withLink], input(picky)).outcome).toBe('review')
    const fine = facts({ actions: ['add_link'], stats: { ...stats, linksAdded: 1, newLinkDomains: ['www.good.example', '(this site)'].map((d) => d.replace('www.', 'shop.')) } })
    expect(decideChange([fine], input(picky)).outcome).toBe('publish')
  })

  it('lets a deny rule beat a publish rule and always-allow', () => {
    const r = rules({ label: 'Allow all', actions: '*', result: 'publish' }, { label: 'Never the menu', actions: '*', targets: { siteParts: ['menu'] }, result: 'deny' })
    expect(decideChange([facts({ target: menu, actions: ['edit_menu'] })], input(r, { alwaysAllow: true })).outcome).toBe('deny')
    expect(stagingDenial(r, 'edit_menu', menu)?.label).toBe('Never the menu')
    expect(stagingDenial(r, 'edit_text', page)).toBeNull()
  })

  it('never publishes past the floor, even with always-allow', () => {
    for (const flag of ['money_section_touched', 'foreign_draft', 'checks_failing'] as const) {
      const d = decideChange([facts({ floor: [flag] })], input(rules({ label: 'All', actions: '*', result: 'publish' }), { alwaysAllow: true }))
      expect(d.outcome, flag).toBe('review')
    }
  })

  it('always sends custom CSS to a person, before always-allow and before a publish rule', () => {
    const css = facts({ actions: ['edit_css'] })
    const reason = 'Custom CSS always needs a person to review it.'
    const always = decideChange([css], input([], { alwaysAllow: true }))
    expect(always.outcome).toBe('review')
    expect(always.reasons).toEqual([reason])
    expect(always.viaAlwaysAllow).toBe(false)

    const named = decideChange([css], input(rules({ label: 'CSS', actions: ['edit_css'], result: 'publish' })))
    expect(named.outcome).toBe('review')
    expect(named.reasons).toEqual([reason])

    const star = decideChange([css], input(rules({ label: 'All', actions: '*', result: 'publish' }), { alwaysAllow: true }))
    expect(star.outcome).toBe('review')
    expect(star.reasons).toEqual([reason])
    expect(star.viaAlwaysAllow).toBe(false)

    const floored = decideChange([facts({ actions: ['edit_css'], floor: ['custom_css'] })], input(rules({ label: 'All', actions: '*', result: 'publish' }), { alwaysAllow: true }))
    expect(floored.outcome).toBe('review')
    expect(floored.reasons[0]).toBe(`${reason} (the page "Privacy" (/privacy))`)
  })

  it('lets a deny rule refuse custom CSS before a draft is written', () => {
    const r = rules({ label: 'No CSS', actions: ['edit_css'], result: 'deny' }, { label: 'Allow all', actions: '*', result: 'publish' })
    expect(decideChange([facts({ actions: ['edit_css'] })], input(r, { alwaysAllow: true })).outcome).toBe('deny')
    expect(stagingDenial(r, 'edit_css', page)?.label).toBe('No CSS')
    const star = rules({ label: 'Nothing', actions: '*', result: 'deny' })
    expect(stagingDenial(star, 'edit_css', page)?.label).toBe('Nothing')
    expect(decideChange([facts({ actions: ['edit_css'] })], input(star)).outcome).toBe('deny')
  })

  it('gives no preset a publish rule for custom CSS', () => {
    for (const preset of RULE_PRESETS) {
      for (const rule of preset.rules) {
        if (rule.result !== 'publish' || rule.actions === '*') continue
        expect(rule.actions, preset.key).not.toContain('edit_css')
      }
    }
  })

  it('publishes with always-allow when no rule matches, and records that', () => {
    const d = decideChange([facts()], input([], { alwaysAllow: true }))
    expect(d.outcome).toBe('publish')
    expect(d.viaAlwaysAllow).toBe(true)
  })

  it('does not partially publish: one part needing review sends the whole change', () => {
    const r = rules({ label: 'Pages only', actions: '*', targets: { pagePaths: ['/privacy'] }, result: 'publish' })
    const d = decideChange([facts(), facts({ target: menu, actions: ['edit_menu'] })], input(r))
    expect(d.outcome).toBe('review')
    expect(d.parts.map((p) => p.outcome)).toEqual(['publish', 'review'])
  })

  it('needs a rule for each action in a part', () => {
    const r = rules({ label: 'Text only', actions: ['edit_text'], result: 'publish' })
    expect(decideChange([facts({ actions: ['edit_text', 'remove_link'] })], input(r)).outcome).toBe('review')
    const both = rules({ label: 'Text', actions: ['edit_text'], result: 'publish' }, { label: 'Links', actions: ['remove_link'], result: 'publish' })
    expect(decideChange([facts({ actions: ['edit_text', 'remove_link'] })], input(both)).outcome).toBe('publish')
  })

  it('limits auto-publishes per hour and the age of an undo', () => {
    const r = rules({ label: 'a', actions: ['undo_change'], result: 'publish', limits: { maxPerHour: 2, withinHours: 24 } })
    expect(decideChange([facts({ actions: ['undo_change'], changeAgeHours: 3 })], input(r)).outcome).toBe('publish')
    expect(decideChange([facts({ actions: ['undo_change'], changeAgeHours: 30 })], input(r)).outcome).toBe('review')
    expect(decideChange([facts({ actions: ['undo_change'], changeAgeHours: 1 })], input(r, { publishesLastHourByRule: { r1: 2 } })).outcome).toBe('review')
  })

  it('sends an empty change to review', () => {
    expect(decideChange([], input([])).outcome).toBe('review')
  })
})

describe('rule shapes', () => {
  it('matches globs', () => {
    expect(globMatches('/legal/*', '/legal/privacy')).toBe(true)
    expect(globMatches('/legal/*', '/legal')).toBe(false)
    expect(globMatches('/privacy', '/privacy')).toBe(true)
    expect(globMatches('/privacy', '/privacy/x')).toBe(false)
  })

  it('numbers rules, keeps given ids, and rejects nonsense', () => {
    expect(rules({ label: 'a', actions: '*', result: 'publish' }, { label: 'b', id: 'mine', actions: ['edit_text'], result: 'review' }).map((r) => r.id)).toEqual(['r1', 'mine'])
    expect(normaliseRules([{ label: 'a', actions: ['delete_everything'], result: 'publish' }]).ok).toBe(false)
    expect(normaliseRules([{ label: 'a', actions: '*', result: 'publish', extra: 1 }]).ok).toBe(false)
    expect(normaliseRules([{ label: 'a', id: 'x', actions: '*', result: 'publish' }, { label: 'b', id: 'x', actions: '*', result: 'deny' }]).ok).toBe(false)
    expect(normaliseRules([{ label: 'a', actions: '*', targets: { pagePaths: ['privacy'] }, result: 'publish' }]).ok).toBe(false)
  })

  it('knows the never-list and the money sections', () => {
    expect(isNeverBlockType('DonationEmbed')).toBe(true)
    expect(isNeverBlockType('Embed')).toBe(true)
    expect(isNeverBlockType('RichText')).toBe(false)
    expect(isMoneyBlockType('ImpactTiers')).toBe(true)
    expect(isMoneyBlockType('MatchBanner')).toBe(true)
    expect(isMoneyBlockType('MatchThermometer')).toBe(false)
    expect(isMoneyBlockType('Hero')).toBe(false)
    expect([...MONEY_BLOCK_TYPES]).toEqual(['ImpactTiers', 'DonationProgress', 'MatchBanner'])
  })
})
