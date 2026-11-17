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

for (const root of document.querySelectorAll("[data-countdown]")) {
  if (!(root instanceof HTMLElement)) continue;
  const end = Date.parse(root.getAttribute("data-countdown") || "");
  if (!end) continue;
  const label = root.querySelector("[data-countdown-label]");
  const update = () => {
    const ms = end - Date.now();
    if (ms <= 0) {
      if (root.dataset.hideWhenPassed === "true") root.hidden = true;
      if (label instanceof HTMLElement) label.textContent = "This offer has ended.";
      return;
    }
    if (!(label instanceof HTMLElement)) return;
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    label.textContent = days > 0 ? days + " day" + (days === 1 ? "" : "s") + " left" : hours + "h " + minutes + "m left";
  };
  update();
  setInterval(update, 60000);
}
`
