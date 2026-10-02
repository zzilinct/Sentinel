/* Runs before first paint: opt in to reveal animations only when JS is available. */
document.documentElement.classList.add('js');

/*
 * The opening (intro.js) plays once per visit, never with reduced motion, never in a test browser, and never for a
 * page that is only being printed or prerendered. The class goes on now, before the first paint, so the page does
 * not flash before the cover; whatever happens to intro.js, it comes off by itself after 10 s (intro.js itself never runs
 * past 8 s, the longest a slow page is allowed to keep its sketch).
 */
(function () {
  try {
    // ?intro=1 plays it regardless (the review screenshots photograph it that way).
    var forced = /[?&]intro=1\b/.test(location.search);
    // Crawlers and speed tests see the page itself: the opening is for people.
    if (!forced && (sessionStorage.getItem('sentinel:intro') || navigator.webdriver || /HeadlessChrome|bot|crawl|spider|slurp|Lighthouse|PageSpeed/i.test(navigator.userAgent))) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!forced && (document.visibilityState === 'hidden' || document.prerendering)) return;
    document.documentElement.classList.add('intro');
    // Fail open: if intro.js never ran, the page still uncovers and whatever waits for the opening still starts.
    setTimeout(function () {
      var r = document.documentElement;
      if (!r.classList.contains('intro')) return;
      r.classList.remove('intro');
      document.dispatchEvent(new Event('sentinel:intro-done'));
    }, 10000);
  } catch (e) { /* storage blocked: no opening */ }
})();

/*
 * Light or dark. "Auto" (nothing stored) follows the system; a choice is remembered on this device. Applied here,
 * before the page is painted, so it never flashes the other theme. Any [data-theme-toggle] button cycles
 * Auto, Light, Dark and says which is on.
 */
(function () {
  const KEY = 'sentinel:theme';
  const order = ['auto', 'light', 'dark'];
  const read = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } };
  const apply = (mode) => {
    if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      const label = `Theme: ${mode === 'auto' ? 'automatic' : mode}`;
      b.setAttribute('aria-label', `${label}. Change theme`);
      b.title = label;
      b.dataset.mode = mode;
      const text = b.querySelector('[data-theme-label]');
      if (text) text.textContent = mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark';
    }
  };
  apply(read());
  document.addEventListener('DOMContentLoaded', () => apply(read()));
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-theme-toggle]');
    if (!b) return;
    const next = order[(order.indexOf(read()) + 1) % order.length];
    try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* this page only */ }
    apply(next);
  });
})();
if (!('IntersectionObserver' in window)) document.documentElement.classList.add('no-io');

/*
 * Fail open: if a script errors or never arrives, show everything rather than a blank page. .no-io is the "reveal
 * all" switch; site.js sets Site.ready once its observers are running, after which errors leave the reveals alone.
 */
(function () {
  const revealAll = () => document.documentElement.classList.add('no-io');
  const ready = () => window.Site && window.Site.ready;
  addEventListener('error', (ev) => {
    // Runtime errors target window; failed loads target the element. Only a script can stop the reveals: a missing
    // image or stylesheet (a font import under a subpath) leaves them working.
    const tag = ev.target && ev.target.tagName;
    if ((!tag || tag === 'SCRIPT') && !ready()) revealAll();
  }, true);
  setTimeout(() => { if (!ready()) revealAll(); }, 3000);
})();

/*
 * On a phone the keyboard shrinks the visible part of the page: the field being typed in is brought back into view
 * above it, so people can see what they type.
 */
(function () {
  const vv = window.visualViewport;
  if (!vv) return;
  const typing = (el) => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable]');
  vv.addEventListener('resize', () => {
    const el = document.activeElement;
    if (!typing(el)) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > vv.height - 12 || r.top < 0) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
})();

/*
 * The back button never loses what someone typed. Text in a form marked data-draft is kept for this tab only
 * (session storage, gone when the tab closes) and put back when the page is shown again. Passwords, codes, boxes and
 * anything marked data-no-draft are never kept.
 */
(function () {
  // Checkboxes are left alone: a consent box is only ever ticked by the person, never put back for them.
  const skip = (el) => !el.name || el.type === 'password' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden' || el.type === 'file' || el.autocomplete === 'one-time-code' || el.closest('[data-no-draft]');
  const key = (form) => `sentinel:draft:${location.pathname}:${form.dataset.draft || form.id || 'form'}`;
  const forms = () => document.querySelectorAll('form[data-draft]');
  function restore() {
    for (const form of forms()) {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(key(form)) || 'null'); } catch { saved = null; }
      if (!saved) continue;
      for (const el of form.elements) {
        if (skip(el) || !(el.name in saved)) continue;
        // Only a field still as the page drew it takes the draft back: never one the person has typed in since. A
        // field the app filled from the account (a name) counts as untouched, so an unsent edit to it comes back.
        if (el.type === 'checkbox') el.checked = Boolean(saved[el.name]);
        else if (el.value === el.defaultValue) el.value = saved[el.name];
      }
    }
  }
  document.addEventListener('input', (ev) => {
    const form = ev.target.closest && ev.target.closest('form[data-draft]');
    if (!form) return;
    const out = {};
    for (const el of form.elements) if (!skip(el)) out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    try { sessionStorage.setItem(key(form), JSON.stringify(out)); } catch { /* private window */ }
  });
  // A form that was sent has nothing left to keep.
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest && ev.target.closest('form[data-draft]');
    if (form) setTimeout(() => { if (!form.querySelector('[aria-invalid="true"], .is-invalid')) { try { sessionStorage.removeItem(key(form)); } catch { /* ignore */ } } }, 1500);
  });
  document.addEventListener('DOMContentLoaded', restore);
  addEventListener('pageshow', (ev) => { if (ev.persisted) restore(); });
  // The web app draws its forms after the page has loaded, and calls this once each view is on screen.
  window.sentinelDrafts = { restore };
})();

// Installable web app. Service workers need HTTPS (or localhost in development).
const secureContext = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
// A static export ships no service worker, and may live under a subpath.
if ('serviceWorker' in navigator && secureContext && !window.SENTINEL_STATIC) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
