// Public theme CSS. Used by the publish renderer and the editor canvas.

export const DEFAULT_THEME_TOKENS = {
  ink: '#1f1b16',
  paper: '#fffaf3',
  muted: '#5c564e',
  accent: '#b5471d',
  accentInk: '#fffaf3',
  line: '#e6dccf',
  band: '#f3ebe1',
  urgent: '#8b1e1e',
  celebrate: '#2e5a3c',
  // Footer gold only. Not written into :root, so the default theme CSS stays byte-identical.
  highlight: '#f3b53f',
} as const
export type ThemeTokens = { [K in keyof typeof DEFAULT_THEME_TOKENS]: string }

export const BUNDLE_ID = "theme-default-4"

export const THEME_CSS = `:root {
  --ink: #1f1b16;
  --paper: #fffaf3;
  --muted: #5c564e;
  --accent: #b5471d;
  --accent-ink: #fffaf3;
  --line: #e6dccf;
  --band: #f3ebe1;
  --urgent: #8b1e1e;
  --celebrate: #2e5a3c;
  --max: 70rem;
  --space: 1.25rem;
}
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light; }
body {
  margin: 0;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper);
}
img, video { max-width: 100%; height: auto; }
a { color: var(--accent); }
.skip { position: absolute; left: -999px; top: 0; }
.skip:focus {
  left: var(--space);
  top: var(--space);
  background: var(--paper);
  padding: 0.5rem 0.75rem;
  z-index: 10;
}
.wrap, .site-header-inner, .site-footer-inner {
  width: min(100% - 2 * var(--space), var(--max));
  margin-inline: auto;
}
.banner { padding: 0.6rem var(--space); text-align: center; font-size: 0.95rem; }
.banner-info { background: var(--band); }
.banner-urgent { background: var(--urgent); color: #fff; }
.banner-celebrate { background: var(--celebrate); color: #fff; }
.banner a { color: inherit; }
.site-header { border-bottom: 1px solid var(--line); }
.site-header-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  flex-wrap: wrap;
}
.site-header-centred .site-header-inner { flex-direction: column; }
.nav-mega details ul, .nav-mega-panel {
  min-width: 18rem;
  padding: 1rem 1.25rem;
  display: grid;
  gap: 0.35rem 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  box-shadow: 0 0.5rem 1.25rem color-mix(in srgb, var(--ink) 12%, transparent);
}
.nav-hamburger { position: relative; }
.nav-hamburger > summary {
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 0.3rem;
  padding: 0.4rem 0.8rem;
}
.nav-hamburger > summary::-webkit-details-marker { display: none; }
.nav-hamburger .nav-panel {
  position: absolute;
  right: 0;
  margin: 0.4rem 0 0;
  padding: 0.75rem 1rem;
  min-width: 14rem;
  background: var(--paper);
  border: 1px solid var(--line);
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.nav-hamburger .nav-panel details ul { position: static; border: 0; padding: 0.25rem 0 0.25rem 0.75rem; }
.site-title { color: inherit; text-decoration: none; font-weight: 700; font-size: 1.1rem; display: inline-flex; align-items: center; }
.site-logo { display: block; height: 2.75rem; width: auto; max-width: min(18rem, 100%); }
.site-header-centred .site-logo { height: 3.25rem; max-width: min(22rem, 100%); }
.site-header-dark {
  background: var(--ink);
  color: var(--paper);
  border-bottom-color: color-mix(in srgb, var(--paper) 20%, transparent);
}
.site-header-dark .nav a, .site-header-dark .nav summary, .site-header-dark .site-title { color: var(--paper); }
.site-header-dark .nav a { color: color-mix(in srgb, var(--paper) 82%, transparent); }
.site-header-dark .nav-hamburger > summary, .site-header-dark .nav details ul, .site-header-dark .nav-hamburger .nav-panel {
  background: var(--ink);
  color: var(--paper);
  border-color: color-mix(in srgb, var(--paper) 20%, transparent);
}
.site-footer-dark {
  background: var(--ink);
  color: color-mix(in srgb, var(--paper) 82%, transparent);
  border-top-color: color-mix(in srgb, var(--paper) 20%, transparent);
}
.site-footer-dark a { color: var(--paper); }
.site-header-dark .site-logo-fallback-light,
.site-footer-dark .site-logo-fallback-light { filter: brightness(0) invert(1); }
@media (max-width: 640px) {
  .site-logo, .site-header-centred .site-logo { height: 2.5rem; max-width: min(16rem, calc(100vw - 2 * var(--space))); }
}
.nav { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; }
.nav a, .nav summary { font-weight: 500; color: var(--muted); text-decoration: none; cursor: pointer; list-style: none; }
.nav details { position: relative; }
.nav details ul {
  position: absolute;
  margin: 0.25rem 0 0;
  padding: 0.5rem 0.75rem;
  list-style: none;
  background: var(--paper);
  border: 1px solid var(--line);
  min-width: 10rem;
  z-index: 5;
}
.cta-btn, .btn {
  display: inline-block;
  background: var(--accent);
  color: var(--accent-ink);
  text-decoration: none;
  padding: 0.7rem 1.1rem;
  border-radius: 0.3rem;
  font-weight: 600;
}
.hero {
  position: relative;
  min-height: min(70vh, 36rem);
  display: flex;
  align-items: flex-end;
  color: #fff;
  isolation: isolate;
}
.hero-media, .hero-video, .hero img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: -2;
}
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(to top, rgba(20, 12, 8, 0.72) 0%, rgba(20, 12, 8, 0.15) 55%, rgba(20, 12, 8, 0.2) 100%);
}
.hero-inner { width: min(100% - 2 * var(--space), var(--max)); margin: 0 auto 8vh; }
.hero h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 1.1; margin: 0 0 0.5rem; max-width: 16ch; }
.hero p { font-size: 1.15rem; max-width: 36ch; margin: 0 0 1.25rem; }
.section { padding: 3.5rem 0; }
.section h2 { font-size: clamp(1.5rem, 3vw, 2rem); margin: 0 0 1rem; }
.prose :where(p, ul, ol) { max-width: 40rem; margin: 0 0 1rem; }
.prose h2, .prose h3, .prose h4 { margin: 1.5rem 0 0.5rem; }
.split { display: grid; gap: 2rem; align-items: center; }
@media (min-width: 700px) {
  .split { grid-template-columns: 1fr 1fr; }
  .split-image-left .split-copy { order: 2; }
}
.figure { margin: 0; }
.figure figcaption { color: var(--muted); font-size: 0.9rem; margin-top: 0.5rem; }
.gallery { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); }
.quote { border-left: 4px solid var(--accent); margin: 0; padding: 0.25rem 0 0.25rem 1.25rem; font-size: 1.35rem; }
.quote footer { margin-top: 0.75rem; color: var(--muted); font-size: 1rem; }
.stats { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); }
.stat-value { font-size: 2rem; font-weight: 700; display: block; }
.stat-label { color: var(--muted); }
.cards { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.card { border: 1px solid var(--line); border-radius: 0.5rem; overflow: hidden; background: var(--paper); }
.card-body { padding: 1rem; }
.cta-band { background: var(--band); padding: 3.5rem 0; text-align: center; }
.cta-band.tone-accent { background: var(--accent); color: var(--accent-ink); }
.cta-band.tone-accent a.btn { background: var(--paper); color: var(--ink); }
.faq details { border-bottom: 1px solid var(--line); padding: 0.75rem 0; }
.faq summary { cursor: pointer; font-weight: 600; }
.donate, .embed { background: var(--band); padding: 3.5rem 0; }
.donate-box, .embed-box {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 1.5rem;
  min-height: 12rem;
}
.embed-frame { width: 100%; min-height: 20rem; border: 0; }
.embed-fallback { margin: 0; }
.site-footer { padding: 2rem 0 3rem; color: var(--muted); font-size: 0.9rem; border-top: 1px solid var(--line); margin-top: 2rem; }
.site-footer a { color: inherit; }
.footer-social { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 0.75rem 0; }
@media (max-width: 640px), (prefers-reduced-motion: reduce) {
  .hero-video { display: none; }
}

.lede { color: var(--muted); max-width: 40rem; margin: 0 0 1.25rem; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8rem; font-weight: 600; color: var(--muted); margin: 0 0 0.5rem; }
.tiers { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.tier { border: 1px solid var(--line); border-radius: 0.5rem; overflow: hidden; background: var(--paper); }
.tier-give { display: flex; flex-direction: column; height: 100%; color: inherit; text-decoration: none; }
.tier-give:hover, .tier-give:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.tier-body { padding: 1rem; }
.tier-amount { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
.tier-frequency { font-size: 0.85rem; font-weight: 600; color: var(--muted); margin: 0 0 0.5rem; text-transform: capitalize; }
.tier-other { color: var(--muted); margin: 1rem 0 0; }
.donate-prefill-hint { margin: 0 0 0.85rem; padding: 0.7rem 0.9rem; border-radius: 0.4rem; background: var(--band); border: 2px solid var(--accent); font-weight: 600; }
.donate-prefill-hint[hidden] { display: none; }
.goal-progress { width: 100%; height: 0.75rem; accent-color: var(--accent); }
.progress-meta { margin: 0.75rem 0 0; font-weight: 600; }
.progress-match, .progress-date { color: var(--muted); margin: 0.35rem 0 0; }
.match-banner { background: var(--band); padding: 1.25rem 0; }
.match-banner.tone-primary, .match-banner.tone-accent { background: var(--accent); color: var(--accent-ink); }
.match-banner.tone-primary a.btn, .match-banner.tone-accent a.btn { background: var(--paper); color: var(--ink); }
.match-message { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.35rem; }
.match-line, .match-countdown { margin: 0 0 0.35rem; }
.before-after { display: grid; gap: 1rem; margin: 1.5rem 0; }
@media (min-width: 700px) { .before-after { grid-template-columns: 1fr 1fr; } }
.before-after figure { margin: 0; }
.before-after figcaption { color: var(--muted); font-size: 0.9rem; margin-top: 0.5rem; }
.trust-groups { display: grid; gap: 2rem; }
@media (min-width: 700px) { .trust-groups { grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); align-items: start; } }
.trust-group-label { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 0.75rem; }
.trust-strip { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 1.25rem 1.75rem; align-items: flex-start; }
.trust-item, .trust-link { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; text-align: center; text-decoration: none; color: inherit; max-width: 10rem; }
.trust-logo, .trust-item picture, .trust-item img { max-height: 3.5rem; width: auto; }
.trust-name { font-size: 0.9rem; font-weight: 600; }
.trust-note { font-size: 0.8rem; color: var(--muted); }
.trust-badge { max-width: 8.5rem; }
.trust-badge img, .trust-badge iframe { max-width: 100%; height: auto; }
`

