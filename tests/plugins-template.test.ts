import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { computeMatchFill, computeMoney, computePercent, computeSvgScale, evaluateComputed } from '../shared/plugins/compute'
import type { ComputedField } from '../shared/plugins/manifest'
import type { CompiledField } from '../shared/plugins/schema-subset'
import {
  compileTemplate,
  TemplateRejected,
  type CompiledTemplate,
  type TemplateData,
  type TemplateHooks,
  type TemplateSetting,
} from '../shared/plugins/template'

const heading: CompiledField = { name: 'heading', type: 'string' }
const note: CompiledField = { name: 'note', type: 'string' }
const amounts: CompiledField[] = [
  { name: 'raised', type: 'string' },
  { name: 'matched', type: 'string' },
  { name: 'goal', type: 'string' },
  { name: 'currency', type: 'string' },
  { name: 'code', type: 'string' },
]
const lists: CompiledField[] = [
  { name: 'a', type: 'list', children: [{ name: 'name', type: 'string' }] },
  { name: 'b', type: 'list', children: [{ name: 'name', type: 'string' }] },
  { name: 'items', type: 'list', children: [{ name: 'name', type: 'string' }] },
  { name: 'show', type: 'boolean' },
  { name: 'label', type: 'string' },
  { name: 'link', type: 'string' },
  { name: 'tone', type: 'string' },
]
const fill: ComputedField = { name: 'fill', op: 'match-fill', args: ['raised', 'matched', 'goal', 14, 304] }

const hooks: TemplateHooks = {
  richtext: () => h('strong', 'marked'),
  image: (_value, slot) => h('img', { alt: 'photo', src: '/media/sample.webp', width: slot.width, height: slot.height }),
  link: (value) => {
    if (!value || typeof value !== 'object') return null
    const label = (value as { label?: unknown }).label
    const href = (value as { href?: unknown }).href
    if (typeof label !== 'string' || typeof href !== 'string') return null
    return h('a', { class: 'btn', href }, label)
  },
}

function reject(source: string, fields: CompiledField[] = [heading], computed: ComputedField[] = []): TemplateRejected {
  try {
    compileTemplate(source, { fields, computed })
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateRejected)
    if (!(error instanceof TemplateRejected)) throw error
    return error
  }
  throw new Error('expected a template rejection')
}

function expectReject(source: string, message: string, fields?: CompiledField[], computed?: ComputedField[]) {
  const error = reject(source, fields, computed)
  expect(error.line).toBeGreaterThan(0)
  expect(error.column).toBeGreaterThan(0)
  expect(error.message).toBe(message)
  expect(error.message).not.toContain('MARKER')
  expect(error.message).not.toContain('<')
}

async function htmlOf(render: CompiledTemplate, data: Partial<TemplateData> = {}, used: TemplateHooks = hooks): Promise<string> {
  const vnode = render(
    {
      props: data.props ?? {},
      computed: data.computed ?? {},
      settings: data.settings ?? {},
      sectionId: data.sectionId ?? 'b_x',
      blockSlug: data.blockSlug ?? 'hello-note-note',
    },
    used,
  )
  const app = createSSRApp(defineComponent({ name: 'PluginTemplate', setup: () => () => vnode }))
  return renderToString(app)
}

async function draw(source: string, opts: { fields?: CompiledField[]; computed?: ComputedField[]; settings?: TemplateSetting[]; data?: Partial<TemplateData>; hooks?: TemplateHooks; imageSlots?: Record<string, { width: number; height: number }> } = {}) {
  const render = compileTemplate(source, { fields: opts.fields ?? [heading], computed: opts.computed ?? [], settings: opts.settings, imageSlots: opts.imageSlots })
  return htmlOf(render, opts.data, opts.hooks)
}

