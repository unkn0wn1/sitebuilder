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
  // Footer gold, written into :root as --highlight. Footer rules read var(--highlight).
  highlight: '#f3b53f',
} as const
export type ThemeTokens = { [K in keyof typeof DEFAULT_THEME_TOKENS]: string }

export const BUNDLE_ID = "theme-default-5"

/** The single :root block. themeCssFromTokens replaces this whole block, so derived values stay with the brand tokens.
 *  --fs-h3 is clamp(20px, 4.5vw, 28px): a step between the 17px body and the section h2 scale. */
function rootBlock(tokens: ThemeTokens): string {
  return `:root {
  --ink: ${tokens.ink};
  --paper: ${tokens.paper};
  --muted: ${tokens.muted};
  --accent: ${tokens.accent};
  --accent-ink: ${tokens.accentInk};
  --line: ${tokens.line};
  --band: ${tokens.band};
  --urgent: ${tokens.urgent};
  --celebrate: ${tokens.celebrate};
  --highlight: ${tokens.highlight};
  --surface: color-mix(in srgb, var(--paper) 25%, white);
  --accent-strong: color-mix(in srgb, var(--accent) 82%, black);
  --decor: color-mix(in srgb, var(--accent) 45%, var(--highlight));
  --radius-pill: 999px;
  --radius-card: 20px;
  --radius-tile: 14px;
  --radius-media: 12px;
  --shadow-card: 0 8px 28px color-mix(in srgb, var(--ink) 10%, transparent);
  --shadow-raised: 0 12px 36px color-mix(in srgb, var(--ink) 12%, transparent);
  --shadow-selected: 0 4px 14px color-mix(in srgb, var(--decor) 18%, transparent);
  --fs-body: 17px;
  --lh-body: 1.6;
  --fs-display: clamp(28px, 6.2vw, 52px);
  --fs-h2: clamp(26px, 7vw, 42px);
  --fs-h3: clamp(20px, 4.5vw, 28px);
  --fs-big: clamp(44px, 13vw, 72px);
  --fs-stat: clamp(19px, 5.6vw, 26px);
  --fs-eyebrow: 13px;
  --section-y: clamp(48px, 6vw, 72px);
  --max: 70rem;
  --space: 1.25rem;
}`
}

