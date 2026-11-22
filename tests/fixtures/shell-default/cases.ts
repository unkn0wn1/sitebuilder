// Stored main-shape shell documents (no utility, heart icon, footer layout, or accent tone).
// Golden HTML under this directory was rendered from these objects before the renderer changed.
// Do not add the new keys here. The byte-identity test renders these objects as they stand.
import { richTextFromParagraphs } from '../../../shared/richtext'
import { emptyPageDoc, type PageDoc } from '../../../shared/page'
import type { SiteRenderContext } from '../../../server/services/render'
import type { BannerDoc, FooterDoc, HeaderDoc, HeaderStyle, MenuDoc } from '../../../shared/site-parts'

const menu: MenuDoc = {
  schemaVersion: 1,
  items: [
    { id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] },
    {
      id: 'b_about001',
      label: 'About',
      target: { type: 'url', url: '/about' },
      children: [{ id: 'b_team0001', label: 'Our team', target: { type: 'url', url: '/about/team' } }],
    },
  ],
}

const legalMenu: MenuDoc = {
  schemaVersion: 1,
  items: [{ id: 'b_priv0001', label: 'Privacy', target: { type: 'url', url: '/privacy' }, children: [] }],
}

function header(style: HeaderStyle, appearance: 'light' | 'dark'): HeaderDoc {
  return {
    schemaVersion: 1,
    style,
    menuKey: 'main',
    cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } },
    appearance,
  } as HeaderDoc
}

function footer(appearance: 'light' | 'dark'): FooterDoc {
  return {
    schemaVersion: 1,
    text: richTextFromParagraphs(['We help street animals.']),
    contact: { email: 'hello@example.org', phone: '+44 20 7946 0000', address: '1 High Street' },
    social: [
      { network: 'facebook', url: 'https://facebook.com/example' },
      { network: 'instagram', url: 'https://instagram.com/example' },
    ],
    legalMenuKey: 'legal',
    charityNumber: '1234567',
    appearance,
  } as FooterDoc
}

function banner(tone: 'info' | 'urgent' | 'celebrate'): BannerDoc {
  return {
    schemaVersion: 1,
    enabled: true,
    message: 'Winter appeal is open',
    link: { label: 'Give', target: { type: 'url', url: 'https://example.org/give' } },
    tone,
  }
}

function site(overrides: Partial<SiteRenderContext>): SiteRenderContext {
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: null,
    footer: null,
    banner: null,
    menus: {},
    pagesById: {},
    media: {},
    embeds: {},
    ...overrides,
  }
}

export interface ShellCase {
  name: string
  doc: PageDoc
  site: SiteRenderContext
}

const doc = emptyPageDoc('Home')
const styles: HeaderStyle[] = ['simple', 'centred', 'mega', 'hamburger']
const looks = ['light', 'dark'] as const

const headerCases: ShellCase[] = styles.flatMap((style) =>
  looks.map((appearance) => ({
    name: `header-${style}-${appearance}`,
    doc,
    site: site({
      header: { id: 'sp_header', doc: header(style, appearance) },
      menus: { main: { id: 'sp_menu', doc: menu } },
    }),
  })),
)

const footerCases: ShellCase[] = looks.map((appearance) => ({
  name: `footer-simple-${appearance}`,
  doc,
  site: site({
    footer: { id: 'sp_footer', doc: footer(appearance) },
    menus: { legal: { id: 'sp_legal', doc: legalMenu } },
  }),
}))

const bannerCases: ShellCase[] = (['info', 'urgent', 'celebrate'] as const).map((tone) => ({
  name: `banner-${tone}`,
  doc,
  site: site({ banner: { id: 'sp_banner', doc: banner(tone) } }),
}))

const combined: ShellCase = {
  name: 'shell-simple-light-footer-light-banner-info',
  doc,
  site: site({
    header: { id: 'sp_header', doc: header('simple', 'light') },
    footer: { id: 'sp_footer', doc: footer('light') },
    banner: { id: 'sp_banner', doc: banner('info') },
    menus: { main: { id: 'sp_menu', doc: menu }, legal: { id: 'sp_legal', doc: legalMenu } },
  }),
}

export const SHELL_CASES: ShellCase[] = [...headerCases, ...footerCases, ...bannerCases, combined]