describe('plugin computed values', () => {
  it('clamps percent and svg-scale and formats money from the currency prop', () => {
    expect(computePercent(250, 100)).toBe(100)
    expect(computePercent('nope', 10)).toBe(0)
    expect(computePercent(1, 2)).toBe(50)
    expect(computeSvgScale(3, 2, 10)).toBe(10)
    expect(computeSvgScale(1, 4, 10)).toBe(3)
    expect(computeSvgScale(1, 0, 10)).toBe(0)
    expect(computeSvgScale('nope', 1, 10)).toBe(0)
    expect(computeMoney('12', '£')).toBe('£12')
    expect(computeMoney('12', '')).toBe('12')
    const money = evaluateComputed([{ name: 'label', op: 'money', args: ['amount'] }], { amount: '12', currency: '£' })
    expect(money.label).toBe('£12')
    const coded = evaluateComputed([{ name: 'label', op: 'money', args: ['amount', 'code'] }], { amount: '12', code: 'USD', currency: '£' })
    expect(coded.label).toBe('USD12')
    const blank = evaluateComputed([{ name: 'label', op: 'money', args: ['amount'] }], { amount: '12' })
    expect(blank.label).toBe('12')
  })

  it('matches the thermometer tube and stores 0 when a computed value cannot be parsed', () => {
    expect(computeMatchFill(5000, 2500, 10000, 14, 304)).toEqual({ hD: 145, hM: 73, yD: 159, yM: 86, percent: 75 })
    expect(computeMatchFill(100, 100, 100, 14, 304)).toEqual({ hD: 290, hM: 0, yD: 14, yM: 14, percent: 100 })
    expect(computeMatchFill(5, 5, 0, 14, 304)).toEqual({ hD: 0, hM: 0, yD: 304, yM: 304, percent: 0 })
    expect(computeMatchFill('nope', 'nope', 'nope', 14, 304)).toEqual({ hD: 0, hM: 0, yD: 304, yM: 304, percent: 0 })
    const values = evaluateComputed(
      [
        { name: 'sum', op: 'add', args: ['raised', 'matched'] },
        { name: 'left', op: 'subtract', args: ['goal', 'raised'] },
        { name: 'low', op: 'min', args: ['raised', 'matched'] },
        { name: 'pct', op: 'percent', args: ['sum', 'goal'] },
        { name: 'broken', op: 'percent', args: [] },
        fill,
      ],
      { raised: '5000', matched: '2500', goal: '10000' },
    )
    expect(values.sum).toBe(7500)
    expect(values.left).toBe(5000)
    expect(values.low).toBe(2500)
    expect(values.pct).toBe(75)
    expect(values.broken).toBe(0)
    expect(values.fill).toEqual({ hD: 145, hM: 73, yD: 159, yM: 86, percent: 75 })
    expect(evaluateComputed([{ name: 'down', op: 'subtract', args: ['raised', 'goal'] }], { raised: '5', goal: '8' }).down).toBe(0)
  })
})

