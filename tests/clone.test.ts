import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { cloneDraft } from '../shared/clone'

describe('cloneDraft', () => {
  it('deep-clones nested Vue reactive state that structuredClone cannot copy', () => {
    const doc = reactive({
      menuStyle: 'mega',
      tokens: { accent: '#b5471d', paper: '#fff' },
      items: [{ label: 'Home', children: [{ label: 'About us' }] }],
    })

    expect(() => structuredClone(doc)).toThrow()

    const copy = cloneDraft(doc)
    expect(copy).toEqual({
      menuStyle: 'mega',
      tokens: { accent: '#b5471d', paper: '#fff' },
      items: [{ label: 'Home', children: [{ label: 'About us' }] }],
    })
    expect(copy).not.toBe(doc)
    expect(copy.tokens).not.toBe(doc.tokens)
    expect(copy.items[0]).not.toBe(doc.items[0])

    copy.menuStyle = 'simple'
    copy.tokens.accent = '#113399'
    copy.items[0]!.children[0]!.label = 'Changed'
    expect(doc.menuStyle).toBe('mega')
    expect(doc.tokens.accent).toBe('#b5471d')
    expect(doc.items[0]!.children[0]!.label).toBe('About us')
  })

  it('unwraps values held in a ref', () => {
    const held = ref({ fonts: { body: 'Source Sans 3' } })
    const copy = cloneDraft(held.value)
    copy.fonts.body = 'Georgia'
    expect(held.value.fonts.body).toBe('Source Sans 3')
  })
})