export const THEME_CSS = `${rootBlock(DEFAULT_THEME_TOKENS)}
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light; }
body {
  margin: 0;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  background: var(--paper);
}
h1, h2, h3, h4 { font-weight: 800; letter-spacing: -0.02em; }
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
.banner-urgent { background: var(--urgent); color: var(--accent-ink); }
.banner-celebrate { background: var(--celebrate); color: var(--accent-ink); }
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
.site-title { color: inherit; text-decoration: none; font-weight: 700; font-size: 1.1rem; display: inline-flex; align-items: center; background: var(--surface); padding: 0.3rem 0.9rem; border-radius: var(--radius-pill); box-shadow: var(--shadow-card); }
.site-logo { display: block; height: 2.75rem; width: auto; max-width: min(18rem, 100%); }
.site-header-centred .site-logo { height: 3.25rem; max-width: min(22rem, 100%); }
.site-header-dark {
  background: var(--ink);
  color: var(--paper);
  border-bottom-color: color-mix(in srgb, var(--paper) 20%, transparent);
}
.site-header-dark .nav a, .site-header-dark .nav summary, .site-header-dark .site-title { color: var(--paper); }
.site-header-dark .site-title { background: transparent; padding: 0; border-radius: 0; box-shadow: none; }
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--accent-ink);
  text-decoration: none;
  padding: 0.75rem 1.65rem;
  border: 0;
  border-radius: var(--radius-pill);
  min-height: 48px;
  font-weight: 800;
  line-height: 1.2;
  transition: background-color 0.15s, transform 0.15s;
}
.btn:hover, .cta-btn:hover { background: var(--accent-strong); transform: translateY(-1px); }
.btn:focus-visible, .cta-btn:focus-visible, .btn-secondary:focus-visible { outline: 3px solid var(--highlight); outline-offset: 3px; }
.btn:active, .cta-btn:active, .btn-secondary:active { transform: none; }
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
  padding: 0.75rem 1.65rem;
  border: 2px solid var(--line);
  border-radius: var(--radius-pill);
  min-height: 48px;
  font-weight: 800;
  line-height: 1.2;
  transition: background-color 0.15s, transform 0.15s;
}
.btn-secondary:hover { background: var(--surface); color: var(--ink); transform: translateY(-1px); }
.cta-band .btn { min-height: 60px; }
@media (prefers-reduced-motion: reduce) {
  .btn, .cta-btn, .btn-secondary { transition: none; }
  .btn:hover, .cta-btn:hover, .btn-secondary:hover { transform: none; }
}
.hero {
  position: relative;
  min-height: min(70vh, 36rem);
  display: flex;
  align-items: flex-end;
  color: #fff;
  isolation: isolate;
}
.hero-carousel { min-height: clamp(22rem, 100vh, 52rem); overflow: hidden; }
.hero-carousel { min-height: clamp(22rem, 100svh, 52rem); overflow: hidden; }
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
  background:
    linear-gradient(to top, color-mix(in srgb, var(--ink) 62%, transparent) 0%, color-mix(in srgb, var(--ink) 28%, transparent) 26%, color-mix(in srgb, var(--ink) 0%, transparent) 48%),
    linear-gradient(to bottom, color-mix(in srgb, var(--ink) 34%, transparent) 0%, color-mix(in srgb, var(--ink) 0%, transparent) 18%);
}
.hero-inner { width: min(100% - 2 * var(--space), var(--max)); margin: 0 auto 8vh; }
.hero h1 { font-size: var(--fs-display); line-height: 1.05; letter-spacing: -0.01em; margin: 0 0 0.5rem; max-width: 16ch; }
.hero p { font-size: var(--fs-body); max-width: 36ch; margin: 0 0 1.25rem; color: color-mix(in srgb, white 80%, var(--highlight)); }
.section { padding: var(--section-y) 0; }
.section h2 { font-size: var(--fs-h2); line-height: 1.1; margin: 0 0 1rem; }
.prose { max-width: 65ch; font-size: var(--fs-body); line-height: var(--lh-body); }
.prose :where(p, ul, ol) { margin: 0 0 1rem; }
.prose h2 { font-size: var(--fs-h2); line-height: 1.1; }
.prose h3, .prose h4 { font-size: var(--fs-h3); }
.prose h2, .prose h3, .prose h4 { margin: 1.5rem 0 0.5rem; }
.split { display: grid; gap: 2rem; align-items: center; }
.figure { margin: 0; }
.figure figcaption { color: var(--muted); font-size: 0.9rem; margin-top: 0.5rem; }
.gallery { display: grid; gap: clamp(10px, 1.5vw, 16px); grid-template-columns: 1fr; }
.gallery > * { min-width: 0; }
.cards, .tiers { display: grid; gap: clamp(16px, 2vw, 24px); grid-template-columns: 1fr; }
.cards > *, .tiers > * { min-width: 0; }
.split img, .figure img, .gallery img, .before-after figure img { border-radius: var(--radius-media); }
.quote { border-left: 4px solid var(--decor); margin: 0; padding: 0.25rem 0 0.25rem 1.25rem; font-size: var(--fs-h2); font-weight: 800; line-height: 1.15; }
.quote footer { margin-top: 0.75rem; color: var(--muted); font-size: var(--fs-body); font-weight: 600; }
@media (min-width: 700px) {
  .split { grid-template-columns: 1fr 1fr; }
  .split-image-left .split-copy { order: 2; }
  .gallery { grid-template-columns: 1fr 1fr; }
  .cards, .tiers { grid-template-columns: 1fr 1fr; }
}
@media (min-width: 1024px) {
  .gallery { grid-template-columns: 1fr 1fr 1fr; }
  .cards, .tiers { grid-template-columns: 1fr 1fr 1fr; }
}
.stats { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); }
.stat-value { display: block; font-size: var(--fs-stat); font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { color: var(--muted); }
.card, .tier, .donate-box, .stats > div {
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-card);
}
.card, .donate-box { border-radius: var(--radius-card); }
.tier, .stats > div { border-radius: var(--radius-tile); }
.card, .tier { overflow: hidden; }
.stats > div { background: var(--paper); padding: 1rem; }
.card-body { padding: 16px; }
@media (min-width: 760px) {
  .card-body { padding: 22px; }
}
.cta-band { background: linear-gradient(180deg, var(--paper), var(--band) 46%, color-mix(in srgb, var(--highlight) 32%, var(--band))); padding: var(--section-y) 0; text-align: center; }
.cta-band.tone-accent, .match-banner.tone-primary, .match-banner.tone-accent { background: linear-gradient(165deg, var(--accent), var(--accent-strong)); color: var(--accent-ink); }
.cta-band.tone-accent a.btn, .match-banner.tone-primary a.btn, .match-banner.tone-accent a.btn { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-raised); }
.faq { display: grid; gap: 0.75rem; }
.faq details { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-tile); padding: 0.85rem 1rem; }
.faq summary { cursor: pointer; font-weight: 600; }
.donate { background: linear-gradient(180deg, var(--paper), color-mix(in srgb, var(--highlight) 34%, var(--paper))); padding: var(--section-y) 0; }
.embed { background: var(--band); padding: 3.5rem 0; }
.donate-box { padding: 1.5rem; min-height: 12rem; border: 2px solid var(--highlight); }
.embed-box {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
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

.lede { color: var(--muted); max-width: 38em; margin: 0 0 1.25rem; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--fs-eyebrow); font-weight: 700; color: var(--accent-strong); margin: 0 0 0.5rem; }
.tier-give { display: flex; flex-direction: column; height: 100%; color: inherit; text-decoration: none; }
.tier-give:hover, .tier-give:focus-visible { box-shadow: inset 0 0 0 2px var(--accent), var(--shadow-selected); }
.tier-body { padding: 1rem; }
.tier-amount { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
.tier-frequency { font-size: 0.85rem; font-weight: 600; color: var(--muted); margin: 0 0 0.5rem; text-transform: capitalize; }
.tier-other { color: var(--muted); margin: 1rem 0 0; }
.donate-prefill-hint { margin: 0 0 0.85rem; padding: 0.7rem 0.9rem; border-radius: 0.4rem; background: var(--band); border: 2px solid var(--accent); font-weight: 600; }
.donate-prefill-hint[hidden] { display: none; }
.goal-progress { width: 100%; height: 12px; border: 0; border-radius: var(--radius-pill); accent-color: var(--accent); overflow: hidden; }
.progress-meta { margin: 0.75rem 0 0; font-weight: 800; }
.progress-match, .progress-date { color: var(--muted); margin: 0.35rem 0 0; }
.match-banner { background: var(--band); padding: 1.25rem 0; }
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
.trust-logo, .trust-item img { filter: grayscale(1); }
.trust-item:hover .trust-logo, .trust-item:hover img, .trust-item:focus-within .trust-logo, .trust-item:focus-within img { filter: none; }
.trust-name { font-size: 0.9rem; font-weight: 600; }
.trust-note { font-size: 0.8rem; color: var(--muted); }
.trust-badge { max-width: 8.5rem; }
.trust-badge img, .trust-badge iframe { max-width: 100%; height: auto; }
`