describe('plugin templates', () => {
  it('escapes prop text and leaves helper output as elements', async () => {
    const html = await draw('<section><p>{{heading}}</p><p>{{note}}</p>{{richtext body}}</section>', {
      fields: [heading, note, { name: 'body', type: 'richtext' }],
      data: { props: { heading: '<script>', note: '</style>', body: { type: 'doc', content: [] } } },
    })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/style&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</style>')
    expect(html).toContain('<strong>marked</strong>')
    expect(html).not.toContain('&lt;strong&gt;')
  })

  it('rejects unsafe tags, attributes, raw HTML, nested lists and external urls', () => {
    const tags = ['script', 'iframe', 'foreignObject', 'use', 'image', 'a', 'style', 'object', 'embed', 'form', 'input', 'button', 'animate', 'set', 'filter', 'link', 'meta']
    for (const tag of tags) {
      expectReject(`<section><${tag}>MARKER</${tag}></section>`, 'This tag is not allowed.')
      expectReject(`<svg viewBox="0 0 10 10"><${tag}>MARKER</${tag}></svg>`, 'This tag is not allowed.', [])
    }
    for (const attr of ['onclick', 'onfocus', 'style', 'href', 'src', 'srcset', 'formaction']) {
      expectReject(`<section ${attr}="MARKER">Hi</section>`, 'This attribute is not allowed.')
    }
    expectReject('<svg viewBox="0 0 10 10"><rect clip-path="url(https://evil.example/MARKER)" width="10" height="10"></rect></svg>', 'Only a local reference is allowed here.', [])
    expectReject('<svg viewBox="0 0 10 10"><rect clip-path="url( https://evil.example/MARKER )" width="10" height="10"></rect></svg>', 'Only a local reference is allowed here.', [])
    expectReject('<svg viewBox="0 0 10 10"><rect clip-path="javascript:MARKER" width="10" height="10"></rect></svg>', 'Only a local reference is allowed here.', [])
    expectReject('<section>{{{heading}}}MARKER</section>', 'This template cannot include raw HTML.')
    expectReject('<section>One</section><p>MARKER</p>', 'Use one root element.')
    expectReject('<ul>{{#a}}<li>{{#b}}MARKER{{/b}}</li>{{/a}}</ul>', 'A list cannot contain another list.', lists)
    expectReject('<ul>{{#a}}<li>{{^name}}{{#b}}MARKER{{/b}}{{/name}}</li>{{/a}}</ul>', 'A list cannot contain another list.', lists)
    expectReject('<section class="one" class="MARKER">Hi</section>', 'This attribute is repeated.')
    expectReject('<section><p>MARKER', 'Close the open tag.')
    expectReject('<section><p>MARKER</div></section>', 'This closing tag does not match.')
    expectReject('<section>{{#items}}<span>MARKER</span>', 'Close the open tag.', lists)
    expectReject('<section>{{/items}}MARKER</section>', 'This closing tag does not match.', lists)
    expectReject('<section><div id="tube"></div><div id="tube">MARKER</div></section>', 'This id is already used.', [])
    expectReject('<section>{{#items}}<div id="tube">MARKER</div>{{/items}}</section>', 'An id cannot sit inside a list.', lists)
    expectReject('<section class="not valid">MARKER</section>', 'This class or id is not valid.')
    expectReject('<p>{{fill}}</p>', 'This value cannot be shown as text.', amounts, [fill])
    expectReject('<p>{{missing}}</p>', 'This field is not on the block.')
    expectReject('<p>{{svg-scale raised goal 0}}</p>', 'This helper is not valid.', amounts)
    expectReject('<p>{{svg-scale raised goal 2001}}</p>', 'This helper is not valid.', amounts)
  })

  it('renders a local clip path with a different id on each section', async () => {
    const source = '<svg viewBox="0 0 10 10"><rect clip-path="url(#tube)" width="10" height="10"></rect><defs><clipPath id="tube"><rect width="10" height="10"></rect></clipPath></defs></svg>'
    const render = compileTemplate(source, { fields: [], computed: [] })
    const first = await htmlOf(render, { sectionId: 'b_x', blockSlug: 'hello-note-note' })
    const second = await htmlOf(render, { sectionId: 'b_tube0002', blockSlug: 'hello-note-note' })
    expect(first).toContain('id="phello-note-note-b_x-tube"')
    expect(first).toContain('url(#phello-note-note-b_x-tube)')
    expect(second).toContain('url(#phello-note-note-b_tube0002-tube)')
    expect(first).not.toContain('b_tube0002')
    expect(second).not.toContain('phello-note-note-b_x-tube')
  })

  it('renders lists, inverses, money, clamps and match-fill numbers', async () => {
    const listed = await draw('<ul>{{#items}}<li>{{name}}</li>{{/items}}{{^items}}<li>None</li>{{/items}}</ul>', {
      fields: lists,
      data: { props: { name: 'Block', items: [{ name: 'Ada' }, {}, 'skip', null] } },
    })
    expect(listed).toContain('<li>Ada</li>')
    expect(listed).toContain('<li>Block</li>')
    expect(listed).not.toContain('skip')
    expect(listed).not.toContain('None')
    const empty = await draw('<ul>{{#items}}<li>{{name}}</li>{{/items}}{{^items}}<li>None</li>{{/items}}</ul>', {
      fields: lists,
      data: { props: { items: [] } },
    })
    expect(empty).toContain('None')
    const inverse = await draw('<section>{{^show}}<ul>{{#items}}<li>{{name}}</li>{{/items}}</ul>{{/show}}</section>', {
      fields: lists,
      data: { props: { show: false, items: [{ name: 'Ada' }] } },
    })
    expect(inverse).toContain('Ada')
    const hidden = await draw('<section>{{^show}}<p>Hidden</p>{{/show}}{{#label}}<em>Yes</em>{{/label}}</section>', {
      fields: lists,
      data: { props: { show: true, label: 'Hi' } },
    })
    expect(hidden).not.toContain('Hidden')
    expect(hidden).toContain('<em>Yes</em>')
    const comment = await draw('<p>{{! MARKER }}{{heading}}</p>', { data: { props: { heading: 'Hello' } } })
    expect(comment).toContain('Hello')
    expect(comment).not.toContain('MARKER')
    const linked = await draw('<p>{{link}}</p>', { fields: lists, data: { props: { link: 'Read' } } })
    expect(linked).toContain('Read')
    const money = await draw('<section><p>{{money raised}}</p><p>{{money raised code}}</p></section>', {
      fields: amounts,
      data: { props: { raised: '12', currency: '£', code: 'USD' } },
    })
    expect(money).toContain('£12')
    expect(money).toContain('USD12')
    const clamped = await draw('<section><p>{{percent raised goal}}</p><p>{{svg-scale raised goal 10}}</p></section>', {
      fields: amounts,
      data: { props: { raised: '250', goal: '100' } },
    })
    expect(clamped).toContain('>100<')
    expect(clamped).toContain('>10<')
    const tube = await draw('<svg viewBox="0 0 20 320"><rect x="0" y="{{fill.yD}}" width="10" height="{{fill.hD}}"></rect></svg>', {
      fields: amounts,
      computed: [fill],
      data: {
        props: { raised: '5000', matched: '2500', goal: '10000' },
        computed: evaluateComputed([fill], { raised: '5000', matched: '2500', goal: '10000' }),
      },
    })
    expect(tube).toContain('y="159"')
    expect(tube).toContain('height="145"')
    const tone = await draw('<p>{{tone}}</p>', {
      fields: [{ name: 'tone', type: 'string' }],
      data: { props: { tone: 'From the block' }, settings: { tone: 'From the setting' } },
    })
    expect(tone).toContain('From the block')
    expect(tone).not.toContain('From the setting')
    const setting = await draw('<p>{{tone}}</p>', {
      fields: [],
      settings: [{ name: 'tone', type: 'string' }],
      data: { settings: { tone: 'From the setting' } },
    })
    expect(setting).toContain('From the setting')
    compileTemplate('<p>{{svg-scale raised goal 1}}</p>', { fields: amounts, computed: [] })
    compileTemplate('<p>{{svg-scale raised goal 2000}}</p>', { fields: amounts, computed: [] })
    const slots = { seen: { width: 0, height: 0 } }
    await draw('<div>{{image photo}}</div>', {
      fields: [{ name: 'photo', type: 'image' }],
      imageSlots: { photo: { width: 640, height: 480 } },
      hooks: { ...hooks, image: (_value, slot) => { slots.seen = slot; return h('img', { alt: 'photo', src: '/media/sample.webp' }) } },
      data: { props: { photo: { media: 'med_00000000000000000000000001', alt: 'A dog' } } },
    })
    expect(slots.seen).toEqual({ width: 640, height: 480 })
  })
})
