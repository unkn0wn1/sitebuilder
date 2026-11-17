// Default public theme and the small client island for registered embeds.
// Inlined into each HTML page (CSS) or written once per release (embed.js).
// This is the hand-written v1 render bundle; a Vite compile step can replace it later (ADR 0004).
export { BUNDLE_ID, THEME_CSS } from '../../shared/theme-css'

export const EMBED_JS = `// Tiny client island: load a registered Virtuous form when it is close to view.
// Third-party scripts are not part of our JavaScript budget.
for (const root of document.querySelectorAll("[data-embed=virtuous]")) {
  if (!(root instanceof HTMLElement)) continue;
  const load = () => {
    if (root.dataset.loaded) return;
    root.dataset.loaded = "1";
    const src = root.dataset.src;
    if (!src) return;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    if (root.dataset.vform) script.dataset.vform = root.dataset.vform;
    if (root.dataset.orgId) script.dataset.orgId = root.dataset.orgId;
    script.dataset.isGiving = "true";
    script.dataset.dependencies = "[]";
    script.onerror = () => {
      const fallback = root.querySelector(".embed-fallback");
      if (fallback instanceof HTMLElement) fallback.hidden = false;
    };
    root.append(script);
  };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    }, { rootMargin: "200px" });
    io.observe(root);
  } else {
    load();
  }
}
`
