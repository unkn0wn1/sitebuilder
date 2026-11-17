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
} as const
export type ThemeTokens = { [K in keyof typeof DEFAULT_THEME_TOKENS]: string }

export const BUNDLE_ID = "theme-default-1"

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
`


/** Build public CSS from a brand pack, keeping the default rules and swapping tokens and fonts. */
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