// Extra rules for optional shell parts. Appended to a page only when that option is used,
// so a page that leaves them at their defaults keeps the theme CSS byte-identical.
export const HEART_CSS = `
.cta-btn:has(.ico-heart) { display: inline-flex; align-items: center; white-space: nowrap; }
.ico-heart { margin-right: 0.45rem; vertical-align: -2px; flex: none; }
`

export const UTILITY_CSS = `
.util { font-size: 0.9rem; font-weight: 600; color: var(--muted); white-space: nowrap; text-decoration: none; }
.site-header-dark .util { color: var(--paper); }
@media (max-width: 640px) {
  .site-header-hamburger .util-bar { display: none; }
}
@media (min-width: 641px) {
  .site-header-hamburger .nav-panel .util-drawer { display: none; }
}
`

export const BANNER_ACCENT_CSS = `
.banner-accent { background: var(--accent); color: var(--accent-ink); font-size: 0.85rem; font-weight: 700; padding: 0.45rem var(--space); letter-spacing: 0.01em; }
.banner-accent a { text-decoration: underline; text-underline-offset: 2px; }
`

export const FOOTER_COLUMNS_CSS = `
.site-footer-cols { --f-bg: var(--paper); --f-fg: var(--ink); --f-mut: var(--muted); --f-line: var(--line); margin-top: 0; padding: 0; border-top: 0; background: var(--f-bg); color: var(--f-fg); font-size: 0.92rem; }
.site-footer-cols.site-footer-dark { --f-bg: linear-gradient(160deg, #261d17, #130f0b); --f-fg: #fff; --f-mut: rgba(255, 248, 238, 0.62); --f-line: rgba(255, 255, 255, 0.14); }
.site-footer-cols::before { content: ""; display: block; height: 3px; background: linear-gradient(90deg, var(--accent), #f3b53f, var(--accent)); }
.site-footer-cols a { color: inherit; }
.ft-wrap { width: min(100% - 2 * var(--space), var(--max)); margin: 0 auto; padding: 3rem 0 1.5rem; }
.ft-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 2.5rem; }
.ft-logo { display: inline-block; background: #fff; border-radius: 0.6rem; padding: 0.4rem 0.8rem; text-decoration: none; color: #1f1a17; }
.ft-logo img { display: block; height: 2.4rem; width: auto; }
.ft-tag { font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin: 1.1rem 0 0.6rem; }
.ft-tag em { display: block; font-style: normal; color: #f3b53f; }
.ft-about { max-width: 24rem; color: var(--f-mut); }
.ft-about p { margin: 0; }
.ft-col h3 { text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.7rem; color: var(--f-mut); margin: 0 0 1rem; }
.ft-col address { font-style: normal; display: grid; gap: 0.45rem; }
.ft-links { display: grid; gap: 0.65rem; }
.ft-links a { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; text-decoration: none; }
.ft-links a:hover, .ft-links a:focus-visible { text-decoration: underline; }
.ft-social { display: flex; gap: 0.6rem; margin: 1.25rem 0 0; }
.ft-social a { width: 2.4rem; height: 2.4rem; border-radius: 50%; border: 1px solid var(--f-line); display: grid; place-items: center; }
.ft-social a:hover { background: color-mix(in srgb, var(--f-fg) 14%, transparent); }
.ft-base { display: flex; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--f-line); font-size: 0.78rem; color: var(--f-mut); }
.ft-base p { margin: 0; }
@media (max-width: 800px) { .ft-grid { grid-template-columns: 1fr; gap: 2rem; } .ft-wrap { padding-top: 2.25rem; } }
`

