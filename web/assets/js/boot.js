/* Runs before first paint: opt in to reveal animations only when JS is available. */
document.documentElement.classList.add('js');

/*
 * The look (look.js, which loads after the page), drawn before the first paint from what this device keeps: light or
 * dark, and for an accent other than gold the colours look.js worked out when it was chosen. Nothing to compute here,
 * so it costs nothing on a slow computer; gold and Auto need nothing at all.
 */
(function () {
  try {
    var r = document.documentElement, m = localStorage.getItem('sentinel:theme'), a = localStorage.getItem('sentinel:accent');
    if (m === 'light' || m === 'dark') r.setAttribute('data-theme', m);
    if (!a) return;
    var v = JSON.parse(localStorage.getItem('sentinel:look-vars') || '{}');
    var s = m === 'light' || m === 'dark' ? m : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    if (v.accent !== a || !v[s]) return;
    r.setAttribute('data-accent', a);
    for (var k in v[s]) if (/^--[a-z0-9-]+$/.test(k)) r.style.setProperty(k, v[s][k]);
  } catch (e) { /* storage blocked: gold, as the system has it */ }
})();

/*
 * Motion: Full, Calm or Off, chosen once for this device, and the scan effect (the gold digits of delicate scanning),
 * on or off. Set here before the first paint as <html data-motion> and <html data-scan-effect>, which every stylesheet
 * and script reads: nothing asks the system on its own. When the computer asks for less motion it is Off, whatever was
 * chosen. Calm keeps what answers you (a panel opening, a verdict arriving) and stops what moves by itself.
 *
 *   SentinelMotionLevel.get()             'full' | 'calm' | 'off', what is in effect
 *   SentinelMotionLevel.set(level)        remember a choice ('full' | 'calm' | 'off')
 *   SentinelMotionLevel.scanEffect()      true when the digits may show
 *   SentinelMotionLevel.setScanEffect(on)
 *   SentinelMotionLevel.system()          true when the computer asks for less motion (Off, locked)
 *   SentinelMotionLevel.control()         the settings for it, ready to put on a page
 * A change fires `sentinel:motion` on document. The Windows app is told too, for its live scanning overlay.
 */
(function () {
  var LEVELS = ['full', 'calm', 'off'];
  var root = document.documentElement;
  var sys = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var read = function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } };
  var write = function (key, v) { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* this page only */ } };
  var system = function () { return Boolean(sys && sys.matches); };
  var chosen = function () { var v = read('sentinel:motion'); return LEVELS.indexOf(v) > 0 ? v : 'full'; };
  var get = function () { return system() ? 'off' : chosen(); };
  var scanEffect = function () { return read('sentinel:scan-effect') !== 'off'; };
  var tellApp = function () {
    var d = window.sentinelDesktop;
    if (d && d.setMotion) d.setMotion({ motion: chosen(), scanEffect: scanEffect() }).catch(function () { /* the app keeps its last */ });
  };
  function apply() {
    var level = get(), effect = scanEffect() ? 'on' : 'off';
    var first = !root.dataset.motion;
    if (root.dataset.motion !== level || root.dataset.scanEffect !== effect) {
      root.dataset.motion = level;
      root.dataset.scanEffect = effect;
      if (!first) document.dispatchEvent(new CustomEvent('sentinel:motion', { detail: level }));
      // Turned Off while the page is open: what scripts set moving (anime.js, a panel's spring) lands where it ends, at
      // once; the stylesheets already stop their own.
      if (!first && level === 'off' && document.getAnimations) {
        document.getAnimations().forEach(function (a) {
          if (window.CSSAnimation && (a instanceof CSSAnimation || a instanceof CSSTransition)) return;
          try { a.finish(); } catch (e) { a.cancel(); }
        });
      }
    }
    // Once per page and on every change: the Windows app keeps it for windows that are not web pages.
    tellApp();
  }

  var NOTES = {
    full: 'Masks turn, panels spring open and backgrounds drift.',
    calm: 'Panels still open and answers still fade in. Nothing drifts, turns or loops by itself.',
    off: 'Nothing moves. Pages and answers appear at once.',
    locked: 'Your computer asks for less motion, so Sentinel follows.'
  };
  var uid = 0;
  function control() {
    var id = 'motion-' + (++uid);
    var box = document.createElement('div');
    box.className = 'motion-set';
    // The row is #motion (the first-run step and links point at it); a second copy on the same page goes without.
    box.innerHTML = '<div class="setting"' + (document.getElementById('motion') ? '' : ' id="motion"') + '><div><b id="' + id + '">Animation</b><span data-motion-note></span></div>'
      + '<div class="seg motion-set__seg" role="radiogroup" aria-labelledby="' + id + '">'
      + LEVELS.map(function (l) { return '<label class="seg__btn"><input class="sr-only" type="radio" name="' + id + '" value="' + l + '">' + l[0].toUpperCase() + l.slice(1) + '</label>'; }).join('')
      + '</div></div>'
      + '<label class="setting"><div><b>Scan effect</b><span data-scan-note></span></div><input class="switch" type="checkbox" data-scan-effect-switch></label>';
    var radios = box.querySelectorAll('input[type=radio]');
    var sw = box.querySelector('[data-scan-effect-switch]');
    var seen = false;
    function show() {
      // Taken off the page (its view was drawn again): it stops listening.
      if (!box.isConnected && seen) { document.removeEventListener('sentinel:motion', show); return; }
      seen = seen || box.isConnected;
      var level = get(), locked = system();
      radios.forEach(function (r) {
        r.checked = r.value === level;
        r.disabled = locked;
        r.parentNode.classList.toggle('is-on', r.checked);
      });
      box.querySelector('[data-motion-note]').textContent = locked ? NOTES.locked : NOTES[level];
      sw.checked = scanEffect() && level !== 'off';
      sw.disabled = level === 'off';
      box.querySelector('[data-scan-note]').textContent = level === 'off'
        ? 'Motion is off, so delicate scanning shows only the gold line and the marks.'
        : 'Faint gold digits settle over the results while delicate scanning checks them.' + (level === 'calm' ? ' Calm shows fewer, turning slower.' : '');
    }
    radios.forEach(function (r) { r.addEventListener('change', function () { if (r.checked) set(r.value); }); });
    sw.addEventListener('change', function () { setScanEffect(sw.checked); });
    document.addEventListener('sentinel:motion', show);
    show();
    return box;
  }
  function set(level) {
    if (LEVELS.indexOf(level) < 0) return;
    write('sentinel:motion', level === 'full' ? null : level);
    apply();
  }
  function setScanEffect(on) {
    write('sentinel:scan-effect', on ? null : 'off');
    apply();
  }

  apply();
  // The system setting changed, or another tab chose: this page follows at once.
  if (sys && sys.addEventListener) sys.addEventListener('change', apply);
  addEventListener('storage', function (ev) { if (ev.key === 'sentinel:motion' || ev.key === 'sentinel:scan-effect') apply(); });
  window.SentinelMotionLevel = { get: get, set: set, scanEffect: scanEffect, setScanEffect: setScanEffect, system: system, control: control };
})();

