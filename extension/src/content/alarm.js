/**
 * The companion's full-screen warning, shared by the block page (guard.js), the password alarm (pwalarm.js) and the
 * pasted-command guard (clipguard.js). It lives in a closed shadow root so the page cannot restyle, remove or press
 * it, takes the keyboard while it is up (focus moves in, Tab stays inside), and ignores clicks a script made.
 *
 * Loaded into the companion's own world for the first two and into the page's world for the third (clipguard.js
 * must wrap the page's clipboard calls), so it keeps what it needs from the page's world before any page script runs.
 *
 *   SentinelAlarm.show({ accent, icon, title, chip, verdict, lead, steps, ordered, buttons, extra, link, foot,
 *                        small, escape }) -> { $, close }
 *     buttons  [{ text, kind: 'go' | 'quiet' | '', cls, on(ev, ctl) }], the first 'go' one gets the focus
 *     extra    trusted markup after the buttons (the password alarm's "are you sure" box)
 *     link     { href, text }: opened in a new tab, the recovery guide
 *     small    a notice in the corner instead of a full-screen block; it does not take the focus
 *     escape   what the Escape key does; without it, Escape does nothing
 */
(() => {
  'use strict';
  if (globalThis.SentinelAlarm) return;
  const attach = Element.prototype.attachShadow;
  const make = Document.prototype.createElement;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** "Take me back to safety": the page before this one, or a blank page. */
  function leave() {
    if (history.length > 1) history.back(); else location.replace('about:blank');
  }

  function css(accent, small) {
    return `
      :host{all:initial}
      .wrap{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(9,10,12,.96);
        font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#ecebe7;animation:f .25s ease}
      .wrap.small{inset:auto 16px 16px auto;display:block;padding:0;background:none;max-width:calc(100vw - 32px)}
      @keyframes f{from{opacity:0}to{opacity:1}}
      .panel{width:min(560px,100%);box-sizing:border-box;background:#131519;border:1px solid #2a2d33;border-radius:22px;padding:36px 36px 28px;box-shadow:0 40px 100px rgba(0,0,0,.6);animation:r .35s cubic-bezier(.2,.8,.2,1)}
      .small .panel{width:380px;max-width:100%;border-top:3px solid ${accent};border-radius:16px;padding:18px 18px 14px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
      @keyframes r{from{transform:translateY(14px) scale(.98);opacity:0}to{transform:none;opacity:1}}
      @media (prefers-reduced-motion: reduce){.wrap,.panel{animation:f .25s ease}}
      .ring{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:${accent}1f;box-shadow:inset 0 0 0 1px ${accent}66;color:${accent};margin-bottom:20px}
      .ring svg{width:38px;height:38px}
      h1{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 10px;font-weight:700}
      .small h1{font-size:16px;margin:0 0 8px}
      .chip{display:inline-block;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#b3b8bf;background:#1b1e23;border:1px solid #2a2d33;padding:6px 10px;border-radius:9px;margin-bottom:18px;word-break:break-all}
      .small .chip{font-size:12px;padding:4px 8px;margin-bottom:10px}
      .verdict{color:${accent};font-weight:650;margin:0 0 12px}
      p{margin:0 0 14px;color:#c7cad0}
      .small p{font-size:13.5px;margin:0 0 12px}
      ol,ul{margin:0 0 24px;padding-left:20px;display:grid;gap:8px;color:#c7cad0}
      ul{padding:0;list-style:none}
      ul li{display:flex;gap:10px}ul li:before{content:"";flex:none;width:6px;height:6px;margin-top:9px;border-radius:50%;background:${accent}}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      button{all:unset;cursor:pointer;font-weight:650;font-size:14px;padding:12px 18px;border-radius:12px;background:#1f2227;color:#ecebe7}
      .small button{font-size:13px;padding:8px 12px;border-radius:10px}
      button:hover{background:#272a30}
      button:focus-visible,a:focus-visible{outline:2px solid #d6b25a;outline-offset:2px}
      .go{background:#d6b25a;color:#131519}.go:hover{background:#e2c47f}
      .quiet{background:none;color:#80868f;text-decoration:underline;padding:12px 6px}.quiet:hover{background:none;color:#c7cad0}
      .small .quiet{padding:8px 4px}
      .sure{margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#1b1e23;color:#c7cad0}
      .sure[hidden]{display:none}
      .help{margin:18px 0 0;font-size:13.5px}
      .help a{color:#d6b25a;text-decoration:underline}
      .foot{margin-top:24px;padding-top:16px;border-top:1px solid #23262b;display:flex;justify-content:space-between;gap:12px;color:#6e747c;font-size:12px}
      .small .foot{margin-top:12px;padding-top:10px}
      .foot b{color:#c9a64e;letter-spacing:.22em;font-size:11px}`;
  }

  let shown = null;

  function show(o) {
    if (shown) shown.close();
    const accent = o.accent || '#e5484d';
    const before = document.activeElement;
    const host = make.call(document, 'div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    if (o.small) host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const root = attach.call(host, { mode: 'closed' });
    const list = (o.steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
    const role = o.small ? 'role="alert"' : 'role="alertdialog" aria-modal="true" aria-labelledby="t" aria-describedby="d"';
    root.innerHTML = `<style>${css(accent, o.small)}</style>
      <div class="wrap${o.small ? ' small' : ''}" ${role}>
        <div class="panel">
          ${o.icon ? `<div class="ring">${o.icon}</div>` : ''}
          <h1 id="t">${esc(o.title)}</h1>
          ${o.chip ? `<div class="chip">${esc(o.chip)}</div>` : ''}
          ${o.verdict ? `<p class="verdict">Sentinel: ${esc(o.verdict)}</p>` : ''}
          <div id="d">${o.lead ? `<p>${esc(o.lead)}</p>` : ''}${list ? (o.ordered ? `<ol>${list}</ol>` : `<ul>${list}</ul>`) : ''}</div>
          <div class="row">${(o.buttons || []).map((b, i) => `<button type="button" data-i="${i}" class="${esc(b.kind || '')} ${esc(b.cls || '')}">${esc(b.text)}</button>`).join('')}</div>
          ${o.extra || ''}
          ${o.link ? `<p class="help"><a href="${esc(o.link.href)}" target="_blank" rel="noopener noreferrer">${esc(o.link.text)}</a></p>` : ''}
          <div class="foot"><span><b>SENTINEL</b></span>${o.foot ? `<span>${esc(o.foot)}</span>` : ''}</div>
        </div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    const ctl = {
      $,
      close() {
        host.remove();
        if (shown === ctl) shown = null;
        if (!o.small && before && before.focus && before.isConnected) try { before.focus(); } catch { /* gone */ }
      }
    };
    // Only the person's own presses count: a page script cannot reach into a closed shadow root, and an untrusted
    // event is ignored all the same.
    root.addEventListener('click', (ev) => {
      if (!ev.isTrusted) return;
      const b = ev.target.closest && ev.target.closest('button[data-i]');
      const spec = b && (o.buttons || [])[Number(b.dataset.i)];
      if (spec && spec.on) spec.on(ev, ctl);
    });
    root.addEventListener('keydown', (ev) => {
      if (!ev.isTrusted) return;
      if (ev.key === 'Escape' && o.escape) { ev.preventDefault(); o.escape(ctl); return; }
      if (ev.key !== 'Tab' || o.small) return;
      // Tab and Shift+Tab go round the warning's own controls, never back to the page behind it.
      const all = [...root.querySelectorAll('button, a[href]')].filter((el) => !el.closest('[hidden]'));
      if (!all.length) return;
      const at = all.indexOf(root.activeElement);
      const next = ev.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at === all.length - 1 ? 0 : at + 1);
      ev.preventDefault();
      all[next].focus();
    });
    (document.documentElement || document).appendChild(host);
    shown = ctl;
    if (!o.small) {
      const first = $('button.go') || $('button');
      if (first) first.focus();
    }
    return ctl;
  }

  globalThis.SentinelAlarm = Object.freeze({ show, leave, esc });
})();
