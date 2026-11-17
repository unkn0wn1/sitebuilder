import { describe, expect, it } from 'vitest'
import {
  applyResolvedTheme,
  readThemePreference,
  resolvedTheme,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from '../app/utils/theme'
import { PREFERS_DARK_MEDIA, rewritePrefersColorSchemeDark } from '../build/flowbite-class-dark'

describe('admin colour theme', () => {
  it('defaults an unknown preference to the system setting', () => {
    expect(readThemePreference(null)).toBe('system')
    expect(readThemePreference('')).toBe('system')
    expect(readThemePreference('nope')).toBe('system')
    expect(readThemePreference('dark')).toBe('dark')
    expect(readThemePreference('light')).toBe('light')
    expect(readThemePreference('system')).toBe('system')
  })

  it('follows the OS when the preference is system, otherwise the chosen mode', () => {
    expect(resolvedTheme('system', true)).toBe('dark')
    expect(resolvedTheme('system', false)).toBe('light')
    expect(resolvedTheme('light', true)).toBe('light')
    expect(resolvedTheme('dark', false)).toBe('dark')
  })

  it('toggles the .dark class and colour-scheme on the root', () => {
    const classes = new Set<string>()
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name)
          else classes.delete(name)
        },
      },
      style: { colorScheme: '' },
    }
    applyResolvedTheme('dark', root)
    expect(classes.has('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    applyResolvedTheme('light', root)
    expect(classes.has('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })

  it('bootstraps from localStorage before paint', () => {
    expect(THEME_STORAGE_KEY).toBe('sb-theme')
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('localStorage.getItem("sb-theme")')
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("classList.toggle('dark'")
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('prefers-color-scheme: dark')
  })
})

describe('flowbite class-based dark rewrite', () => {
  it('rewrites prefers-color-scheme dark blocks to :where(.dark)', () => {
    const css = `${PREFERS_DARK_MEDIA}{.dark\\:bg-gray-800{background:#1f2937}@media (hover:hover){.dark\\:hover\\:bg-gray-700:hover{background:#374151}}} .plain{color:#111}`
    const out = rewritePrefersColorSchemeDark(css)
    expect(out).toContain(':where(.dark){.dark\\:bg-gray-800{background:#1f2937}@media (hover:hover){.dark\\:hover\\:bg-gray-700:hover{background:#374151}}}')
    expect(out).toContain('.plain{color:#111}')
    expect(out).not.toContain(PREFERS_DARK_MEDIA)
  })

  it('leaves nearby at-rules and unmatched text alone', () => {
    const css = '@media (min-width:640px){.a{color:red}} @media (prefers-color-scheme:dark'
    expect(rewritePrefersColorSchemeDark(css)).toBe(css)
  })

  it('rewrites nested and spaced media queries', () => {
    const css = '@media (hover:hover){@media (prefers-color-scheme: dark){.dark\\:bg-gray-800{background:#1f2937}}}'
    expect(rewritePrefersColorSchemeDark(css)).toBe('@media (hover:hover){:where(.dark){.dark\\:bg-gray-800{background:#1f2937}}}')
  })
})