// Extra rules for optional shell parts. Appended to a page only when that option is used,
// so a page that leaves them at their defaults keeps the theme CSS byte-identical.
export const HEART_CSS = `
.cta-btn:has(.ico-heart) { display: inline-flex; align-items: center; white-space: nowrap; box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--highlight) 70%, transparent); }
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
.site-footer-cols.site-footer-dark { --f-bg: linear-gradient(160deg, var(--ink), color-mix(in srgb, var(--ink) 72%, black)); --f-fg: var(--paper); --f-mut: color-mix(in srgb, var(--paper) 62%, transparent); --f-line: color-mix(in srgb, var(--paper) 14%, transparent); }
.site-footer-cols::before { content: ""; display: block; height: 3px; background: linear-gradient(90deg, var(--accent), var(--highlight), var(--accent)); }
.site-footer-cols a { color: inherit; }
.ft-wrap { width: min(100% - 2 * var(--space), var(--max)); margin: 0 auto; padding: 3rem 0 1.5rem; }
.ft-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 2.5rem; }
.ft-logo { display: inline-block; background: var(--surface); border-radius: 0.6rem; padding: 0.4rem 0.8rem; text-decoration: none; color: var(--ink); }
.ft-logo img { display: block; height: 2.4rem; width: auto; }
.ft-tag { font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin: 1.1rem 0 0.6rem; }
.ft-tag em { display: block; font-style: normal; color: var(--highlight); }
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
.site-header-over.js-over { position: fixed; top: var(--strip, 0px); left: 0; right: 0; z-index: 50; background: linear-gradient(to bottom, color-mix(in srgb, var(--ink) 60%, transparent), color-mix(in srgb, var(--ink) 0%, transparent)); border-bottom: 0; transition: background-color 0.25s, box-shadow 0.25s; }
.site-header-over.js-over.is-solid { background: var(--paper); box-shadow: 0 0.25rem 1rem color-mix(in srgb, var(--ink) 18%, transparent); }
.site-header-dark.site-header-over.js-over.is-solid { background: var(--ink); }
.site-header-over.js-over:not(.is-solid) .nav a,
.site-header-over.js-over:not(.is-solid) .nav summary,
.site-header-over.js-over:not(.is-solid) .util,
.site-header-over.js-over:not(.is-solid) .nav-hamburger > summary { color: var(--paper); text-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 50%, transparent); }
.site-header-over.js-over:not(.is-solid) .nav-hamburger > summary { border-color: color-mix(in srgb, var(--paper) 70%, transparent); }
.site-header-over.js-over:not(.is-solid) .site-title { background: var(--surface); padding: 0.3rem 0.9rem; border-radius: var(--radius-pill); box-shadow: var(--shadow-card); }
.site-header-dark.site-header-over.js-over:not(.is-solid) .site-title { background: transparent; padding: 0; border-radius: 0; box-shadow: none; color: var(--paper); text-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 50%, transparent); }
.site-header-over.js-over:not(.is-solid) .cta-btn { border: 2px solid color-mix(in srgb, var(--paper) 90%, transparent); box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--accent) 40%, transparent); }
@media (prefers-reduced-motion: reduce) { .site-header-over.js-over { transition: none; } }
.site-header-over.js-over ~ main > .hero:first-child { box-sizing: content-box; padding-top: var(--sb-header-h, 0px); }
.site-header-over.js-over ~ main > .hero.hero-carousel:first-child { min-height: clamp(22rem, calc(100vh - var(--sb-header-h, 0px)), 52rem); }
.site-header-over.js-over ~ main > .hero.hero-carousel:first-child { min-height: clamp(22rem, calc(100svh - var(--sb-header-h, 0px)), 52rem); }
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

/** Carousel stage and controls. Appended only when a hero has two or more slides in a carousel mode. */
export const HERO_CAROUSEL_CSS = `
.hero-carousel .hero-stage { position: absolute; inset: 0; touch-action: pan-y; }
.hero-carousel .hero-slide { position: absolute; inset: 0; }
.hero-carousel .hero-controls { position: absolute; z-index: 2; left: 50%; bottom: max(1.1rem, calc(env(safe-area-inset-bottom) + 0.75rem)); transform: translateX(-50%); display: flex; align-items: center; gap: 0.15rem; padding: 0.25rem 0.35rem; max-width: calc(100% - 2 * var(--space)); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--ink) 38%, transparent); border: 1px solid color-mix(in srgb, var(--paper) 22%, transparent); backdrop-filter: blur(10px); }
.hero-carousel :is(.hero-prev, .hero-next, .hero-pause) { width: 48px; height: 48px; min-width: 44px; min-height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--paper); display: grid; place-items: center; cursor: pointer; transition: background-color 0.15s; }
.hero-carousel :is(.hero-prev, .hero-next, .hero-pause):is(:hover, :focus-visible) { background: color-mix(in srgb, var(--paper) 20%, transparent); }
.hero-carousel .hero-controls button:focus-visible { outline: 3px solid var(--highlight); outline-offset: 2px; }
.hero-carousel .hero-controls svg { width: 24px; height: 24px; display: block; }
.hero-carousel .hero-pause .ico-play { display: none; }
.hero-carousel .hero-pause[aria-pressed="true"] .ico-pause { display: none; }
.hero-carousel .hero-pause[aria-pressed="true"] .ico-play { display: block; }
.hero-carousel .hero-dot { position: relative; width: 44px; min-width: 44px; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--paper); cursor: pointer; }
.hero-carousel .hero-dot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: color-mix(in srgb, var(--paper) 55%, transparent); transition: transform 0.2s, background-color 0.2s; }
.hero-carousel .hero-dot[aria-current="true"]::after { background: var(--paper); transform: scale(1.45); }
.hero-carousel .hero-sr, .hero-carousel .hero-live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.hero-carousel [hidden] { display: none; }
@media (max-width: 640px) {
  .hero-carousel .hero-controls { gap: 0; padding: 0.15rem 0.2rem; }
  .hero-carousel :is(.hero-prev, .hero-next, .hero-pause) { width: 44px; height: 44px; }
  .hero-carousel .hero-dot { width: 24px; min-width: 24px; min-height: 24px; }
}
@media (prefers-reduced-motion: reduce) { .hero-carousel :is(.hero-prev, .hero-next, .hero-pause), .hero-carousel .hero-dot::after { transition: none; } }
`


/** Build public CSS from a brand pack, keeping the default rules and swapping tokens and fonts.
 *  Replaces the whole :root block, including --highlight and the derived variables. */
export function themeCssFromTokens(tokens: ThemeTokens, fonts?: { body: string; heading: string | null }): string {
  let css = THEME_CSS.replace(/:root \{[^}]+\}/, rootBlock(tokens))
  if (fonts?.body) css = css.replace(/font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;/, `font-family: ${fonts.body};`)
  if (fonts?.heading) css += `\nh1, h2, h3, h4, .site-title, .hero h1 { font-family: ${fonts.heading}; }\n`
  return css
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A chosen logo-pill colour, or null when the token chip should stay. `#fff` and `#ffffff` count as white. */
export function logoPillColour(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!HEX.test(trimmed)) return null
  const lower = trimmed.toLowerCase()
  if (lower === '#fff' || lower === '#ffffff') return null
  return trimmed
}

/** Rules appended after option CSS. Highlight and ink already flow through var() in the option sheets. A logo pill is appended only when `logoPill` is a non-white colour and that option is on. */
export function brandChromeCss(
  tokens: { logoPill?: string | null } | null | undefined,
  opts: { columns: boolean; overHero: boolean },
): string {
  if (!tokens) return ''
  const parts: string[] = []
  const pill = logoPillColour(tokens.logoPill)
  if (opts.columns && pill) parts.push(`.ft-logo { background: ${pill}; }`)
  if (opts.overHero && pill) parts.push(`.site-header-over.js-over:not(.is-solid) .site-title { background: ${pill}; }`)
  return parts.length ? `\n${parts.join('\n')}\n` : ''
}