/** Transparent over a top hero once /header.js adds .js-over. Without that class the header stays the normal solid bar.
 *  content-box keeps .hero's min-height as the photo area and adds the bar above it. .hero has no side padding,
 *  so a phone width stays full-bleed, and the absolute photo (inset 0) still paints through the padded area. */
export const OVER_HERO_CSS = `
.site-header-over.js-over { position: fixed; top: var(--strip, 0px); left: 0; right: 0; z-index: 50; background: linear-gradient(to bottom, rgba(20, 12, 8, 0.6), rgba(20, 12, 8, 0)); border-bottom: 0; transition: background-color 0.25s, box-shadow 0.25s; }
.site-header-over.js-over.is-solid { background: var(--paper); box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.18); }
.site-header-dark.site-header-over.js-over.is-solid { background: var(--ink); }
.site-header-over.js-over:not(.is-solid) .nav a,
.site-header-over.js-over:not(.is-solid) .nav summary,
.site-header-over.js-over:not(.is-solid) .util,
.site-header-over.js-over:not(.is-solid) .nav-hamburger > summary { color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.site-header-over.js-over:not(.is-solid) .nav-hamburger > summary { border-color: rgba(255, 255, 255, 0.7); }
.site-header-over.js-over:not(.is-solid) .site-title { background: #fff; padding: 0.3rem 0.9rem; border-radius: 999px; box-shadow: 0 0.15rem 0.6rem rgba(0, 0, 0, 0.25); }
.site-header-dark.site-header-over.js-over:not(.is-solid) .site-title { background: transparent; padding: 0; border-radius: 0; box-shadow: none; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.site-header-over.js-over:not(.is-solid) .cta-btn { border: 2px solid rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--accent) 40%, transparent); }
@media (prefers-reduced-motion: reduce) { .site-header-over.js-over { transition: none; } }
.site-header-over.js-over ~ main > .hero:first-child { box-sizing: content-box; padding-top: var(--sb-header-h, 0px); }
`

