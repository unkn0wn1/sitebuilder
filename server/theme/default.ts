// Default public theme and the small client island for registered embeds.
// Inlined into each HTML page (CSS) or written once per release (embed.js).
// This is the hand-written v1 render bundle; a Vite compile step can replace it later (ADR 0004).
export { BUNDLE_ID, THEME_CSS } from '../../shared/theme-css'

export const EMBED_JS = `// Tiny client island: load a registered Virtuous form when it is close to view,
// pre-fill it from impact-tier clicks, and tick down any countdown blocks.
// Third-party scripts are not part of our JavaScript budget.
// Virtuous Raise pre-fill: URL params amount and frequency take precedence over
// window.RaiseDonorsForms.settings.giftInfo. See https://apidocs.raisedonors.com/
function applyDonatePrefill(prefill) {
  if (!prefill.amount && !prefill.frequency) return;
  var forms = window.RaiseDonorsForms || {};
  var settings = forms.settings || {};
  var giftInfo = Object.assign({}, settings.giftInfo || {});
  if (prefill.amount) giftInfo.amount = Number(prefill.amount) || prefill.amount;
  if (prefill.frequency) giftInfo.frequency = prefill.frequency;
  settings.giftInfo = giftInfo;
  forms.settings = settings;
  window.RaiseDonorsForms = forms;
  var url = new URL(location.href);
  if (prefill.amount) url.searchParams.set("amount", prefill.amount);
  else url.searchParams.delete("amount");
  if (prefill.frequency) url.searchParams.set("frequency", prefill.frequency);
  else url.searchParams.delete("frequency");
  if (!url.hash) url.hash = "donate";
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function donateHintText(prefill) {
  if (!prefill.amount && !prefill.frequency) return "";
  var amount = prefill.label || prefill.amount || "";
  var frequency = prefill.frequency === "once" ? "one-time" : prefill.frequency;
  if (frequency && amount) return "Selected: " + amount + ", " + frequency + ". You can change this on the form.";
  if (amount) return "Selected: " + amount + ". You can change this on the form.";
  return "Selected: " + frequency + ". You can change this on the form.";
}

function showDonateHint(prefill) {
  var text = donateHintText(prefill);
  for (var hint of document.querySelectorAll("[data-donate-hint]")) {
    if (!(hint instanceof HTMLElement)) continue;
    hint.hidden = !text;
    hint.textContent = text;
  }
}

function loadVirtuous(root) {
  if (!(root instanceof HTMLElement) || root.dataset.loaded) return;
  root.dataset.loaded = "1";
  var src = root.dataset.src;
  if (!src) return;
  var script = document.createElement("script");
  script.src = src;
  script.async = true;
  if (root.dataset.vform) script.dataset.vform = root.dataset.vform;
  if (root.dataset.orgId) script.dataset.orgId = root.dataset.orgId;
  script.dataset.isGiving = "true";
  script.dataset.dependencies = "[]";
  script.onerror = function () {
    var fallback = root.querySelector(".embed-fallback");
    if (fallback instanceof HTMLElement) fallback.hidden = false;
  };
  root.append(script);
}

function remountVirtuous(root) {
  if (!(root instanceof HTMLElement)) return;
  delete root.dataset.loaded;
  for (var node of Array.from(root.children)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList.contains("embed-fallback") || node.hasAttribute("data-donate-hint")) continue;
    node.remove();
  }
  loadVirtuous(root);
}

function prefillFromElement(el) {
  return {
    amount: el.getAttribute("data-donate-amount") || undefined,
    frequency: el.getAttribute("data-donate-frequency") || undefined,
    label: el.getAttribute("data-donate-label") || undefined
  };
}

function observeVirtuous(root) {
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        loadVirtuous(root);
      }
    }, { rootMargin: "200px" });
    io.observe(root);
  } else {
    loadVirtuous(root);
  }
}

for (var root of document.querySelectorAll("[data-embed=virtuous]")) {
  if (root instanceof HTMLElement) observeVirtuous(root);
}

document.addEventListener("click", function (event) {
  var target = event.target;
  if (!(target instanceof Element)) return;
  var link = target.closest("a.tier-give, [data-donate-amount], [data-donate-frequency]");
  if (!(link instanceof HTMLElement)) return;
  var prefill = prefillFromElement(link);
  applyDonatePrefill(prefill);
  showDonateHint(prefill);
  var box = document.querySelector("[data-embed=virtuous]");
  if (box instanceof HTMLElement && box.dataset.loaded) remountVirtuous(box);
  event.preventDefault();
  var dest = box instanceof HTMLElement ? box : document.getElementById("donate");
  if (dest) dest.scrollIntoView({ behavior: "smooth", block: "start" });
});

(function showPrefillFromUrl() {
  var params = new URLSearchParams(location.search);
  var prefill = { amount: params.get("amount") || undefined, frequency: params.get("frequency") || undefined };
  if (prefill.amount || prefill.frequency) showDonateHint(prefill);
})();

for (var root of document.querySelectorAll("[data-countdown]")) {
  if (!(root instanceof HTMLElement)) continue;
  var end = Date.parse(root.getAttribute("data-countdown") || "");
  if (!end) continue;
  var label = root.querySelector("[data-countdown-label]");
  var update = (function (root, end, label) {
    return function () {
      var ms = end - Date.now();
      if (ms <= 0) {
        if (root.dataset.hideWhenPassed === "true") root.hidden = true;
        if (label instanceof HTMLElement) label.textContent = "This offer has ended.";
        return;
      }
      if (!(label instanceof HTMLElement)) return;
      var days = Math.floor(ms / 86400000);
      var hours = Math.floor((ms % 86400000) / 3600000);
      var minutes = Math.floor((ms % 3600000) / 60000);
      label.textContent = days > 0 ? days + " day" + (days === 1 ? "" : "s") + " left" : hours + "h " + minutes + "m left";
    };
  })(root, end, label);
  update();
  setInterval(update, 60000);
}
`

