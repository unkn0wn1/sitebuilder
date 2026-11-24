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
*, *::before, *::after { box-sizing:border-box;}
html { color-scheme:light;}
body{margin:0;font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;font-size:var(--fs-body);line-height:var(--lh-body);color:var(--ink);background:var(--paper);}
h1, h2, h3, h4 { font-weight:800;letter-spacing:-.02em;}
img, video { max-width:100%;height:auto;}
a { color:var(--accent);}
.skip { position:absolute;left:-999px;top:0;}
.skip:focus { left:var(--space);top:var(--space);background:var(--paper);padding:.5rem .75rem;z-index:10;}
.wrap, .site-header-inner, .site-footer-inner { width:min(100% - 2 * var(--space), var(--max));margin-inline:auto;}
.banner { padding:.6rem var(--space);text-align:center;font-size:.95rem;}
.banner-info { background:var(--band);}
.banner-urgent { background:var(--urgent);color:var(--accent-ink);}
.banner-celebrate { background:var(--celebrate);color:var(--accent-ink);}
.banner a { color:inherit;}
.site-header { position:relative;border-bottom:1px solid var(--line);}
.site-header-inner { display:flex;align-items:center;gap:12px;padding:.7rem 0;flex-wrap:wrap;}
.site-header-centred .site-header-inner { flex-direction:column;}
.site-header-inner > .nav:not(.nav-hamburger) { flex:1;justify-content:flex-end;min-width:0;}
.site-header-inner > .cta-btn { flex:none;margin-left:8px;}
.nav-hamburger > summary, .hero-reserve .reserve-menu { width:44px;height:44px;padding:0;border:0;border-radius:50%;display:grid;place-content:center;gap:5px;background:color-mix(in srgb, var(--ink) 55%, transparent);cursor:pointer;list-style:none;flex:none;}
.nav-hamburger > summary::-webkit-details-marker, .nav details > summary::-webkit-details-marker { display:none;}
.nav-hamburger > summary span, .hero-reserve .reserve-menu span { display:block;width:20px;height:2.5px;border-radius:2px;background:#fff;transition:transform .2s, opacity .2s;}
.nav-hamburger[open] > summary { background:var(--band);}
.nav-hamburger[open] > summary span { background:var(--ink);}
.nav-hamburger[open] > summary span:nth-child(1) { transform:translateY(7.5px) rotate(45deg);}
.nav-hamburger[open] > summary span:nth-child(2) { opacity:0;}
.nav-hamburger[open] > summary span:nth-child(3) { transform:translateY(-7.5px) rotate(-45deg);}
.nav-hamburger .nav-panel { background:#fff;color:var(--ink);border-top:1px solid var(--line);box-shadow:0 18px 30px color-mix(in srgb, var(--ink) 18%, transparent);padding:0 0 20px;margin:0;flex-basis:100%;width:calc(100% + 2 * var(--space));margin-left:calc(-1 * var(--space));}
.nav-hamburger .nav-panel > a, .nav-hamburger .nav-panel > details > summary { display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:0 22px;border-bottom:1px solid var(--line);border-radius:0;background:transparent;font-weight:800;font-size:18px;color:var(--ink);text-decoration:none;}
.nav-hamburger .nav-panel > a.nav-report { color:var(--accent);font-size:15px;font-weight:700;}
.nav-hamburger .nav-panel .nav-chev { width:18px;height:18px;}
.nav-hamburger details[open] > summary { color:var(--accent);box-shadow:none;}
.nav-hamburger .nav-drop { position:static;background:var(--paper);border:0;border-bottom:1px solid var(--line);box-shadow:none;padding:12px 22px 16px;margin:0;}
.nav-hamburger .nav-drop-grid { display:block;}
.nav-hamburger .nav-group-title { display:none;}
.nav-hamburger .nav-mega-links a, .nav-hamburger .nav-panel details > ul a { display:flex;align-items:center;min-height:44px;padding:0;color:var(--ink);font-weight:600;font-size:16px;text-decoration:none;}
.site-header .nav-panel .nav-donate-wide { display:flex;width:calc(100% - 44px);margin:18px 22px 0;border:0;box-shadow:none;}
.site-header-hamburger .nav-hamburger { display:contents;}
.site-title { flex:none;color:inherit;text-decoration:none;font-weight:700;font-size:1.1rem;display:inline-flex;align-items:center;background:var(--surface);padding:.3rem .9rem;border-radius:var(--radius-pill);box-shadow:var(--shadow-card);}
.site-logo { display:block;width:auto;height:2.5rem;max-height:2.75rem;max-width:14rem;}
.site-header-dark { background:var(--ink);color:var(--paper);border-bottom-color:color-mix(in srgb, var(--paper) 20%, transparent);}
.site-header-dark .nav summary, .site-header-dark .site-title { color:var(--paper);}
.site-header-dark .site-title{background:transparent;padding:0;border-radius:0;box-shadow:none;}
.site-header-dark .nav > a, .site-header-dark .nav > details > summary { color:color-mix(in srgb, var(--paper) 82%, transparent);}
.site-header-dark .nav:not(.nav-mega):not(.nav-hamburger) details > ul { background:var(--ink);color:var(--paper);border-color:color-mix(in srgb, var(--paper) 20%, transparent);}
.site-header-dark .nav-hamburger > summary { background:color-mix(in srgb, var(--paper) 22%, transparent);}
.site-header-dark .nav-hamburger[open] > summary { background:var(--band);}
.site-header-dark .nav-hamburger[open] > summary span { background:var(--ink);}
.site-header-dark .nav-drop, .site-header-dark .nav-hamburger .nav-panel { background:#fff;color:var(--ink);}
.site-header-dark .nav-drop a, .site-header-dark .nav-hamburger .nav-panel a, .site-header-dark .nav-hamburger .nav-panel summary { color:var(--ink);}
.site-footer-dark { background:var(--ink);color:color-mix(in srgb, var(--paper) 82%, transparent);border-top-color:color-mix(in srgb, var(--paper) 20%, transparent);}
.site-footer-dark a { color:var(--paper);}
.site-header-dark .site-logo-fallback-light, .site-footer-dark .site-logo-fallback-light { filter:brightness(0) invert(1);}
.site-header:has(details[open]) { background:var(--paper);color:var(--ink);box-shadow:0 6px 20px color-mix(in srgb, var(--ink) 12%, transparent);}
.site-header-dark:has(details[open]) { background:var(--ink);color:var(--paper);}
.site-header:has(details[open]) .nav > a, .site-header:has(details[open]) .nav > details > summary { text-shadow:none;}
.site-header:has(details[open]) .site-title { box-shadow:none;}
.site-header:has(details[open]) > .site-header-inner > .cta-btn { border-color:transparent;box-shadow:none;}
@media (max-width:1023px) {
  .site-logo { width:auto;height:auto;max-height:2.75rem;max-width:calc(100vw - 16rem);}
  .site-header:not(.site-header-hamburger) > .site-header-inner > .nav:not(.nav-hamburger) { display:none;}
  .site-header-centred .site-header-inner { flex-direction:row;}
  .site-header:not(.site-header-hamburger) > .site-header-inner > .cta-btn { margin-left:auto;}
  .site-header:not(.site-header-hamburger) .nav-hamburger { display:contents;}
}
@media (min-width:1024px) {
  .site-header:not(.site-header-hamburger) > .site-header-inner { flex-wrap:nowrap;}
  .site-header-inner > .nav:not(.nav-hamburger) { flex-wrap:nowrap;}
  .site-header:not(.site-header-hamburger) .nav-hamburger { display:none;}
  .site-header-centred .site-header-inner { flex-direction:column;align-items:center;}
  .site-header-centred .nav { justify-content:center;}
  .site-header .nav-mega details { position:static;}
  .site-header .nav-mega .nav-drop { position:absolute;left:0;right:0;top:100%;z-index:6;margin:0;background:#fff;color:var(--ink);border-top:1px solid var(--line);box-shadow:0 24px 40px color-mix(in srgb, var(--ink) 16%, transparent);padding:28px 0 32px;}
  .nav-drop-in { width:min(100% - 2 * var(--space), var(--max));margin-inline:auto;}
  .nav-drop-grid { display:grid;grid-template-columns:270px minmax(0, 1fr);gap:36px;align-items:start;}
  .nav-drop-side { grid-column:1;grid-row:1;}
  .nav-group-title { display:inline-flex;align-items:center;gap:4px;margin:0 0 10px;font-weight:800;font-size:20px;color:var(--ink);text-decoration:none;}
  .nav-mega-links a { display:block;padding:7px 0;color:var(--ink);font-size:16px;line-height:1.35;font-weight:500;text-decoration:none;}
  .nav-drop a:hover { color:var(--accent);}
  .nav:not(.nav-hamburger) details[open] > summary { color:var(--accent);box-shadow:inset 0 -3px 0 var(--accent);border-radius:0;}
  .site-header:has(details[open]) .nav > details > summary:hover { background:var(--band);}
}
.nav { display:flex;gap:4px;flex-wrap:wrap;align-items:center;}
.nav a, .nav summary { font-weight:500;color:var(--muted);text-decoration:none;cursor:pointer;list-style:none;}
.nav > a, .nav > details > summary { display:flex;align-items:center;gap:5px;min-height:44px;padding:0 10px;font-weight:700;font-size:16px;white-space:nowrap;border-radius:var(--radius-pill);}
.nav-mega-links { list-style:none;margin:0;padding:0;position:static;border:0;box-shadow:none;background:transparent;min-width:0;display:block;}
@media (min-width:1200px) {
  .nav > a, .nav > details > summary { padding:0 5px;}
}
@media (max-width:1199px) {
  .nav { gap:2px;}
  .nav > a, .nav > details > summary { padding:0 3px;font-size:14px;gap:2px;}
  .site-header-inner { gap:8px;}
  .site-header-inner > .cta-btn { padding-inline:1rem;}
}
.nav:not(.nav-mega) details { position:relative;}
.nav:not(.nav-mega) details > ul { position:absolute;margin:.25rem 0 0;padding:.5rem .75rem;list-style:none;background:var(--paper);border:1px solid var(--line);min-width:10rem;z-index:5;}
.nav-hamburger .nav-panel details > ul { position:static;margin:0;padding:12px 22px 16px;list-style:none;border:0;border-bottom:1px solid var(--line);box-shadow:none;background:var(--paper);min-width:0;z-index:auto;}
.nav-chev { width:14px;height:14px;flex:none;transition:transform .2s;}
details[open] > summary .nav-chev { transform:rotate(180deg);}
.nav-arw { width:16px;height:16px;flex:none;margin-left:4px;}
.nav details[open] > summary { color:var(--accent);}
@media (prefers-reduced-motion: reduce) {
  .nav-chev, .nav-hamburger > summary span { transition:none;}
}
.cta-btn, .btn, .btn-secondary { display:inline-flex;align-items:center;justify-content:center;text-decoration:none;padding:.75rem 1.65rem;border-radius:var(--radius-pill);min-height:48px;font-weight:800;line-height:1.2;transition:background-color .15s, transform .15s;}
.cta-btn, .btn { background:var(--accent);color:var(--accent-ink);border:0;}
.btn-secondary { background:var(--surface);color:var(--ink);border:2px solid var(--line);}
.btn:hover, .cta-btn:hover { background:var(--accent-strong);transform:translateY(-1px);}
.btn:focus-visible, .cta-btn:focus-visible, .btn-secondary:focus-visible { outline:2px solid var(--ink);outline-offset:3px;box-shadow:0 0 0 3px var(--paper);}
.btn:active, .cta-btn:active, .btn-secondary:active { transform:none;}
.btn-secondary:hover { transform:translateY(-1px);}
.cta-band h2 { font-size: clamp(30px, 7.5vw, 52px); line-height: 1.08; letter-spacing: -0.015em; }
.cta-band p { font-size: clamp(17px, 2.4vw, 20px); }
.cta-band .btn { min-height: 60px; font-size: 20px; }
@media (max-width: 480px) {
  .cta-band .btn { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .btn, .cta-btn, .btn-secondary { transition:none;}
  .btn:hover, .cta-btn:hover, .btn-secondary:hover { transform:none;}
}
.hero { position: relative; min-height: min(70vh, 36rem); display: flex; align-items: flex-end; color: #fff; isolation: isolate; }
.hero-carousel { min-height:clamp(22rem, 100vh, 52rem);min-height:clamp(22rem, 100svh, 52rem);overflow:hidden;}
.hero-media, .hero-video, .hero-media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
.hero::after { content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(to top, color-mix(in srgb, var(--ink) 62%, transparent) 0%, color-mix(in srgb, var(--ink) 28%, transparent) 26%, color-mix(in srgb, var(--ink) 0%, transparent) 48%), linear-gradient(to bottom, color-mix(in srgb, var(--ink) 34%, transparent) 0%, color-mix(in srgb, var(--ink) 0%, transparent) 18%);}
.hero-inner { width:min(100% - 2 * var(--space), var(--max));margin:0 auto 8vh;}
.hero h1 { font-size: var(--fs-display); line-height: 1.05; letter-spacing: -0.01em; margin: 0 0 0.5rem; max-width: 16ch; }
.hero p { max-width:36ch;margin:0 0 1.25rem;color:color-mix(in srgb, white 80%, var(--highlight));}
.section { padding:var(--section-y) 0;}
.section h2 { font-size:var(--fs-h2);line-height:1.1;margin:0 0 1rem;}
.prose { max-width:65ch;}
.prose :where(p, ul, ol) { margin:0 0 1rem;}
.prose h2 { font-size:var(--fs-h2);line-height:1.1;}
.prose h3, .prose h4 { font-size:var(--fs-h3);}
.prose h2, .prose h3, .prose h4 { margin:1.5rem 0 .5rem;}
.split { display:grid;gap:2rem;align-items:center;}
.figure { margin:0;}
.figure figcaption, .before-after figcaption { color:var(--muted);font-size:.9rem;margin-top:.5rem;}
.gallery { display:grid;gap:clamp(10px, 1.5vw, 16px);grid-template-columns:1fr;}
.cards, .tiers { display:grid;gap:clamp(16px, 2vw, 24px);grid-template-columns:1fr;}
.gallery > *, .cards > *, .tiers > * { min-width:0;}
.split img, .figure img, .gallery img, .before-after figure img { border-radius:var(--radius-media);}
.quote { border-left:4px solid var(--decor);margin:0;padding:.25rem 0 .25rem 1.25rem;font-size:clamp(22px, 3.2vw, 32px);font-weight:800;line-height:1.15;}
.quote footer { margin-top:.75rem;color:var(--muted);font-size:var(--fs-body);font-weight:600;}
.quote + .btn, .before-after + .btn { margin-top: 1.5rem; }
@media (min-width:700px) {
  .split { grid-template-columns:1fr 1fr;}
  .split-image-left .split-copy { order:2;}
  .gallery { grid-template-columns:1fr 1fr;}
  .cards, .tiers { grid-template-columns:1fr 1fr;}
  .before-after { grid-template-columns:1fr 1fr;}
  .trust-groups { grid-template-columns:repeat(auto-fit, minmax(16rem, 1fr));align-items:start;}
}
@media (min-width:1024px) {
  .gallery { grid-template-columns:1fr 1fr 1fr;}
  .cards, .tiers { grid-template-columns:1fr 1fr 1fr;}
}
.stats { display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit, minmax(8rem, 1fr));}
.stat-value { display:block;font-size:var(--fs-stat);font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;}
.stat-label { color:var(--muted);}
.card, .tier, .donate-box, .stats > div { background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow-card);}
.card, .donate-box { border-radius:var(--radius-card);}
.tier, .stats > div { border-radius:var(--radius-tile);}
.card, .tier { overflow:hidden;}
.stats > div { background:var(--paper);padding:1rem;}
.card-body { padding:16px;}
@media (min-width:760px) {
  .card-body { padding:22px;}
}
.cta-band { background:linear-gradient(180deg, var(--paper), var(--band) 46%, color-mix(in srgb, var(--highlight) 32%, var(--band)));padding:var(--section-y) 0;text-align:center;}
.cta-band.tone-accent, .match-banner.tone-primary, .match-banner.tone-accent { background:linear-gradient(165deg, var(--accent), var(--accent-strong));color:var(--accent-ink);}
.cta-band.tone-accent a.btn, .match-banner.tone-primary a.btn, .match-banner.tone-accent a.btn { background:var(--surface);color:var(--ink);box-shadow:var(--shadow-raised);}
.faq { display:grid;gap:.75rem;}
.faq details { background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-tile);padding:.85rem 1rem;}
.faq summary { cursor:pointer;font-weight:600;}
.donate { background:linear-gradient(180deg, var(--paper), color-mix(in srgb, var(--highlight) 34%, var(--paper)));padding:var(--section-y) 0;}
.embed { background:var(--band);padding:3.5rem 0;}
.donate-box { padding:1.5rem;min-height:12rem;border:2px solid var(--highlight);}
.embed-frame { width:100%;min-height:20rem;border:0;}
.embed-fallback { margin:0;}
.site-footer { padding:2rem 0 3rem;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line);margin-top:2rem;}
.site-footer a { color:inherit;}
.footer-social { display:flex;gap:.75rem;flex-wrap:wrap;margin:.75rem 0;}
@media (max-width: 640px), (prefers-reduced-motion: reduce) {
  .hero-video { display:none;}
}

.lede { color:var(--muted);max-width:38em;margin:0 0 1.25rem;}
.eyebrow { text-transform:uppercase;letter-spacing:.08em;font-size:var(--fs-eyebrow);font-weight:700;color:var(--accent-strong);margin:0 0 .5rem;}
.tier-give { display:flex;flex-direction:column;height:100%;color:inherit;text-decoration:none;}
.tier-give:hover { box-shadow:inset 0 0 0 2px var(--accent), var(--shadow-selected);}
.tier-give:focus-visible { outline:2px solid var(--ink);outline-offset:3px;box-shadow:inset 0 0 0 2px var(--accent), var(--shadow-selected), 0 0 0 3px var(--paper);}
.tier-body { padding:1rem;}
.tier-amount { font-size: clamp(22px, 5.5vw, 28px); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; margin: 0 0 0.25rem; }
.tier-frequency { font-size:.85rem;font-weight:600;color:var(--muted);margin:0 0 .5rem;text-transform:capitalize;}
.tier-other { color:var(--muted);margin:1rem 0 0;}
.donate-prefill-hint { margin:0 0 .85rem;padding:.7rem .9rem;border-radius:.4rem;background:var(--band);border:2px solid var(--accent);font-weight:600;}
.donate-prefill-hint[hidden] { display:none;}
.goal-progress { appearance: none; -webkit-appearance: none; width: 100%; height: 12px; border: 0; border-radius: var(--radius-pill); background: var(--band); color: var(--accent); overflow: hidden; }
.goal-progress::-webkit-progress-bar { background: var(--band); border-radius: var(--radius-pill); }
.goal-progress::-webkit-progress-value { background: linear-gradient(90deg, var(--accent), var(--highlight)); border-radius: var(--radius-pill); }
.goal-progress::-moz-progress-bar { background: linear-gradient(90deg, var(--accent), var(--highlight)); border-radius: var(--radius-pill); }
.progress-meta { margin:.75rem 0 0;font-weight:800;}
.progress-match, .progress-date { color:var(--muted);margin:.35rem 0 0;}
.match-banner { background:var(--band);padding:1.25rem 0;}
.match-message { font-size:1.15rem;font-weight:600;margin:0 0 .35rem;}
.match-line, .match-countdown { margin:0 0 .35rem;}
.before-after { display:grid;gap:1rem;margin:1.5rem 0;}
.before-after figure { margin:0;}
.trust-groups { display:grid;gap:2rem;}
.trust-group-label { font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 .75rem;}
.trust-strip{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;}
.trust-item, .trust-link { display:flex;flex-direction:column;align-items:center;gap:.35rem;text-align:center;text-decoration:none;color:inherit;max-width:9rem;}
.trust-logo, .trust-item picture, .trust-item img { max-height:2rem;}
.trust-logo, .trust-item img { filter:grayscale(1);}
.trust-item:hover .trust-logo, .trust-item:hover img, .trust-item:focus-within .trust-logo, .trust-item:focus-within img { filter:none;}
.trust-name { font-size:.9rem;font-weight:600;}
.trust-note { font-size:.8rem;color:var(--muted);}
.trust-badge { max-width:8.5rem;}
.trust-badge iframe { max-width:100%;height:auto;}
`

// Extra rules for optional shell parts. Appended to a page only when that option is used,
// so a page that leaves them at their defaults keeps the theme CSS byte-identical.
export const HEART_CSS = `
.cta-btn:has(.ico-heart) { white-space:nowrap;box-shadow:0 0 0 .3rem color-mix(in srgb, var(--highlight) 70%, transparent);}
.ico-heart { margin-right:.45rem;vertical-align:-2px;flex:none;}
`

export const UTILITY_CSS = `
.util { font-size:.9rem;font-weight:600;color:var(--muted);white-space:nowrap;text-decoration:none;}
.site-header-dark .util { color:var(--paper);}
@media (max-width: 1023px) {
  .site-header-hamburger .util-bar { display: none; }
}
@media (min-width: 1024px) {
  .site-header-hamburger .nav-panel .util-drawer { display: none; }
}
`

export const BANNER_ACCENT_CSS = `
.banner-accent { background:var(--accent);color:var(--accent-ink);font-size:.85rem;font-weight:700;padding:.45rem var(--space);letter-spacing:.01em;}
.banner-accent a { text-decoration:underline;text-underline-offset:2px;}
`

export const FOOTER_COLUMNS_CSS = `
.site-footer-cols { --f-bg:var(--paper);--f-fg:var(--ink);--f-mut:var(--muted);--f-line:var(--line);margin-top:0;padding:0;border-top:0;background:var(--f-bg);color:var(--f-fg);font-size:.92rem;}
.site-footer-cols.site-footer-dark { --f-bg:linear-gradient(160deg, var(--ink), color-mix(in srgb, var(--ink) 72%, black));--f-fg:var(--paper);--f-mut:color-mix(in srgb, var(--paper) 62%, transparent);--f-line:color-mix(in srgb, var(--paper) 14%, transparent);}
.site-footer-cols::before { content:"";display:block;height:3px;background:linear-gradient(90deg, var(--accent), var(--highlight), var(--accent));}
.site-footer-cols a { color:inherit;}
.ft-wrap { width:min(100% - 2 * var(--space), var(--max));margin:0 auto;padding:3rem 0 1.5rem;}
.ft-grid { display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:2.5rem;}
.ft-logo { display:inline-block;background:var(--surface);border-radius:.6rem;padding:.4rem .8rem;text-decoration:none;color:var(--ink);}
.ft-logo img { display:block;height:2.4rem;}
.ft-tag { font-size:1.25rem;font-weight:700;line-height:1.3;margin:1.1rem 0 .6rem;}
.ft-tag em { display:block;font-style:normal;color:var(--highlight);}
.ft-about { max-width:24rem;color:var(--f-mut);}
.ft-about p { margin:0;}
.ft-col h3 { text-transform:uppercase;letter-spacing:.1em;font-size:.7rem;color:var(--f-mut);margin:0 0 1rem;}
.ft-col address { font-style:normal;display:grid;gap:.45rem;}
.ft-links { display:grid;gap:.65rem;}
.ft-links a { display:inline-flex;align-items:center;gap:.4rem;font-weight:600;text-decoration:none;}
.ft-links a:hover, .ft-links a:focus-visible { text-decoration:underline;}
.ft-social { display:flex;gap:.6rem;margin:1.25rem 0 0;}
.ft-social a { width:2.4rem;height:2.4rem;border-radius:50%;border:1px solid var(--f-line);display:grid;place-items:center;}
.ft-social a:hover { background:color-mix(in srgb, var(--f-fg) 14%, transparent);}
.ft-base { display:flex;justify-content:space-between;gap:1.5rem;flex-wrap:wrap;margin-top:2.5rem;padding-top:1.25rem;border-top:1px solid var(--f-line);font-size:.78rem;color:var(--f-mut);}
.ft-base p { margin:0;}
@media (max-width:800px) { .ft-grid { grid-template-columns:1fr;gap:2rem;} .ft-wrap { padding-top:2.25rem;} }
`

/** See-through bar when the page emits .js-over (a leading hero). The bar sticks inside .over-frame, over the hero.
 *  A non-carousel hero keeps a .hero-reserve copy of the closed bar so the photo runs underneath it and the
 *  copy stays at the end of a min(70vh, 36rem) row. No leading hero: the header stays solid and in flow.
 *  Layout does not read --sb-header-h or --strip. /header.js may still set them. */
export const OVER_HERO_CSS = `
header.site-header-over.js-over { position:sticky;top:0;z-index:50;align-self:start;background:linear-gradient(to bottom, color-mix(in srgb, var(--ink) 72%, transparent), color-mix(in srgb, var(--ink) 0%, transparent));border-bottom:0;transition:background-color .25s, box-shadow .25s;}
.site-header-over.js-over.is-solid{background:var(--paper);box-shadow:0 .25rem 1rem color-mix(in srgb, var(--ink) 18%, transparent);}
.site-header-dark.site-header-over.js-over.is-solid{background:var(--ink);}
.site-header-over.js-over:not(.is-solid) .nav a,
.site-header-over.js-over:not(.is-solid) .nav summary,
.site-header-over.js-over:not(.is-solid) .util,
.site-header-over.js-over:not(.is-solid) .nav-hamburger > summary{color:var(--paper);text-shadow:0 1px 2px color-mix(in srgb,var(--ink) 62%,transparent),0 0 12px #0006;}
.site-header-over.js-over:not(.is-solid) .site-title{background:var(--surface);padding:.3rem .9rem;border-radius:var(--radius-pill);box-shadow:var(--shadow-card);}
.site-header-dark.site-header-over.js-over:not(.is-solid) .site-title { background: transparent;padding:0;border-radius:0;box-shadow:none;color:var(--paper);text-shadow:0 1px 2px color-mix(in srgb,var(--ink) 50%,transparent);}
.site-header-over.js-over:not(.is-solid) .cta-btn{border:2px solid color-mix(in srgb, var(--paper) 90%, transparent);box-shadow:0 4px 14px color-mix(in srgb, var(--ink) 20%, transparent);text-shadow:0 1px 2px #0007;}
.site-header-over.js-over:has(details[open]){position:relative;background:var(--paper);box-shadow:0 6px 20px color-mix(in srgb, var(--ink) 12%, transparent);}
.site-header-dark.site-header-over.js-over:has(details[open]){background:var(--ink);}
.site-header-over.js-over:has(details[open]) .nav > a, .site-header-over.js-over:has(details[open]) .nav > details > summary, .site-header-over.js-over:has(details[open]) .nav-panel a, .site-header-over.js-over:has(details[open]) .nav-panel summary{color:var(--ink);text-shadow:none;}
.site-header-dark.site-header-over.js-over:has(details[open]) .nav > a, .site-header-dark.site-header-over.js-over:has(details[open]) .nav > details > summary{color:var(--paper);}
.site-header-over.js-over:has(details[open]) .nav details[open] > summary, .site-header-over.js-over:has(details[open]) .nav-panel > a.nav-report{color:var(--accent);}
.site-header-over.js-over:has(details[open]) .cta-btn{border-color:transparent;box-shadow:none;text-shadow:none;}
@media (prefers-reduced-motion: reduce){.site-header-over.js-over{transition:none}}
.over-frame { display:grid;}
.over-frame > header.site-header-over.js-over,.over-frame > main { grid-area:1/1;min-width:0;}
.hero-lead { display:grid;grid-template-rows:auto minmax(min(70vh,36rem),auto);min-height:0;}
.hero-lead .hero-inner { grid-row:2;align-self:end;}
.hero-reserve { visibility:hidden;border-bottom:0;grid-row:1;}
@media (min-width:1024px){.hero-reserve:not(.site-header-hamburger) .reserve-menu{display:none}}
`

/** Photo tiles beside the links in a mega panel. Appended only when a mega menu actually has tiles. */
export const TILE_CSS = `
.nav-mega-tiles { grid-column:2;grid-row:1;min-width:0;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:18px;}
.nav-mega-tiles > li:has(.tile-lg) { grid-column:span 3;min-width:0;}
.nav-mega-tiles > li:has(.tile-sm) { grid-column:span 2;min-width:0;}
.nav-mega-tiles .tile { display:block;color:var(--ink);text-decoration:none;font-weight:700;font-size:15px;line-height:1.3;}
.nav-mega-tiles .tile img { display:block;width:100%;height:auto;aspect-ratio:16/7;object-fit:cover;border-radius:var(--radius-media);margin-bottom:8px;transition:transform .2s;}
.nav-mega-tiles .tile-sm img { aspect-ratio:3/2;}
.nav-mega-tiles .tile:hover img { transform:scale(1.02);}
.nav-mega-tiles .tile:hover { color:var(--accent);}
.nav-mega-tiles .tile-text { padding:1rem;background:var(--band);border-radius:var(--radius-tile);}
.nav-mega-tiles .tile:focus-visible { outline:3px solid var(--accent);outline-offset:2px;}
.site-header-dark .nav-mega-tiles .tile { color:var(--ink);}
.site-header-dark .nav-mega-tiles .tile-text { background:var(--band);color:var(--ink);}
@media (max-width:1023px) {
  .nav-hamburger .nav-mega-tiles { grid-template-columns:1fr 1fr;gap:10px;}
  .nav-hamburger .nav-mega-tiles > li { grid-column:auto;}
  .nav-hamburger .nav-mega-tiles .tile img { aspect-ratio:3/2;border-radius:10px;}
  .nav-hamburger .nav-mega-tiles > li:nth-child(n+5) { display:none;}
}
@media (prefers-reduced-motion: reduce) { .nav-mega-tiles .tile img { transition:none;} }
`

/** Carousel stage and controls. Appended only when a hero has two or more slides in a carousel mode. */
export const HERO_CAROUSEL_CSS = `
.hero-carousel .hero-stage { position:absolute;inset:0;touch-action:pan-y;}
.hero-carousel .hero-slide { position:absolute;inset:0;}
.hero-carousel .hero-controls { position:absolute;z-index:2;left:50%;bottom:max(1.1rem, calc(env(safe-area-inset-bottom) + .75rem));transform:translateX(-50%);display:flex;align-items:center;gap:.15rem;padding:.25rem .35rem;max-width:calc(100% - 2 * var(--space));border-radius:var(--radius-pill);background:color-mix(in srgb, var(--ink) 38%, transparent);border:1px solid color-mix(in srgb, var(--paper) 22%, transparent);backdrop-filter:blur(10px);}
.hero-carousel :is(.hero-prev, .hero-next, .hero-pause) { width: 48px; height: 48px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--paper); display: grid; place-items: center; cursor: pointer; transition: background-color 0.15s; }
.hero-carousel :is(.hero-prev, .hero-next, .hero-pause):is(:hover, :focus-visible) { background:color-mix(in srgb, var(--paper) 20%, transparent);}
.hero-carousel .hero-controls button:focus-visible { outline:2px solid var(--ink);outline-offset:3px;box-shadow:0 0 0 3px var(--paper);}
.hero-carousel .hero-controls svg { width:24px;height:24px;display:block;}
.hero-carousel .hero-pause .ico-play { display:none;}
.hero-carousel .hero-pause[aria-pressed="true"] .ico-pause { display:none;}
.hero-carousel .hero-pause[aria-pressed="true"] .ico-play { display:block;}
.hero-carousel .hero-dot { position: relative; width: 44px; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--paper); cursor: pointer; }
.hero-carousel .hero-dot::after { content:"";position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:color-mix(in srgb, var(--paper) 55%, transparent);transition:transform .2s, background-color .2s;}
.hero-carousel .hero-dot[aria-current="true"]::after { background:var(--paper);transform:scale(1.45);}
.hero-carousel .hero-sr, .hero-carousel .hero-live { position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0, 0, 0, 0);white-space:nowrap;}
.hero-carousel [hidden] { display:none;}
@media (max-width:640px) {
  .hero-carousel .hero-controls { gap:0;padding:.15rem .2rem;}
  .hero-carousel :is(.hero-prev, .hero-next, .hero-pause) { width:44px;height:44px;}
  .hero-carousel .hero-dot { width:24px;min-width:24px;min-height:24px;}
}
@media (prefers-reduced-motion: reduce) { .hero-carousel :is(.hero-prev, .hero-next, .hero-pause), .hero-carousel .hero-dot::after { transition: none; } }
`

/** Match thermometer card. Appended only when a page has a MatchThermometer block. No animation. */
export const THERMOMETER_CSS = `
.th { display:grid;gap:20px;padding:20px;grid-template-areas:"hd" "gauge" "info";background:#fff;border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card);}
.th-hd { grid-area:hd;}
.th-gauge { grid-area:gauge;display:flex;flex-direction:column;align-items:center;min-width:0;}
.th-info { grid-area:info;min-width:0;}
.th-chip { display:inline-flex;align-items:center;gap:8px;max-width:100%;background:color-mix(in srgb, var(--highlight) 28%, white);border:1px solid color-mix(in srgb, var(--highlight) 70%, white);border-radius:var(--radius-pill);padding:5px 12px;font-size:14px;font-weight:700;line-height:1.35;}
.th-dot { width:9px;height:9px;border-radius:50%;background:var(--accent);flex:none;}
.th-big { margin:10px 0 0;font-size:var(--fs-big);font-weight:900;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}
.th-bigl { margin:6px 0 0;color:var(--muted);font-size:15px;}
.th-bigl b { color:var(--ink);}
.th-tubewrap { width:100%;}
.th-tube { display:block;width:150px;height:auto;margin-inline:auto;overflow:visible;}
.th-tube text { font-family:system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:700;fill:var(--muted);stroke:none;}
.th-badge-text { fill:#fff;font-size:14px;font-weight:800;}
.th-glass { fill:#fff;stroke:var(--line);stroke-width:3;}
.th-mercury { fill:var(--accent);}
.th-shine { fill:#fff;opacity:.25;}
.th-stripe-a { fill:var(--highlight);}
.th-stripe-b { fill:color-mix(in srgb, var(--highlight) 62%, white);}
.th-ticks { stroke:color-mix(in srgb, var(--line) 55%, var(--muted));stroke-width:2;fill:none;}
.th-badge-bg { fill:var(--ink);}
.th-legend { list-style:none;margin:10px 0 0;padding:0;display:flex;justify-content:center;gap:16px;font-size:14px;font-weight:600;color:var(--muted);}
.th-swatch { display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px;}
.th-swatch-d { background:var(--accent);}
.th-swatch-m { background:var(--highlight);}
.th-stats { display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:10px;margin:0 0 18px;}
.th-stats div { background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-tile);padding:10px 12px;}
.th-stats dt { font-size:13px;font-weight:700;color:var(--muted);}
.th-stats dd { margin:2px 0 0;font-size:var(--fs-stat);font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
.th-mf-h { display:flex;justify-content:space-between;gap:12px;align-items:baseline;font-size:14px;color:var(--muted);margin:0 0 6px;}
.th-mf-h b { color:var(--ink);}
.th-mf-bar { appearance:none;-webkit-appearance:none;display:block;width:100%;height:10px;border:0;border-radius:99px;background:var(--line);color:var(--highlight);overflow:hidden;margin:0 0 18px;}
.th-mf-bar::-webkit-progress-bar { background:var(--line);border-radius:99px;}
.th-mf-bar::-webkit-progress-value { background:var(--highlight);border-radius:99px;}
.th-mf-bar::-moz-progress-bar { background:var(--highlight);border-radius:99px;}
.th-cd-h { margin:0 0 8px;font-weight:800;}
.th-cd { display:flex;gap:8px;}
.th-cd div { background:var(--ink);color:#fff;border-radius:12px;min-width:62px;padding:8px 6px;text-align:center;}
.th-cd b { display:block;font-size:26px;font-weight:900;line-height:1.1;font-variant-numeric:tabular-nums;}
.th-cd span { display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.8;}
.th-ended { margin:0 0 8px;font-weight:700;}
.th-when { font-size:13px;color:var(--muted);margin:8px 0 18px;}
.th .btn { width:100%;min-height:60px;font-size:19px;}
.th-note { text-align:center;font-size:14px;color:var(--muted);margin:10px 0 0;}
.th-bar { display:none;width:100%;position:relative;}
.th-bar-svg { display:block;width:100%;height:auto;overflow:visible;}
.th-bar-svg text { font-family:system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;font-size:14px;font-weight:800;fill:#fff;}
.th-scale { display:grid;grid-template-columns:repeat(4, 1fr);text-align:right;font-size:13px;font-weight:700;color:var(--muted);margin-top:6px;}
@media (min-width:760px) {
.th { grid-template-columns:200px 1fr;grid-template-areas:"gauge hd" "gauge info";align-items:start;padding:28px 32px;gap:8px 36px;}
}
@media (max-width:759px) {
.th-tubewrap { display:none;}
.th-bar { display:block;}
.th-gauge { align-items:stretch;}
.th-legend { justify-content:flex-start;}
.th-cd div { min-width:0;flex:1;}
.th-stats { gap:8px;}
.th-stats div { padding:10px 6px;}
.th-stats dd { font-size:clamp(15px, 4.4vw, 22px);white-space:nowrap;}
}
`

/** Gift picker card. Appended only when an ImpactTiers block uses layout picker. No script. */
const PICKER_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8]
function pickerWhen(pseudo: string, tail: string): string {
  return PICKER_SLOTS.map((n) => `.ga input:nth-of-type(${n}):${pseudo}~${tail}(${n})`).join(', ')
}

export const PICKER_CSS = `
.ga { position:relative;display:grid;gap:18px;padding:16px;grid-template-columns:1fr;grid-template-areas:"stage" "list" "foot";background:#fff;border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card);}
.ga-stage { grid-area:stage;min-width:0;}
.ga-list { grid-area:list;display:grid;gap:10px;min-width:0;}
.ga-foot { grid-area:foot;display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;}
.ga-sr { position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.ga-f { display:none;margin:0;position:relative;border-radius:var(--radius-tile);overflow:hidden;background:var(--paper);}
.ga-f img { display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;}
.ga-f figcaption { position:absolute;left:0;right:0;bottom:0;margin:0;padding:48px 18px 16px;background:linear-gradient(to top, color-mix(in srgb, var(--ink) 82%, transparent), transparent);color:#fff;font-weight:600;font-size:16px;line-height:1.35;}
.ga-f figcaption b { display:block;font-size:34px;font-weight:900;line-height:1;margin:0 0 4px;}
.ga-l { display:flex;align-items:center;gap:14px;min-height:64px;padding:10px 16px;border:2px solid var(--line);border-radius:var(--radius-tile);cursor:pointer;background:#fff;transition:border-color .15s, background-color .15s;}
.ga-l b { font-size:22px;font-weight:900;min-width:58px;flex:none;font-variant-numeric:tabular-nums;}
.ga-l span { font-weight:600;font-size:15px;line-height:1.3;}
.ga-l:hover { border-color:var(--decor);}
.ga .ga-give { display:none;height:auto;flex-direction:row;color:var(--accent-ink);text-decoration:none;min-height:52px;padding:0 26px;}
.ga .ga-give:hover { box-shadow:none;}
.ga .tier-other { margin:0;color:var(--muted);font-size:15px;text-underline-offset:3px;}
${pickerWhen('checked', '.ga-stage .ga-f:nth-of-type')} { display:block;}
${pickerWhen('checked', '.ga-foot .ga-give:nth-of-type')} { display:inline-flex;}
${pickerWhen('checked', '.ga-list .ga-l:nth-of-type')} { border-color:var(--accent);background:color-mix(in srgb, var(--highlight) 55%, #fff);box-shadow:var(--shadow-selected);}
${pickerWhen('focus-visible', '.ga-list .ga-l:nth-of-type')} { outline:3px solid var(--ink);outline-offset:2px;}
@media (min-width:760px) {
.ga { grid-template-columns:minmax(0, 1fr) minmax(0, 1.15fr);grid-template-areas:"list stage" "foot stage";padding:22px;gap:22px;align-items:start;}
.ga-foot { flex-direction:row;align-items:center;flex-wrap:wrap;gap:12px 16px;}
}
@media (prefers-reduced-motion: reduce) {
.ga-l { transition:none;}
}
`



/** White or warm section fill. Appended only when a block sets background to card or warm, after the theme so it wins over .donate. */
export const RHYTHM_CSS = `
.bg-card{background:#fff}
.bg-warm{background:linear-gradient(180deg, var(--paper), var(--band) 46%, color-mix(in srgb, var(--highlight) 32%, var(--band)))}
`

/** Static donation form picture. Appended only when a page has a DonationEmbed. Hidden once the provider script loads. */
export const DONATE_PREVIEW_CSS = `
.is-provider .donate-preview{display:none}
.donate:has(.donate-preview){text-align:center;padding-block:5rem}
.donate h2{font-size:2.4rem}
.donate-box:has(.donate-preview){max-width:26rem;margin:0 auto;background:#fff}
.donate-preview{display:grid;gap:12px}
.dp-tabs,.dp-chips{display:grid;gap:8px}
.dp-tabs{grid-template-columns:1fr 1fr}
.dp-chips{grid-template-columns:repeat(4,1fr)}
.dp-tab,.dp-chip,.dp-amount,.dp-other{border:2px solid var(--line);border-radius:10px;font-weight:800;padding:.5rem .2rem}
.dp-tab,.dp-chip.is-on,.dp-amount{color:var(--accent);border-color:var(--accent)}
.dp-amount{margin:0;border-color:var(--highlight);font-size:3rem;line-height:1}
.dp-tab.is-on,.donate-preview button{background:var(--accent);color:var(--accent-ink)}
.dp-other,.dp-total{display:flex;justify-content:space-between;margin:0}
.donate-preview button{width:100%;min-height:52px;border:0;border-radius:99px;font-weight:800;opacity:1}
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
  tokens:{ logoPill?:string | null } | null | undefined,
  opts:{ columns:boolean;overHero:boolean },
):string {
  if (!tokens) return ''
  const parts: string[] = []
  const pill = logoPillColour(tokens.logoPill)
  if (opts.columns && pill) parts.push(`.ft-logo { background: ${pill}; }`)
  if (opts.overHero && pill) parts.push(`.site-header-over.js-over:not(.is-solid) .site-title { background: ${pill}; }`)
  return parts.length ? `\n${parts.join('\n')}\n` : ''
}