/** Photo tiles beside the links in a mega panel. Appended only when a mega menu actually has tiles. */
export const TILE_CSS = `
.nav-mega details .nav-mega-panel-tiles { position: absolute; z-index: 5; margin: 0.25rem 0 0; padding: 1rem 1.25rem; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 0.5rem 1.25rem color-mix(in srgb, var(--ink) 12%, transparent); display: grid; grid-template-columns: minmax(10rem, 16rem) minmax(0, 1fr); gap: 1.25rem 2rem; min-width: min(36rem, calc(100vw - 2 * var(--space))); }
.nav-mega details .nav-mega-panel-tiles ul { position: static; margin: 0; padding: 0; border: 0; box-shadow: none; background: transparent; min-width: 0; display: grid; gap: 0.35rem; list-style: none; }
.nav-mega-links { grid-template-columns: 1fr; }
.nav-mega-tiles { grid-template-columns: repeat(auto-fit, minmax(9rem, 13rem)); gap: 1rem; }
.nav-mega-tiles .tile { display: block; color: var(--ink); text-decoration: none; font-weight: 600; }
.nav-mega-tiles .tile img { display: block; width: 100%; height: auto; aspect-ratio: 640 / 420; object-fit: cover; border-radius: 0.5rem; margin-bottom: 0.4rem; }
.nav-mega-tiles .tile-text { padding: 1rem; background: var(--band); border-radius: 0.5rem; }
.nav-mega-tiles .tile:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.site-header-dark .nav-mega-panel-tiles { background: var(--ink); color: var(--paper); border-color: color-mix(in srgb, var(--paper) 20%, transparent); }
.site-header-dark .nav-mega-tiles .tile { color: var(--paper); }
.site-header-dark .nav-mega-tiles .tile-text { background: color-mix(in srgb, var(--paper) 12%, transparent); }
@media (max-width: 640px) { .nav-mega details .nav-mega-panel-tiles { grid-template-columns: 1fr; position: static; } }
`


