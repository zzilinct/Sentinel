/**
 * Password alarm (see lib/pwalarm.js). Runs in every page and frame, and does nothing until the person has chosen
 * accounts to protect.
 *
 * On a protected account's own sign-in site it hands the password to the worker once, when the person signs in, so
 * the worker can keep its hash. Anywhere else it waits until a password box holds as many characters as a protected
 * password, asks the worker whether it is that password, and on a match empties the box and shows the alarm. While
 * the worker is answering, a sign-in press is held back and replayed if the password was not a protected one.
 *
 * The alarm lives in a closed shadow root, like guard.js, so the page cannot restyle, remove or press it.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const send = (msg) => Promise.resolve(ext.runtime.sendMessage(msg)).catch(() => null);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let config = null;          // { learn, lengths } from the worker
  let pending = 0;            // checks the worker has not answered yet
  let held = null;            // the sign-in press held back while a check runs: { form, submitter, click }
  const checked = new WeakMap();   // password box -> the value last checked, so a box is not hashed twice for one value

  const passwordBox = (ev) => {
    const el = ev.composedPath ? ev.composedPath()[0] : ev.target;
    return el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password' ? el : null;
  };
  const boxes = () => [...document.querySelectorAll('input[type=password]')].filter((el) => el.value);

  function load() {
    return send({ type: 'pw-config' }).then((res) => {
      config = res && res.ok ? { learn: res.learn, lengths: res.lengths || [] } : { learn: false, lengths: [] };
    });
  }

  /* -------------------------------------------------------- learning at home */

  let lastLearned = '';
  function learn() {
    const box = boxes()[0];
    if (!box || box.value === lastLearned) return;
    lastLearned = box.value;
    send({ type: 'pw-learn', password: box.value });
  }

  /* --------------------------------------------------------- checking away */

  function check(box) {
    const value = box.value;
    if (!config.lengths.includes(value.length) || checked.get(box) === value) return;
    checked.set(box, value);
    pending++;
    send({ type: 'pw-check', password: value }).then((res) => {
      pending--;
      if (res && res.ok && res.match) {
        held = null;
        // Empty the box the way typing would, so the page's own code sees it empty too.
        box.value = '';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        checked.delete(box);
        return;
      }
      if (!pending && held) replay();
    });
  }

  function replay() {
    const h = held;
    held = null;
    try {
      if (h.form && h.form.isConnected) h.form.requestSubmit(h.submitter && h.submitter.form === h.form ? h.submitter : undefined);
      else if (h.click && h.click.isConnected) h.click.click();
    } catch { /* the page changed under it */ }
  }

  /** A press that would send the form while a check is running is held, then replayed if nothing matched. */
  function hold(ev, form, submitter, click) {
    if (!pending) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    held = { form, submitter, click };
  }

  /* ---------------------------------------------------------------- wiring */

  window.addEventListener('input', (ev) => {
    const box = passwordBox(ev);
    if (!box || !config) return;
    if (!config.learn && config.lengths.length) check(box);
  }, true);

  window.addEventListener('change', (ev) => {
    if (config && config.learn && passwordBox(ev)) learn();
  }, true);

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !config) return;
    const box = passwordBox(ev);
    if (config.learn) { if (box) learn(); return; }
    if (box) hold(ev, box.form, null, null);
  }, true);

  window.addEventListener('submit', (ev) => {
    if (!config) return;
    if (config.learn) { learn(); return; }
    hold(ev, ev.target, ev.submitter, null);
  }, true);

  window.addEventListener('click', (ev) => {
    if (!config || config.learn || !pending) return;
    const el = ev.composedPath ? ev.composedPath()[0] : ev.target;
    const button = el && el.closest ? el.closest('button, input[type=submit], input[type=button], [role=button]') : null;
    if (button) hold(ev, null, null, button);
  }, true);

  load();
  // A protected account added or learned while this page is open counts from then on.
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.pwalarm) load(); });

  /* ----------------------------------------------------------------- alarm */

  // The password steps are the shared ones (steps.js, loaded just before this), the same words the site and the
  // Windows app use.
  const LOGIN_STEPS = (name) => [
    'Sentinel emptied the password box. Do not type it here again.',
    `This page may have read some of your ${name} password as you typed. ${globalThis.SentinelSteps.text.password}`,
    globalThis.SentinelSteps.text.twostep
  ];

  let shown = null;
  function alarm(msg) {
    if (shown) shown.remove();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const accent = '#e5484d';
    const verdict = msg.verdict && msg.verdict.overall && msg.verdict.overall.badge ? msg.verdict.overall.label : '';
    const real = msg.bank ? msg.name : `${/^[aeiou]/i.test(msg.name) ? 'an' : 'a'} ${msg.name} site`;
    root.innerHTML = `
      <style>
        :host{all:initial}
        .wrap{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(9,10,12,.96);
          font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#ecebe7;animation:f .25s ease}
        @keyframes f{from{opacity:0}to{opacity:1}}
        .panel{width:min(560px,100%);background:#131519;border:1px solid #2a2d33;border-radius:22px;padding:36px 36px 28px;box-shadow:0 40px 100px rgba(0,0,0,.6);animation:r .35s cubic-bezier(.2,.8,.2,1)}
        @keyframes r{from{transform:translateY(14px) scale(.98);opacity:0}to{transform:none;opacity:1}}
        @media (prefers-reduced-motion: reduce){.panel{animation:f .25s ease}}
        .ring{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:${accent}1f;box-shadow:inset 0 0 0 1px ${accent}66;color:${accent};margin-bottom:20px}
        .ring svg{width:38px;height:38px}
        h1{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 10px;font-weight:700}
        .host{display:inline-block;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#b3b8bf;background:#1b1e23;border:1px solid #2a2d33;padding:6px 10px;border-radius:9px;margin-bottom:18px;word-break:break-all}
        .verdict{color:${accent};font-weight:650;margin:0 0 12px}
        ol{margin:0 0 24px;padding-left:20px;display:grid;gap:8px;color:#c7cad0}
        .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
        button{all:unset;cursor:pointer;font-weight:650;font-size:14px;padding:12px 18px;border-radius:12px;background:#1f2227;color:#ecebe7}
        button:hover{background:#272a30}
        button:focus-visible{outline:2px solid #d6b25a;outline-offset:2px}
        .go{background:#d6b25a;color:#131519}.go:hover{background:#e2c47f}
        .on{background:none;color:#80868f;text-decoration:underline;padding:12px 6px}.on:hover{background:none;color:#c7cad0}
        .sure{margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#1b1e23;color:#c7cad0}
        .sure[hidden]{display:none}
        .foot{margin-top:24px;padding-top:16px;border-top:1px solid #23262b;display:flex;justify-content:space-between;gap:12px;color:#6e747c;font-size:12px}
        .foot b{color:#c9a64e;letter-spacing:.22em;font-size:11px}
      </style>
      <div class="wrap" role="alertdialog" aria-modal="true" aria-labelledby="t" aria-describedby="d">
        <div class="panel">
          <div class="ring">${(globalThis.SentinelMasks || window.SentinelMasks) ? (globalThis.SentinelMasks || window.SentinelMasks).svg('scam') : ''}</div>
          <h1 id="t">This is your ${esc(msg.name)} password, and this is not ${esc(real)}</h1>
          <div class="host">${esc(msg.host)}</div>
          ${verdict ? `<p class="verdict">Sentinel: ${esc(verdict)}</p>` : ''}
          <ol id="d">${LOGIN_STEPS(msg.name).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <div class="row">
            <button class="go">Take me back to safety</button>
            <button class="rep">Report this site</button>
            <button class="on real">This is a real ${esc(msg.name)} site</button>
          </div>
          <div class="sure" hidden>
            <p>Only if you are sure. From now on Sentinel will not stop your ${esc(msg.name)} password on <b>${esc(msg.host)}</b>. You can undo this in the companion's settings.</p>
            <div class="row"><button class="allow">Yes, it is real</button><button class="on keep">Keep protecting me</button></div>
          </div>
          <div class="foot"><span><b>SENTINEL</b></span><span>Your password never leaves this computer. Sentinel keeps only a scrambled form of it.</span></div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    shown = host;
    const $ = (sel) => root.querySelector(sel);
    // Only the person's own presses count: a page script cannot reach into a closed shadow root, and an
    // untrusted event is ignored all the same.
    const on = (sel, fn) => { $(sel).addEventListener('click', (ev) => { if (ev.isTrusted) fn(ev); }); };
    on('.go', () => { if (history.length > 1) history.back(); else location.replace('about:blank'); });
    on('.rep', (ev) => {
      ev.target.textContent = 'Reporting...';
      send({ type: 'report', url: location.href, category: 'phishing' })
        .then((res) => { ev.target.textContent = res && res.ok ? 'Reported. Thank you.' : 'Could not report'; });
    });
    on('.real', () => { $('.sure').hidden = false; $('.allow').focus(); });
    on('.keep', () => { $('.sure').hidden = true; });
    on('.allow', () => {
      send({ type: 'pw-allow' }).then((res) => {
        if (res && res.ok && res.allowed) { host.remove(); shown = null; } else $('.sure p').textContent = 'Sentinel could not save that. Reload the page and try again.';
      });
    });
    $('.go').focus();
  }

  ext.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== ext.runtime.id || !msg || msg.type !== 'sentinel:pw-alarm' || window !== window.top) return;
    const show = () => alarm(msg);
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  });
})();
