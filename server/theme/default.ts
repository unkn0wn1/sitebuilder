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

/** See-through header, served as /header.js only when a page asks for it. A leading hero already includes .js-over. */
export const HEADER_JS = `// Transparent over a leading hero, solid once scrolled or while a menu is open.
// The page already has .js-over and reserves the bar. These measurements must not move layout.
(function () {
  var over = document.querySelector('.site-header-over');
  var first = document.querySelector('main > :first-child');
  var strip = document.querySelector('.banner');
  if (!over || !first || !/ hero /.test(' ' + first.className + ' ')) return;
  over.classList.add('js-over');
  var measured = false;
  var syncOver = function () {
    var solid = window.scrollY > 40 || !!over.querySelector('details[open]');
    over.classList.toggle('is-solid', solid);
    var gap = strip ? Math.max(0, Math.round(strip.getBoundingClientRect().bottom)) : 0;
    over.style.setProperty('--strip', gap + 'px');
    // Record the transparent bar height once. Layout CSS does not read this, so turning solid cannot jump the hero.
    // On the document element: the hero is not inside the header, so it would not inherit.
    if (!solid || !measured) {
      document.documentElement.style.setProperty('--sb-header-h', Math.round(over.getBoundingClientRect().height) + 'px');
      measured = true;
    }
  };
  window.addEventListener('resize', syncOver);
  window.addEventListener('scroll', syncOver, { passive: true });
  over.addEventListener('toggle', syncOver, true);
  syncOver();
})();
`

/** Hero carousel, served as /hero.js only when a page has two or more slides. Progressive: without it the first slide stays and the controls stay hidden. */
export const HERO_JS = `// Advances each hero carousel. Without this file the first slide stays visible and the controls stay hidden.
(function () {
  var roots = document.querySelectorAll('.hero-carousel');
  for (var r = 0; r < roots.length; r++) init(roots[r]);

  function init(section) {
    var slides = section.querySelectorAll('.hero-slide');
    var n = slides.length;
    if (n < 2) return;
    var controls = section.querySelector('.hero-controls');
    if (controls) controls.hidden = false;
    section.classList.add('js-hero');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wide = window.matchMedia('(min-width: 641px)').matches;
    var prev = section.querySelector('.hero-prev');
    var nextBtn = section.querySelector('.hero-next');
    var pauseBtn = section.querySelector('.hero-pause');
    var dots = section.querySelectorAll('.hero-dot');
    var live = section.querySelector('.hero-live');
    var active = 0;
    var paused = false;
    var timer = 0;
    var x0 = null;
    var done = false;

    function setPaused(nextPaused) {
      paused = nextPaused;
      if (pauseBtn) {
        var label = paused ? 'Play' : 'Pause';
        pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', label);
        var sr = pauseBtn.querySelector('.hero-sr');
        if (sr) sr.textContent = label;
      }
      if (live) live.setAttribute('aria-live', paused || reduced ? 'polite' : 'off');
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
      if (!paused && !reduced) {
        timer = setInterval(function () {
          go(active + 1);
        }, 6000);
      }
    }

    function applyCopy(slide) {
      var heading = slide.getAttribute('data-heading');
      var h1 = section.querySelector('.hero-inner h1');
      if (heading && h1) h1.textContent = heading;
      var sub = slide.getAttribute('data-subheading');
      var inner = section.querySelector('.hero-inner');
      if (!inner) return;
      var copy = inner.querySelector('p');
      if (sub) {
        if (!copy) {
          copy = document.createElement('p');
          var cta = inner.querySelector('a');
          if (cta) inner.insertBefore(copy, cta);
          else inner.appendChild(copy);
        }
        copy.hidden = false;
        copy.textContent = sub;
      } else if (copy) {
        copy.hidden = true;
      }
    }

    function ensureSrc(video) {
      if (video.querySelector('source')) return;
      var src = video.getAttribute('data-src');
      if (!src) return;
      var source = document.createElement('source');
      source.src = src;
      var type = video.getAttribute('data-type');
      if (type) source.type = type;
      video.appendChild(source);
      video.load();
    }

    function go(i) {
      active = ((i % n) + n) % n;
      for (var s = 0; s < n; s++) {
        var slide = slides[s];
        var on = s === active;
        slide.hidden = !on;
        if (on) slide.removeAttribute('aria-hidden');
        else slide.setAttribute('aria-hidden', 'true');
        var video = slide.querySelector('video');
        if (video) {
          if (on && wide && !reduced) {
            ensureSrc(video);
            var pending = video.play();
            if (pending && pending.catch) pending.catch(function () {});
          } else {
            video.pause();
          }
        }
        var dot = dots[s];
        if (dot) {
          if (on) dot.setAttribute('aria-current', 'true');
          else dot.removeAttribute('aria-current');
        }
      }
      if (live) live.textContent = 'Slide ' + (active + 1) + ' of ' + n;
      applyCopy(slides[active]);
    }

    function bindDot(dot, index) {
      dot.addEventListener('click', function () {
        setPaused(true);
        go(index);
      });
    }

    if (prev) prev.addEventListener('click', function () { setPaused(true); go(active - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { setPaused(true); go(active + 1); });
    if (pauseBtn) pauseBtn.addEventListener('click', function () { setPaused(!paused); });
    for (var d = 0; d < dots.length; d++) bindDot(dots[d], d);

    section.addEventListener('keydown', function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      var key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
      if (!section.contains(document.activeElement)) return;
      event.preventDefault();
      setPaused(true);
      if (key === 'ArrowLeft') go(active - 1);
      else if (key === 'ArrowRight') go(active + 1);
      else if (key === 'Home') go(0);
      else go(n - 1);
    });

    var stage = section.querySelector('.hero-stage');
    if (stage) {
      stage.addEventListener('pointerdown', function (event) {
        done = false;
        if (event.pointerType === 'mouse') {
          x0 = null;
          return;
        }
        x0 = event.clientX;
      });
      stage.addEventListener('pointerup', function (event) {
        if (x0 === null) return;
        var dx = event.clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 36) {
          done = true;
          setPaused(true);
          go(active + (dx < 0 ? 1 : -1));
        }
      });
      stage.addEventListener('pointercancel', function () {
        x0 = null;
      });
      stage.addEventListener('click', function (event) {
        if (!done) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        done = false;
      }, true);
    }

    go(0);
    setPaused(reduced);
  }
})();
`

