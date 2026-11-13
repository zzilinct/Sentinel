/**
 * The look on the site's app (web/app.html): the choice itself. Loads after look.js (the table and the colours), and
 * keeps the choice on this device, takes it from the Windows app and the account, and draws the theme button and the
 * picker in Settings. The marketing pages have no picker: they load look-site.js, which needs neither file.
 */
(function (root) {
  'use strict';
  var L = root.SentinelLook;
  if (!L || typeof document === 'undefined' || !/^https?:$/.test(location.protocol)) return;
  var mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: light)') : null;

  /* ------------------------------------------------- the site and the web app */

  // Remembered on this device first, so nothing waits on the network: the theme under the key it always had, the
  // accent, when each was chosen, and the accent's colours for both schemes, which boot.js draws before the first
  // paint (this file loads after it). Inside the Windows app, the app's own setting is the one choice; signed in, the
  // account carries it to the person's other devices (sync()).
  var KEY = { mode: 'sentinel:theme', accent: 'sentinel:accent', at: 'sentinel:look-at', vars: 'sentinel:look-vars' };
  var desktop = root.sentinelDesktop && root.sentinelDesktop.look ? root.sentinelDesktop : null;
  var listeners = [];
  var html = document.documentElement;
  function stored() {
    try {
      return L.record({ mode: localStorage.getItem(KEY.mode), accent: localStorage.getItem(KEY.accent), at: JSON.parse(localStorage.getItem(KEY.at) || '{}') });
    } catch (e) { return L.record(); }
  }
  function keep(r) {
    try {
      if (r.mode === 'auto') localStorage.removeItem(KEY.mode); else localStorage.setItem(KEY.mode, r.mode);
      if (r.accent === 'gold') { localStorage.removeItem(KEY.accent); localStorage.removeItem(KEY.vars); } else {
        localStorage.setItem(KEY.accent, r.accent);
        var v = JSON.parse(localStorage.getItem(KEY.vars) || '{}');
        if (v.accent !== r.accent) localStorage.setItem(KEY.vars, JSON.stringify({ accent: r.accent, dark: webVars(r.accent, 'dark'), light: webVars(r.accent, 'light') }));
      }
      localStorage.setItem(KEY.at, JSON.stringify(r.at));
    } catch (e) { /* this page only */ }
  }
  // What boot.js needs before the first paint: the stylesheets' own names only.
  function webVars(id, s) { var all = L.ramp(id, s), out = {}; for (var k in all) if (/^--(gold|metal|line-gold|sketch-gold|btn-grad|gilt)/.test(k)) out[k] = all[k]; return out; }
  var current = stored();
  L.paint(html, current);
  keep(current);   // a device that had the accent before boot.js drew it gets its colours kept now
  function show(look, from) {
    var was = current;
    current = look;
    var draw = function () { L.paint(html, look); listeners.slice().forEach(function (fn) { fn(look, was); }); };
    // A press is answered with the new look opening out from where it was pressed (sentinel.css .look-vt). A change
    // from elsewhere, or with Motion off, is simply drawn.
    // Motion Off (boot.js data-motion, which the system asking for less motion also sets): simply drawn.
    var still = html.dataset.motion === 'off';
    if (!from || still || !document.startViewTransition || document.visibilityState !== 'visible') { draw(); return; }
    html.style.setProperty('--look-x', from.x + 'px');
    html.style.setProperty('--look-y', from.y + 'px');
    html.classList.add('look-vt');
    // A second press before the first has opened takes over: only the last one clears the class.
    var mine = ++show.n;
    var done = function () { if (mine === show.n) html.classList.remove('look-vt'); };
    document.startViewTransition(draw).finished.then(done, done);
  }
  show.n = 0;
  /** A record from elsewhere (the Windows app, the account, another tab): kept, and drawn if it changes anything. */
  function take(r) {
    var m = L.merge(current, r);
    var changed = m.mode !== current.mode || m.accent !== current.accent;
    keep(m);
    if (changed) show(m); else current = m;
    return m;
  }
  /** Changes the look (any of mode, accent). `from` is the point it was chosen at, for the reveal. */
  function set(change, from) {
    var r = L.record(current), now = Date.now();
    ['mode', 'accent'].forEach(function (k) { if (change && k in change && L.normal(Object.assign({}, r, change))[k] !== r[k]) { r[k] = L.normal(Object.assign({}, r, change))[k]; r.at[k] = now; } });
    if (r.mode === current.mode && r.accent === current.accent) return Promise.resolve(current);
    keep(r);
    show(r, from);
    if (syncing) sync(true);
    return desktop ? desktop.setLook(r).then(function () { return r; }, function () { return r; }) : Promise.resolve(r);
  }
  if (desktop) {
    desktop.look().then(take, function () {});
    if (desktop.onLook) desktop.onLook(take);
  }
  // Auto follows the system: its ramp changes with it. The same choice made in another tab is drawn here too.
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (current.mode === 'auto') L.paint(html, current); });
  root.addEventListener('storage', function (ev) { if (ev.key === KEY.at) take(stored()); });

  /*
   * Signed in, the look follows the person to their other devices: the account keeps one record, and each setting
   * comes from whichever device chose it last (GET and POST /api/v1/account/look). The app asks when it starts
   * (SentinelLook.sync()) and when it comes back into view after a minute or more; a change is sent at once. Nothing
   * polls. Signed out, or the account unreachable, the look stays on this device and says so.
   */
  var syncing = false, asked = 0;
  var state = 'local';   // local: this device only; synced: with the account; computer: the Windows app's own account; failed
  function sync(push) {
    syncing = true;
    asked = Date.now();
    var opts = push ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(L.record(current)) } : { credentials: 'same-origin' };
    return fetch('/api/v1/account/look', opts).then(function (res) {
      if (res.status === 401) { syncing = false; return { state: 'local' }; }
      if (!res.ok) throw new Error(String(res.status));
      return res.json().then(function (d) { var m = take(d); if (!push && L.rev(m) > L.rev(d)) sync(true); return { state: d.computer ? 'computer' : 'synced' }; });
    }).catch(function () { return { state: 'failed' }; }).then(function (r) {
      state = r.state;
      listeners.slice().forEach(function (fn) { fn(current, current); });
      return state;
    });
  }
  document.addEventListener('visibilitychange', function () { if (syncing && document.visibilityState === 'visible' && Date.now() - asked > 60000) sync(false); });

  /* The theme button (any [data-theme-toggle]): Auto, Light, Dark in turn, and it says which is on. */
  var WORD = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  function label() {
    var b = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < b.length; i++) {
      // The spoken name holds the word on the button, so saying what you see works.
      b[i].setAttribute('aria-label', 'Theme: ' + WORD[current.mode] + '. Change theme');
      b[i].title = 'Theme: ' + WORD[current.mode];
      b[i].dataset.mode = current.mode;
      var t = b[i].querySelector('[data-theme-label]');
      if (t) t.textContent = WORD[current.mode];
    }
  }
  listeners.push(label);
  document.addEventListener('DOMContentLoaded', label);
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-theme-toggle]');
    if (!b) return;
    var order = ['auto', 'light', 'dark'];
    var r = b.getBoundingClientRect();
    set({ mode: order[(order.indexOf(current.mode) + 1) % 3] }, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });

  /**
   * The picker: Theme (Auto, Light, Dark) and Colour (a coin for each accent), as two groups of radio buttons, so the
   * arrow keys move the choice and a screen reader says the group, the name and which is on. Changing it changes
   * everything at once. Any page can place it: SentinelLook.picker() returns the element.
   */
  function picker(opts) {
    // only: 'mode' or 'accent' draws that group alone (the Settings home gives each its own row, whose heading says the
    // group's name, so the legend is kept for screen readers only).
    var only = opts && opts.only;
    var box = document.createElement('div');
    box.className = 'look';
    var n = ++picker.n;
    var coins = L.ACCENTS.map(function (a) {
      var r = a.id === 'gold' ? L.GOLD.dark.web : null;
      var v = r ? [r[200], r[400], r[600]] : (function (x) { return [x['--gold-200'], x['--gold-400'], x['--gold-600']]; })(L.ramp(a.id, 'dark'));
      return '<label class="look__coin" style="--c1:' + v[0] + ';--c2:' + v[1] + ';--c3:' + v[2] + '"><input type="radio" name="look-accent-' + n + '" value="' + a.id + '"><i aria-hidden="true"></i><span>' + a.name + '</span></label>';
    }).join('');
    var modes = ['auto', 'light', 'dark'].map(function (m) {
      return '<label class="look__mode"><input type="radio" name="look-mode-' + n + '" value="' + m + '"><span>' + WORD[m] + '</span></label>';
    }).join('');
    // The first picker on a page carries the Settings rows' ids (theme, accent), which the first-run step looks for.
    var rowId = function (row) { return 'data-row="' + row + '"' + (n === 1 && !document.getElementById(row) ? ' id="' + row + '"' : ''); };
    var legend = only ? '<legend class="sr-only">' : '<legend>';
    box.innerHTML = (only === 'accent' ? '' : '<fieldset class="look__group" ' + rowId('theme') + '>' + legend + 'Theme</legend><div class="look__modes">' + modes + '</div></fieldset>') +
      (only === 'mode' ? '' : '<fieldset class="look__group" ' + rowId('accent') + '>' + legend + 'Colour</legend><div class="look__coins">' + coins + '</div>' +
      '<p class="look__note">Red, orange, yellow and green are kept for warnings, so they are never a colour here.</p></fieldset>') +
      '<p class="look__sync" role="status"' + (only === 'mode' ? ' hidden' : '') + '></p>';
    var said = box.querySelector('.look__sync');
    var placed = false;
    var sync = function () {
      // A view drawn again leaves its old picker behind: it stops listening.
      if (box.isConnected) placed = true;
      else if (placed) { listeners.splice(listeners.indexOf(sync), 1); return; }
      var inputs = box.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) inputs[i].checked = inputs[i].value === (inputs[i].name.indexOf('mode') > 0 ? current.mode : current.accent);
      said.textContent = SAID[state];
      said.dataset.state = state;
    };
    box.addEventListener('change', function (ev) {
      var t = ev.target, r = t.parentNode.getBoundingClientRect();
      var from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      set(t.name.indexOf('mode') > 0 ? { mode: t.value } : { accent: t.value }, from);
    });
    listeners.push(sync);
    sync();
    return box;
  }
  picker.n = 0;
  var SAID = {
    local: 'Saved on this device.',
    synced: 'Saved with your account, so your other devices use it too.',
    computer: 'Saved on this computer, for the app, live scanning, its warnings and the companion.',
    failed: 'Your account could not be reached. Your choice is saved on this device.'
  };

  L.get = function () { return current; };
  L.set = set;
  L.on = function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  L.picker = picker;
  L.sync = function () { return sync(false); };
  L.state = function () { return state; };
})(typeof globalThis !== 'undefined' ? globalThis : this);