/** Build public CSS from a brand pack, keeping the default rules and swapping tokens and fonts.
 *  The :root list is written out by hand. `highlight` is omitted on purpose: it is not a theme variable. */
export function themeCssFromTokens(tokens: ThemeTokens, fonts?: { body: string; heading: string | null }): string {
  const root = `:root {
  --ink: ${tokens.ink};
  --paper: ${tokens.paper};
  --muted: ${tokens.muted};
  --accent: ${tokens.accent};
  --accent-ink: ${tokens.accentInk};
  --line: ${tokens.line};
  --band: ${tokens.band};
  --urgent: ${tokens.urgent};
  --celebrate: ${tokens.celebrate};
  --max: 70rem;
  --space: 1.25rem;
}`
  let css = THEME_CSS.replace(/:root \{[^}]+\}/, root)
  if (fonts?.body) css = css.replace(/font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;/, `font-family: ${fonts.body};`)
  if (fonts?.heading) css += `\nh1, h2, h3, h4, .site-title, .hero h1 { font-family: ${fonts.heading}; }\n`
  return css
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function tokenDiffers(value: string | undefined, fallback: string): boolean {
  if (!value || !HEX.test(value)) return false
  return value.toLowerCase() !== fallback.toLowerCase()
}

/** Rules appended after option CSS so a changed brand colour wins. Empty when the token matches the default, or that option is off. */
export function brandChromeCss(tokens: Pick<ThemeTokens, 'ink' | 'paper' | 'highlight'> | null | undefined, opts: { columns: boolean; overHero: boolean }): string {
  if (!tokens) return ''
  const parts: string[] = []
  if (opts.columns && tokenDiffers(tokens.paper, DEFAULT_THEME_TOKENS.paper)) parts.push('.ft-logo { background: var(--paper); }')
  if (opts.columns && tokenDiffers(tokens.highlight, DEFAULT_THEME_TOKENS.highlight)) {
    parts.push(`.site-footer-cols::before { background: linear-gradient(90deg, var(--accent), ${tokens.highlight}, var(--accent)); }`)
    parts.push(`.ft-tag em { color: ${tokens.highlight}; }`)
  }
  if (opts.overHero && tokenDiffers(tokens.paper, DEFAULT_THEME_TOKENS.paper)) parts.push('.site-header-over.js-over:not(.is-solid) .site-title { background: var(--paper); }')
  if (opts.overHero && tokenDiffers(tokens.ink, DEFAULT_THEME_TOKENS.ink)) {
    parts.push('.site-header-over.js-over { background: linear-gradient(to bottom, color-mix(in srgb, var(--ink) 60%, transparent), color-mix(in srgb, var(--ink) 0%, transparent)); }')
  }
  return parts.length ? `\n${parts.join('\n')}\n` : ''
}
