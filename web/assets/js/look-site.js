/**
 * The look on the marketing pages, which have no picker: the theme button (Auto, Light, Dark in turn) and the look
 * chosen in the app, drawn from what this device keeps. No colour is worked out here: an accent's colours for both
 * schemes are the ones look-app.js kept when it was chosen (sentinel:look-vars), as boot.js draws them before the
 * first paint. On the site's app (look-app.js is there) this file stands aside.
 */
(function () {
  'use strict';
  if (!/^https?:$/.test(location.protocol)) return;
  var html = document.documentElement;
  var KEY = { mode: 'sentinel:theme', accent: 'sentinel:accent', at: 'sentinel:look-at', vars: 'sentinel:look-vars' };
  var WORD = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  // The names look.js keeps for the pages (its WEB): only these are ever taken off <html> again. V is its WEB_V: a set
  // kept by an older Sentinel lacks the newer names, and drawn as it was it left these pages half in the old look until
  // the app was opened. tests/look.test.js holds both to look.js.
  var OURS = /^--(gold|metal|line|sketch|btn-grad|gilt|text|muted|faint|bg|surface|field-bg|sheet|panel|glass|haze|glow|star|live|words|night|rim|relief|neu-lo|hi$|lo$)/;
  var V = 3;
  var mq = window.matchMedia && matchMedia('(prefers-color-scheme: light)');
  var app = function () { return Boolean(window.SentinelLook && window.SentinelLook.set); };
  var read = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var mode = function () { var m = read(KEY.mode); return m === 'light' || m === 'dark' ? m : 'auto'; };

  function label() {
    var m = mode(), b = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < b.length; i++) {
      // The spoken name holds the word on the button, so saying what you see works.
      b[i].setAttribute('aria-label', 'Theme: ' + WORD[m] + '. Change theme');
      b[i].title = 'Theme: ' + WORD[m];
      b[i].dataset.mode = m;
      var t = b[i].querySelector('[data-theme-label]');
      if (t) t.textContent = WORD[m];
    }
  }

  function draw() {
    var m = mode(), a = read(KEY.accent), s = m !== 'auto' ? m : mq && mq.matches ? 'light' : 'dark', v = {};
    if (m === 'auto') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', m);
    try { v = JSON.parse(read(KEY.vars) || '{}'); } catch (e) { /* gold */ }
    var vars = a && v.accent === a && v[s] ? v[s] : {};
    for (var i = html.style.length; i--;) { var p = html.style[i]; if (OURS.test(p) && !(p in vars)) html.style.removeProperty(p); }
    for (var k in vars) if (OURS.test(k)) html.style.setProperty(k, vars[k]);
    if (a && v.accent === a) html.setAttribute('data-accent', a); else html.removeAttribute('data-accent');
    label();
  }

  // An older set: the colours are worked out again and kept as look-app.js keeps them, and drawn; the next page is
  // drawn whole by boot.js before its first paint. Once every script is in: on the app's pages look-app.js keeps them
  // itself, and a page that already has look.js (the colour preview) needs no second copy, which would replace the
  // SentinelLook the page's own scripts extended. Only a page without one fetches it, once.
  document.addEventListener('DOMContentLoaded', function () {
    var a = read(KEY.accent), v = {};
    try { v = JSON.parse(read(KEY.vars) || '{}') || {}; } catch (e) { /* worked out again */ }
    if (app() || !a || a === 'gold' || (v.accent === a && v.v === V)) return;
    var redo = function () {
      var L = window.SentinelLook;
      if (!L || !L.webVars || app() || L.normal({ accent: a }).accent !== a) return;
      try { localStorage.setItem(KEY.vars, JSON.stringify(L.webVars(a))); } catch (e) { /* this page only */ }
      draw();
    };
    if (window.SentinelLook) { redo(); return; }
    var s = document.createElement('script');
    s.src = '/assets/js/look.js';
    s.onload = redo;
    document.head.appendChild(s);
  });

  document.addEventListener('DOMContentLoaded', function () { if (!app()) label(); });
  // Auto follows the system, and the same choice made in another tab or in the app is drawn here too.
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!app() && mode() === 'auto') draw(); });
  addEventListener('storage', function (ev) { if (!app() && ev.key && ev.key.indexOf('sentinel:') === 0 && /theme|accent|look/.test(ev.key)) draw(); });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-theme-toggle]');
    if (!b || app()) return;
    var order = ['auto', 'light', 'dark'], next = order[(order.indexOf(mode()) + 1) % 3], at = {};
    // Kept with when it was chosen, as look-app.js keeps it, so the app takes it to the account on its next visit.
    try {
      if (next === 'auto') localStorage.removeItem(KEY.mode); else localStorage.setItem(KEY.mode, next);
      at = JSON.parse(localStorage.getItem(KEY.at) || '{}') || {};
      at.mode = Date.now();
      localStorage.setItem(KEY.at, JSON.stringify(at));
    } catch (e) { /* this page only */ }
    // The new look opens out of the button (sentinel.css .look-vt); with Motion off, or no view transitions, it is drawn.
    var r = b.getBoundingClientRect();
    if (html.dataset.motion === 'off' || !document.startViewTransition || document.visibilityState !== 'visible') { draw(); return; }
    html.style.setProperty('--look-x', (r.left + r.width / 2) + 'px');
    html.style.setProperty('--look-y', (r.top + r.height / 2) + 'px');
    html.classList.add('look-vt');
    var done = function () { html.classList.remove('look-vt'); };
    document.startViewTransition(draw).finished.then(done, done);
  });
})();