/*
 * The opening (intro.js) plays once per visit, only with Full motion, never in a test browser, and never for a
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
    // Calm and Off skip it: it is the largest thing on the site that moves by itself.
    if (document.documentElement.dataset.motion !== 'full') return;
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
 * A sign-in form can be pressed the moment it shows. Until its script has bound it (ui.js formReady) a press is held
 * here and the button says so, so a slow connection never posts the form plainly to an error page. A script that
 * never came (the page has finished loading and the form is still not live) is said in words.
 */
(function () {
  const held = () => document.querySelector('.auth form[data-held]');
  const release = (form) => {
    const b = form.querySelector('button[type=submit]');
    if (form.dataset.held !== undefined) b.textContent = form.dataset.held;
    delete form.dataset.held;
    b.classList.remove('is-busy');
    b.removeAttribute('aria-busy');
  };
  const giveUp = () => {
    const form = held();
    if (!form || form.dataset.live) return;
    release(form);
    document.querySelector('[data-note]').innerHTML = '<div class="banner banner--error" role="alert"><div>This page did not finish loading. Reload it and try again.</div></div>';
  };
  window.SentinelReleaseForm = release;
  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    if (!form.matches('.auth form[data-form]') || form.dataset.live) return;
    ev.preventDefault();
    const b = form.querySelector('button[type=submit]');
    if (form.dataset.held === undefined) form.dataset.held = b.textContent;
    b.textContent = 'One moment';
    b.classList.add('is-busy');
    b.setAttribute('aria-busy', 'true');
    if (document.readyState === 'complete') giveUp();
  }, true);
  window.addEventListener('load', giveUp);
})();

/*
 * Simple view: fewer pages, fewer words, the answer first in bigger type (app.css, html[data-simple]). Chosen in
 * Settings, remembered on this device and set here before the page is painted, like the theme. With storage blocked
 * it holds for this page only, and the page reads the attribute, so it never says one thing and shows another.
 */
(function () {
  const KEY = 'sentinel:simple';
  const root = document.documentElement;
  const apply = (on) => { if (on) root.dataset.simple = ''; else delete root.dataset.simple; };
  try { apply(localStorage.getItem(KEY) === '1'); } catch { /* full view */ }
  window.SentinelSimple = {
    get: () => root.dataset.simple !== undefined,
    set: (on) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* this page only */ } apply(on); }
  };
})();

/*
 * Text size (Standard, Large, Larger) and spacing (Comfortable, Compact), chosen in Settings and kept on this device
 * as one record. Set here before the first paint as <html data-text> and <html data-density>, which fonts.css and
 * sentinel.css read, so a page never draws at one size and jumps to another. The Windows app is told too, for its
 * own windows (the live scanning card, the warnings). Standard and Comfortable store nothing.
 */
(function () {
  const KEY = 'sentinel:type';
  const TEXT = ['standard', 'large', 'larger'];
  const DENSITY = ['comfortable', 'compact'];
  const root = document.documentElement;
  const read = () => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage blocked or bad: the defaults */ }
    return { text: v && TEXT.includes(v.text) ? v.text : 'standard', density: v && DENSITY.includes(v.density) ? v.density : 'comfortable' };
  };
  const apply = (t) => {
    if (t.text === 'standard') delete root.dataset.text; else root.dataset.text = t.text;
    if (t.density === 'comfortable') delete root.dataset.density; else root.dataset.density = t.density;
  };
  const tellApp = (t) => { const d = window.sentinelDesktop; if (d && d.setType) d.setType(t).catch(() => { /* the app keeps its last */ }); };
  const set = (change) => {
    const t = { ...read(), ...change };
    if (!TEXT.includes(t.text) || !DENSITY.includes(t.density)) return read();
    try { if (t.text === 'standard' && t.density === 'comfortable') localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* this page only */ }
    apply(t);
    tellApp(t);
    return t;
  };
  const now = read();
  apply(now);
  tellApp(now);
  addEventListener('storage', (ev) => { if (ev.key === KEY) apply(read()); });
  window.SentinelType = { get: read, set };
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
