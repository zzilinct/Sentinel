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
  // The names look-app.js keeps for the pages (its webVars): only these are ever taken off <html> again.
  var OURS = /^--(gold|metal|line-gold|sketch-gold|btn-grad|gilt)/;
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
